-- Run this in your Supabase SQL Editor to fix Company Onboarding

-- 1. Ensure the companies table has all required onboarding columns
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Drop existing restrictive policies
DROP POLICY IF EXISTS "admin_all_companies" ON public.companies;
DROP POLICY IF EXISTS "user_read_companies" ON public.companies;
DROP POLICY IF EXISTS "owner_manage_company" ON public.companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON public.companies;

-- 3. Apply correct RLS policies so merchants can onboard securely
CREATE POLICY "admin_all_companies" ON public.companies FOR ALL USING (
  (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "owner_manage_company" ON public.companies FOR ALL USING (
  owner_id = auth.uid()
);

CREATE POLICY "public_read_approved_companies" ON public.companies FOR SELECT USING (
  status = 'approved' OR owner_id = auth.uid() OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

-- 4. Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
