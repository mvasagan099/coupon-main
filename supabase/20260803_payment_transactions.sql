-- ============================================================
-- Migration: payment_transactions table
-- Tracks all payment gateway transactions for audit and
-- idempotency. Prevents double-charging and replay attacks.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway             TEXT        NOT NULL CHECK (gateway IN ('paypal', 'razorpay', 'stripe')),
  gateway_order_id    TEXT,       -- PayPal orderId / Razorpay order_id / Stripe PaymentIntent id
  gateway_payment_id  TEXT,       -- Populated after capture/verification
  amount_major        NUMERIC     NOT NULL CHECK (amount_major > 0),
  currency            TEXT        NOT NULL DEFAULT 'USD',
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','paid','failed','cancelled','refunded')),
  idempotency_key     TEXT        NOT NULL UNIQUE,  -- prevents double-charging on retry
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by user or gateway order
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id         ON public.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_gateway_order   ON public.payment_transactions(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status          ON public.payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_idempotency_key ON public.payment_transactions(idempotency_key);

-- Auto-update updated_at on row changes
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

-- Row Level Security
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Users can view only their own transactions
DROP POLICY IF EXISTS "user_view_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_view_own_transactions"
  ON public.payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Only server-side (service_role) or admin can insert/update
DROP POLICY IF EXISTS "admin_all_transactions" ON public.payment_transactions;
CREATE POLICY "admin_all_transactions"
  ON public.payment_transactions FOR ALL
  USING (is_admin());

-- Grant service_role full access (bypasses RLS anyway, but explicit is clearer)
GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;
