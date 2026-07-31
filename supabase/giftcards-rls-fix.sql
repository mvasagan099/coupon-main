-- =========================================================================
-- SECURE RLS FIX FOR gift_cards (V2)
-- =========================================================================

-- The implicit INSERT policy via FOR ALL USING (...) sometimes fails to evaluate correctly 
-- on new rows during INSERT. We explicitly define WITH CHECK to fix the "Gift card not publish" error.

DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;

-- Explicitly allow merchants to manage their own gift cards
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = gift_cards.company_id
      AND companies.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = gift_cards.company_id
      AND companies.owner_id = auth.uid()
  )
);
