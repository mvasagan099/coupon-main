-- ============================================================
-- Migration: Exchange rates table + payment_transactions extensions
-- Run in: Supabase Dashboard → SQL Editor (after country_currency_profile.sql)
-- ============================================================

-- 1. Exchange rates cache table (written by server, read by all authenticated)
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency   CHAR(3)     NOT NULL DEFAULT 'USD',
  target_currency CHAR(3)     NOT NULL,
  rate            NUMERIC     NOT NULL CHECK (rate > 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_pair_unique UNIQUE (base_currency, target_currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_base   ON public.exchange_rates(base_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_target ON public.exchange_rates(target_currency);

-- RLS on exchange_rates
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_exchange_rates" ON public.exchange_rates;
CREATE POLICY "authenticated_read_exchange_rates"
  ON public.exchange_rates FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

-- Only service_role / admin can write rates
DROP POLICY IF EXISTS "admin_write_exchange_rates" ON public.exchange_rates;
CREATE POLICY "admin_write_exchange_rates"
  ON public.exchange_rates FOR ALL
  USING (is_admin());

GRANT SELECT ON public.exchange_rates TO authenticated, anon;
GRANT ALL    ON public.exchange_rates TO service_role;

-- 2. Extend payment_transactions with multi-currency columns
ALTER TABLE public.payment_transactions
  ADD COLUMN IF NOT EXISTS exchange_rate  NUMERIC,       -- rate used at time of payment
  ADD COLUMN IF NOT EXISTS amount_usd     NUMERIC,       -- amount in USD (base)
  ADD COLUMN IF NOT EXISTS amount_local   NUMERIC;       -- amount in user's local currency

COMMENT ON COLUMN public.payment_transactions.exchange_rate IS 'Exchange rate (local/USD) at time of payment';
COMMENT ON COLUMN public.payment_transactions.amount_usd    IS 'Equivalent amount in USD';
COMMENT ON COLUMN public.payment_transactions.amount_local  IS 'Amount in user local currency';

-- 3. Seed USD→USD as base rate (always 1)
INSERT INTO public.exchange_rates (base_currency, target_currency, rate)
VALUES ('USD', 'USD', 1.0)
ON CONFLICT (base_currency, target_currency) DO NOTHING;
