-- Fix: Ensure the merchant can delete gift cards and ensure foreign keys allow it
-- This handles cases where old constraints blocked deletion or RLS was out of sync

-- 1. Ensure foreign keys for coupons and orders gracefully handle campaign deletion
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_gift_card_id_fkey;
ALTER TABLE coupons ADD CONSTRAINT coupons_gift_card_id_fkey 
  FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_gift_card_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_gift_card_id_fkey 
  FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE SET NULL;

-- 2. Drop all conflicting policies on gift_cards
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_delete_gift_cards" ON gift_cards;

-- 3. Create a dedicated robust policy for ALL actions (including DELETE)
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards FOR ALL USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = gift_cards.company_id
      AND companies.owner_id = auth.uid()
  )
);
