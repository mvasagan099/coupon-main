-- =========================================================================
-- SECURE RLS FIX FOR gift_cards (V3 - Bulletproof)
-- =========================================================================

-- The implicit INSERT policy via FOR ALL USING (...) sometimes fails to evaluate correctly 
-- on new rows during INSERT. We explicitly define WITH CHECK to fix the "Gift card not publish" error.

DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;

-- Explicitly allow merchants to manage their own gift cards using a bulletproof IN subquery
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards 
FOR ALL 
USING (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
);
