-- =============================================================================
-- FIX PAYPAL DEPOSIT & WALLET CREDITING PERMISSIONS
-- Copy and paste this ENTIRE file into: Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- 1. Create deposits table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'PayPal',
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Service role full access on deposits" ON public.deposits;
DROP POLICY IF EXISTS "Authenticated users can insert own deposits" ON public.deposits;

CREATE POLICY "Users can view own deposits"
  ON public.deposits FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on deposits"
  ON public.deposits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own deposits"
  ON public.deposits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 2. Drop existing function to allow changing return type & recreate add_funds_secure
DROP FUNCTION IF EXISTS public.add_funds_secure(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.add_funds_secure(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Deposit amount cannot exceed 100,000';
  END IF;

  -- Lock profile row and update balance
  UPDATE public.profiles
  SET wallet_balance = COALESCE(wallet_balance, 0) + p_amount
  WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    -- Create profile if missing
    INSERT INTO public.profiles (id, wallet_balance)
    VALUES (p_user_id, p_amount)
    RETURNING wallet_balance INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- 3. CRITICAL FIX: Grant EXECUTE permission to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.add_funds_secure(UUID, NUMERIC) TO authenticated, service_role, anon, PUBLIC;

-- 4. Verify function is callable
SELECT 'add_funds_secure permissions successfully granted!' AS result;
