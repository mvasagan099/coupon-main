-- =========================================================================
-- FIX MISSING INSERT POLICY FOR MERCHANTS
-- =========================================================================

-- Merchants need to be able to submit their onboarding details to the live database!
-- Currently, they are blocked by Row-Level Security from inserting new companies.

CREATE POLICY "merchant_insert_company" ON public.companies FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL
);
