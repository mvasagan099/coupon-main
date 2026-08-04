-- ============================================================
-- MASTER MIGRATION: Complete Multi-Country, Currency & Security Setup
-- Execute in: Supabase Dashboard → SQL Editor
-- Features included:
--   1. Profile Country & Currency fields + Auto-Signup Trigger
--   2. Permanent Country Lock Trigger (prevents changing signup country)
--   3. Payment Transactions Table + RLS + Multi-Currency Audit Columns
--   4. Exchange Rates Table + Seed Data + Read/Write RLS
--   5. Admin Withdrawals RPC with Country & Currency Support
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- SECTION 1: Profiles Country & Currency Setup
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country            TEXT,
  ADD COLUMN IF NOT EXISTS country_code       CHAR(2),
  ADD COLUMN IF NOT EXISTS currency           CHAR(3)    DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone           TEXT,
  ADD COLUMN IF NOT EXISTS phone_country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_country_code ON public.profiles(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_currency      ON public.profiles(currency);

GRANT UPDATE (country, country_code, currency, timezone, phone_country_code)
  ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.country            IS 'Full country name (e.g. India)';
COMMENT ON COLUMN public.profiles.country_code       IS 'ISO 3166-1 alpha-2 (e.g. IN) locked upon signup';
COMMENT ON COLUMN public.profiles.currency           IS 'ISO 4217 currency code (e.g. INR)';
COMMENT ON COLUMN public.profiles.timezone           IS 'IANA timezone string (e.g. Asia/Kolkata)';
COMMENT ON COLUMN public.profiles.phone_country_code IS 'Phone dial code (e.g. +91)';

-- Auto-populate profile row on signup using metadata passed during auth.signUp()
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    wallet_balance,
    country,
    country_code,
    currency,
    timezone,
    phone_country_code
  )
  VALUES (
    NEW.id,
    0.00,
    NEW.raw_user_meta_data->>'country',
    NEW.raw_user_meta_data->>'country_code',
    NEW.raw_user_meta_data->>'currency',
    NEW.raw_user_meta_data->>'timezone',
    NEW.raw_user_meta_data->>'phone_country_code'
  )
  ON CONFLICT (id) DO UPDATE SET
    country            = COALESCE(EXCLUDED.country, public.profiles.country),
    country_code       = COALESCE(EXCLUDED.country_code, public.profiles.country_code),
    currency           = COALESCE(EXCLUDED.currency, public.profiles.currency),
    timezone           = COALESCE(EXCLUDED.timezone, public.profiles.timezone),
    phone_country_code = COALESCE(EXCLUDED.phone_country_code, public.profiles.phone_country_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill profiles table with metadata for existing users
UPDATE public.profiles p
SET
  country            = COALESCE(p.country, u.raw_user_meta_data->>'country'),
  country_code       = COALESCE(p.country_code, u.raw_user_meta_data->>'country_code'),
  currency           = COALESCE(p.currency, u.raw_user_meta_data->>'currency'),
  timezone           = COALESCE(p.timezone, u.raw_user_meta_data->>'timezone'),
  phone_country_code = COALESCE(p.phone_country_code, u.raw_user_meta_data->>'phone_country_code')
FROM auth.users u
WHERE p.id = u.id
  AND p.country_code IS NULL
  AND u.raw_user_meta_data->>'country_code' IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- SECTION 2: Permanent Country Locking Policy Trigger
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_country_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.country_code IS NOT NULL AND NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    RAISE EXCEPTION 'Country cannot be changed once assigned to an account. Please create a new account if you relocate.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_country_change ON public.profiles;
CREATE TRIGGER trg_prevent_country_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_country_change();


-- ─────────────────────────────────────────────────────────────
-- SECTION 3: Payment Transactions Table & RLS
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway             TEXT        NOT NULL CHECK (gateway IN ('paypal', 'razorpay', 'stripe')),
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  amount_major        NUMERIC     NOT NULL CHECK (amount_major > 0),
  currency            TEXT        NOT NULL DEFAULT 'USD',
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','paid','failed','cancelled','refunded')),
  idempotency_key     TEXT        NOT NULL UNIQUE,
  exchange_rate       NUMERIC,
  amount_usd          NUMERIC,
  amount_local        NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id         ON public.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_gateway_order   ON public.payment_transactions(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status          ON public.payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_idempotency_key ON public.payment_transactions(idempotency_key);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_view_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_view_own_transactions"
  ON public.payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_all_transactions" ON public.payment_transactions;
CREATE POLICY "admin_all_transactions"
  ON public.payment_transactions FOR ALL
  USING (is_admin());

GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;


-- ─────────────────────────────────────────────────────────────
-- SECTION 4: Exchange Rates Table & Rates Seeding
-- ─────────────────────────────────────────────────────────────

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

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_exchange_rates" ON public.exchange_rates;
CREATE POLICY "authenticated_read_exchange_rates"
  ON public.exchange_rates FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

DROP POLICY IF EXISTS "admin_write_exchange_rates" ON public.exchange_rates;
CREATE POLICY "admin_write_exchange_rates"
  ON public.exchange_rates FOR ALL
  USING (is_admin());

GRANT SELECT ON public.exchange_rates TO authenticated, anon;
GRANT ALL    ON public.exchange_rates TO service_role;

-- Seed supported exchange rates
INSERT INTO public.exchange_rates (base_currency, target_currency, rate, updated_at)
VALUES
  ('USD', 'USD', 1.0, NOW()),
  ('USD', 'INR', 83.50, NOW()),
  ('USD', 'GBP', 0.78, NOW()),
  ('USD', 'AED', 3.67, NOW()),
  ('USD', 'AUD', 1.52, NOW()),
  ('USD', 'EUR', 0.92, NOW()),
  ('USD', 'CAD', 1.36, NOW()),
  ('USD', 'JPY', 155.00, NOW())
ON CONFLICT (base_currency, target_currency)
DO UPDATE SET
  rate = EXCLUDED.rate,
  updated_at = NOW();


-- ─────────────────────────────────────────────────────────────
-- SECTION 5: Admin Withdrawals RPC Function
-- ─────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_get_withdrawals();

CREATE OR REPLACE FUNCTION public.admin_get_withdrawals()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  country text,
  country_code text,
  currency text,
  amount numeric,
  routing_number text,
  account_number text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id,
    w.user_id,
    u.email::text,
    COALESCE(p.country, u.raw_user_meta_data->>'country', 'United States')::text AS country,
    COALESCE(p.country_code, u.raw_user_meta_data->>'country_code', 'US')::text AS country_code,
    COALESCE(p.currency, u.raw_user_meta_data->>'currency', 'USD')::text AS currency,
    w.amount,
    w.routing_number,
    w.account_number,
    w.status,
    w.created_at
  FROM public.withdrawals w
  JOIN auth.users u ON w.user_id = u.id
  LEFT JOIN public.profiles p ON w.user_id = p.id
  ORDER BY w.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_withdrawals() TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- SECTION 6: Coupons Country Tracking, Wallet Deduction & Lotto Game Lock
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS country_code CHAR(2);
CREATE INDEX IF NOT EXISTS idx_coupons_country_code ON public.coupons(country_code);

COMMENT ON COLUMN public.coupons.country_code IS 'ISO country code where coupon was issued. Required for redemption match.';

UPDATE public.coupons c
SET country_code = COALESCE(
  (SELECT p.country_code FROM public.profiles p WHERE p.id = c.issued_to),
  'US'
)
WHERE (c.country_code IS NULL OR c.country_code = '');

CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
  p_gift_card_id UUID,
  p_user_id      UUID,
  p_amount       NUMERIC
)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id    UUID;
  v_prefix        TEXT;
  v_code              TEXT;
  v_coupon_id         UUID;
  v_order_id          UUID;
  v_expiry_date       TIMESTAMPTZ;
  v_country_code      CHAR(2);
  v_user_country_name TEXT;
  v_user_balance      NUMERIC;
  v_attempts          INTEGER := 0;
  v_max_attempts      INTEGER := 10;
BEGIN
  -- 1. Lock user profile and check wallet balance
  SELECT wallet_balance, country_code, country
  INTO v_user_balance, v_country_code, v_user_country_name
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF COALESCE(v_user_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %', p_amount, COALESCE(v_user_balance, 0);
  END IF;

  v_country_code := public.normalize_country_code(COALESCE(v_country_code, v_user_country_name));

  -- 2. Fetch gift card details
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- 3. Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

  -- 4. Generate unique coupon code
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique coupon code';
    END IF;

    v_code := v_prefix || '-' || upper(
      translate(encode(gen_random_bytes(6), 'base64'), '+/=0OIl', 'ABCDEFG')
    );
    v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
  END LOOP;

  -- 5. Deduct wallet balance
  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  -- 6. Insert coupon with BOTH amount and remaining_balance set to p_amount
  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used, country_code
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false, v_country_code
  )
  RETURNING id INTO v_coupon_id;

  -- 7. Insert paid order record
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_country_code(p_country TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_country IS NULL OR trim(p_country) = '' THEN
    RETURN NULL;
  END IF;
  v_clean := upper(trim(p_country));
  IF length(v_clean) = 2 THEN
    RETURN v_clean;
  END IF;

  CASE v_clean
    WHEN 'UNITED STATES', 'UNITED STATES OF AMERICA', 'USA' THEN RETURN 'US';
    WHEN 'INDIA', 'IND' THEN RETURN 'IN';
    WHEN 'AUSTRALIA', 'AUS' THEN RETURN 'AU';
    WHEN 'UNITED KINGDOM', 'GREAT BRITAIN', 'UK', 'GBR' THEN RETURN 'GB';
    WHEN 'CANADA', 'CAN' THEN RETURN 'CA';
    WHEN 'GERMANY', 'DEU' THEN RETURN 'DE';
    WHEN 'FRANCE', 'FRA' THEN RETURN 'FR';
    ELSE RETURN substring(v_clean from 1 for 2);
  END CASE;
END;
$$;

DROP FUNCTION IF EXISTS public.redeem_game_coupon(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.redeem_game_coupon(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.redeem_game_coupon(
  p_coupon_id UUID,
  p_game_user_id TEXT,
  p_game_id TEXT,
  p_wallet_transaction_id TEXT,
  p_ip_address TEXT,
  p_device TEXT,
  p_user_country TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_used         BOOLEAN;
  v_status          TEXT;
  v_coupon_country  TEXT;
  v_user_country    TEXT;
  v_user_uuid       UUID;
  v_issued_to       UUID;
BEGIN
  SELECT is_used, status, country_code, issued_to
  INTO v_is_used, v_status, v_coupon_country, v_issued_to
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  IF v_is_used THEN
    RAISE EXCEPTION 'Coupon already redeemed';
  END IF;

  IF v_status = 'DISABLED' OR v_status = 'disabled' THEN
    RAISE EXCEPTION 'Coupon disabled';
  END IF;

  IF (v_coupon_country IS NULL OR trim(v_coupon_country) = '') AND v_issued_to IS NOT NULL THEN
    SELECT COALESCE(country_code, country) INTO v_coupon_country
    FROM public.profiles
    WHERE id = v_issued_to;
  END IF;

  v_coupon_country := public.normalize_country_code(v_coupon_country);
  v_user_country   := public.normalize_country_code(p_user_country);

  IF (v_user_country IS NULL) THEN
    BEGIN
      v_user_uuid := p_game_user_id::UUID;
      SELECT public.normalize_country_code(COALESCE(country_code, country)) INTO v_user_country
      FROM public.profiles
      WHERE id = v_user_uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_country := NULL;
    END;
  END IF;

  IF v_coupon_country IS NOT NULL THEN
    IF v_user_country IS NULL OR v_coupon_country <> v_user_country THEN
      RAISE EXCEPTION 'Country mismatch: This coupon was issued for % and cannot be redeemed by an account in %', v_coupon_country, COALESCE(v_user_country, 'UNKNOWN');
    END IF;
  END IF;

  UPDATE coupons SET is_used = true, status = 'redeemed', redeemed_at = now() WHERE id = p_coupon_id;

  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid, text, text, text, text, text, text) TO authenticated, anon;

COMMIT;
