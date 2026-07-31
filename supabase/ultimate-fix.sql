-- =========================================================================
-- ULTIMATE FIX: Run this once in your Supabase SQL Editor
-- =========================================================================

-- 1. Fix the 400 Bad Request by forcefully confirming the correct admin email
UPDATE auth.users 
SET email_confirmed_at = now() 
WHERE email = 'admin@123.com';

-- 2. Fix the 403 Forbidden on the companies table (The real culprit!)
-- The previous onboarding script hardcoded a query to auth.users in the RLS policy!
DROP POLICY IF EXISTS "admin_all_companies" ON public.companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON public.companies;

CREATE POLICY "admin_all_companies" ON public.companies FOR ALL USING (
  COALESCE((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false)
);

CREATE POLICY "public_read_approved_companies" ON public.companies FOR SELECT USING (
  status = 'approved' OR 
  owner_id = auth.uid() OR 
  COALESCE((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false)
);

-- 3. Also fix the is_admin helper globally just in case
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false);
$$;
