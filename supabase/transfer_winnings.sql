-- ============================================================
-- TRANSFER WINNINGS TO COUPON WALLET
-- ============================================================

-- Table to store incoming transfers for idempotency
CREATE TABLE IF NOT EXISTS public.wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_transaction_id ON public.wallet_transfers(transaction_id);

-- RLS Policies for wallet_transfers
ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_wallet_transfers" ON public.wallet_transfers;
CREATE POLICY "admin_all_wallet_transfers" ON public.wallet_transfers FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "user_view_own_transfers" ON public.wallet_transfers;
CREATE POLICY "user_view_own_transfers" ON public.wallet_transfers FOR SELECT USING (user_id = auth.uid());

-- Ensure profiles table has updated_at column to prevent trigger errors
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();


-- Function to atomically credit wallet balance and record transfer
DROP FUNCTION IF EXISTS transfer_winnings_to_wallet(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION transfer_winnings_to_wallet(
  p_user_email TEXT,
  p_amount NUMERIC,
  p_transaction_id TEXT
)
RETURNS TABLE (new_balance NUMERIC, transfer_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance NUMERIC;
  v_transfer_id UUID;
  v_user_uuid UUID;
BEGIN
  -- Look up user UUID by email from auth.users
  SELECT id INTO v_user_uuid FROM auth.users WHERE email = p_user_email LIMIT 1;

  IF v_user_uuid IS NULL THEN
    RAISE EXCEPTION 'User not found in Coupon platform for email: %', p_user_email;
  END IF;

  -- Insert into wallet_transfers to enforce idempotency (UNIQUE constraint handles duplicates)
  -- If it already exists, this will raise a unique_violation error
  INSERT INTO public.wallet_transfers (transaction_id, user_id, amount, status)
  VALUES (p_transaction_id, v_user_uuid, p_amount, 'SUCCESS')
  RETURNING id INTO v_transfer_id;

  -- Lock the profile row and update balance
  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = v_user_uuid
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  RETURN QUERY SELECT v_new_balance, v_transfer_id;
END;
$$;
