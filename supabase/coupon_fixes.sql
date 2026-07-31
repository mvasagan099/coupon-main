-- 1. Fix the strict status check to allow lowercase 'active'
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_status_check;

-- Ensure all existing rows have a valid status so the constraint can be applied
UPDATE coupons SET status = 'active' WHERE status IS NULL OR status NOT IN ('ACTIVE', 'DISABLED', 'active', 'disabled');

ALTER TABLE coupons ADD CONSTRAINT coupons_status_check 
  CHECK (status IN ('ACTIVE', 'DISABLED', 'active', 'disabled'));

-- 2. Update the verification function to correctly read the gift card's remaining_balance!
CREATE OR REPLACE FUNCTION verify_game_coupon(p_code TEXT)
RETURNS TABLE (id UUID, code TEXT, is_used BOOLEAN, amount NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, 
         c.code, 
         c.is_used, 
         COALESCE(NULLIF(c.amount, 0), c.remaining_balance, 0) AS amount, 
         c.status
  FROM coupons c
  WHERE c.code = p_code;
END;
$$;
