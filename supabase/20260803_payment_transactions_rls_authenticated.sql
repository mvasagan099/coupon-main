-- =============================================================================
-- Migration: Add RLS Policies for Authenticated Users on payment_transactions
-- RUN IN: Supabase Dashboard → SQL Editor → Run
-- =============================================================================

-- Allow authenticated users to insert their own transactions
DROP POLICY IF EXISTS "user_insert_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_insert_own_transactions"
  ON public.payment_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Allow authenticated users to update their own transactions (e.g. status updates)
DROP POLICY IF EXISTS "user_update_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_update_own_transactions"
  ON public.payment_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Ensure authenticated role has select, insert, update privileges
GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;
