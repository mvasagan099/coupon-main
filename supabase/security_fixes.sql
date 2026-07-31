-- ============================================================
-- SECURITY FIX: Withdrawal approvals must be manual (admin only)
-- CRIT-05 / HIGH: Removed auto-approve trigger that allowed any
-- withdrawal to complete without admin review.
--
-- Run this in Supabase SQL Editor to apply.
-- ============================================================

-- 1. Remove the dangerous auto-approve trigger
DROP TRIGGER IF EXISTS approve_withdrawal_trigger ON public.withdrawals;
DROP FUNCTION IF EXISTS public.auto_approve_withdrawal();

-- 2. Ensure the withdrawals table has proper RLS
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- 3. Users can only see their own withdrawals
DROP POLICY IF EXISTS "withdrawals_user_select" ON public.withdrawals;
CREATE POLICY "withdrawals_user_select"
  ON public.withdrawals FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Users can only INSERT their own withdrawals (status defaults to 'pending')
DROP POLICY IF EXISTS "withdrawals_user_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_user_insert"
  ON public.withdrawals FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'    -- Prevent users from self-approving
  );

-- 5. Only admins can UPDATE (approve/reject)
DROP POLICY IF EXISTS "withdrawals_admin_update" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_update"
  ON public.withdrawals FOR UPDATE
  USING (is_admin());

-- 6. Only admins can DELETE
DROP POLICY IF EXISTS "withdrawals_admin_delete" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_delete"
  ON public.withdrawals FOR DELETE
  USING (is_admin());

-- ============================================================
-- SECURITY FIX: is_admin() — read role from JWT claim
-- This prevents direct auth.users table queries that can 403
-- and avoids privilege escalation via metadata manipulation.
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- NOTE: The role claim should be stored in app_metadata (not user_metadata)
-- because app_metadata can only be updated by the service role key,
-- while user_metadata can be modified by the user themselves.
