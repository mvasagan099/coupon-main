-- =============================================================================
-- Create Deposits Table & Grant add_funds_secure Permissions
-- RUN IN: Supabase Dashboard → SQL Editor
-- =============================================================================

-- 1. Create deposits audit table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'PayPal',
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

-- Drop old policies if existing to avoid conflicts
DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Service role full access on deposits" ON public.deposits;

-- Users can view their own deposits
CREATE POLICY "Users can view own deposits"
  ON public.deposits FOR SELECT
  USING (auth.uid() = user_id);

-- Service role full access for Edge Functions
CREATE POLICY "Service role full access on deposits"
  ON public.deposits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Ensure add_funds_secure function exists and has proper permissions
CREATE OR REPLACE FUNCTION public.add_funds_secure(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Single transfer cannot exceed 100,000';
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    -- If user profile row does not exist yet, create it
    INSERT INTO profiles (id, wallet_balance)
    VALUES (p_user_id, p_amount);
  END IF;
END;
$$;

-- Revoke from public, grant to service_role only
REVOKE ALL ON FUNCTION public.add_funds_secure(UUID, NUMERIC) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.add_funds_secure(UUID, NUMERIC) TO service_role;
