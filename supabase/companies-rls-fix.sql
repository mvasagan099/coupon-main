-- =========================================================================
-- COMPLETE RLS FIX FOR public.companies
-- =========================================================================

-- 1. Ensure RLS is enabled
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- 2. Drop all existing messy policies to start fresh
DROP POLICY IF EXISTS "admin_all_companies" ON companies;
DROP POLICY IF EXISTS "owner_manage_company" ON companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;
DROP POLICY IF EXISTS "merchant_insert_company" ON companies;
DROP POLICY IF EXISTS "user_read_companies" ON companies;

-- 3. Create definitive, secure policies

-- A. ADMIN POLICY: Admins can do absolutely anything to any company
CREATE POLICY "admin_all_companies" 
ON companies FOR ALL 
USING (is_admin());

-- B. PUBLIC READ POLICY: Any authenticated user can view approved companies
CREATE POLICY "public_read_approved_companies" 
ON companies FOR SELECT 
USING (status = 'approved');

-- C. OWNER READ POLICY: Owners can view their own companies (even if pending/suspended)
CREATE POLICY "owner_read_company" 
ON companies FOR SELECT 
USING (owner_id = auth.uid());

-- D. OWNER UPDATE POLICY: Owners can update their own companies
CREATE POLICY "owner_update_company" 
ON companies FOR UPDATE 
USING (owner_id = auth.uid());

-- E. MERCHANT INSERT POLICY: Any logged-in user can submit an onboarding request,
-- provided they set themselves as the owner of the company.
CREATE POLICY "merchant_insert_company" 
ON companies FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL AND 
  owner_id = auth.uid()
);
