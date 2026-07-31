
-- ============================================================
-- INTEGRATION SCHEMA UPDATES
-- ============================================================

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  start_date  TIMESTAMPTZ,
  end_date    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alter coupons to add amount, status, campaign_id
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED'));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Coupon Redemptions
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id             UUID NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  game_user_id          TEXT NOT NULL,
  game_id               TEXT NOT NULL,
  wallet_transaction_id TEXT NOT NULL,
  ip_address            TEXT,
  device                TEXT,
  status                TEXT NOT NULL DEFAULT 'SUCCESS',
  redeemed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON coupon_redemptions(coupon_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_campaigns" ON campaigns;
CREATE POLICY "admin_all_campaigns" ON campaigns FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "admin_all_coupon_redemptions" ON coupon_redemptions;
CREATE POLICY "admin_all_coupon_redemptions" ON coupon_redemptions FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "public_read_campaigns" ON campaigns;
CREATE POLICY "public_read_campaigns" ON campaigns FOR SELECT USING (true); -- For API reading active campaigns

-- Function to redeem coupon atomically
CREATE OR REPLACE FUNCTION redeem_game_coupon(
  p_coupon_id UUID,
  p_game_user_id TEXT,
  p_game_id TEXT,
  p_wallet_transaction_id TEXT,
  p_ip_address TEXT,
  p_device TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_used BOOLEAN;
  v_status TEXT;
BEGIN
  -- Lock the row
  SELECT is_used, status INTO v_is_used, v_status
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  IF v_is_used THEN
    RAISE EXCEPTION 'Coupon already redeemed';
  END IF;

  IF v_status = 'DISABLED' THEN
    RAISE EXCEPTION 'Coupon disabled';
  END IF;

  -- Mark as used
  UPDATE coupons SET is_used = true WHERE id = p_coupon_id;

  -- Record redemption
  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;


-- Function to verify coupon bypassing RLS
CREATE OR REPLACE FUNCTION verify_game_coupon(p_code TEXT)
RETURNS TABLE (id UUID, code TEXT, is_used BOOLEAN, amount NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.code, c.is_used, c.amount, c.status
  FROM coupons c
  WHERE c.code = p_code;
END;
$$;
