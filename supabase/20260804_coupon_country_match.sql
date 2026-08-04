-- ============================================================
-- Migration: Add Country Code to Coupons & Enforce Lotto Game Redemption Lock
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

BEGIN;

-- 1. Add country_code column to coupons table
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS country_code CHAR(2);
CREATE INDEX IF NOT EXISTS idx_coupons_country_code ON public.coupons(country_code);

COMMENT ON COLUMN public.coupons.country_code IS 'ISO country code where coupon was issued. Required for redemption match.';

UPDATE public.coupons c
SET country_code = COALESCE(
  (SELECT p.country_code FROM public.profiles p WHERE p.id = c.issued_to),
  'US'
)
WHERE (c.country_code IS NULL OR c.country_code = '');


-- 2. Update issue_gift_card_coupon to record user's country_code on creation
CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
  p_gift_card_id UUID,
  p_user_id      UUID,
  p_amount       NUMERIC
)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id    UUID;
  v_prefix        TEXT;
  v_code          TEXT;
  v_coupon_id     UUID;
  v_order_id      UUID;
  v_expiry_date   TIMESTAMPTZ;
  v_country_code  CHAR(2);
  v_user_balance  NUMERIC;
  v_attempts      INTEGER := 0;
  v_max_attempts  INTEGER := 10;
BEGIN
  -- 1. Lock user profile and check wallet balance
  SELECT wallet_balance, country_code 
  INTO v_user_balance, v_country_code
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF COALESCE(v_user_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %', p_amount, COALESCE(v_user_balance, 0);
  END IF;

  v_country_code := COALESCE(v_country_code, 'US');

  -- 2. Fetch gift card details
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- 3. Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

  -- 4. Generate unique coupon code
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique coupon code';
    END IF;

    v_code := v_prefix || '-' || upper(
      translate(encode(gen_random_bytes(6), 'base64'), '+/=0OIl', 'ABCDEFG')
    );
    v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
  END LOOP;

  -- 5. Deduct wallet balance
  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  -- 6. Insert coupon with BOTH amount and remaining_balance set to p_amount
  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used, country_code
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false, v_country_code
  )
  RETURNING id INTO v_coupon_id;

  -- 7. Insert paid order record
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;


-- 3. Update redeem_game_coupon RPC function to enforce country match
CREATE OR REPLACE FUNCTION public.redeem_game_coupon(
  p_coupon_id UUID,
  p_game_user_id TEXT,
  p_game_id TEXT,
  p_wallet_transaction_id TEXT,
  p_ip_address TEXT,
  p_device TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_used         BOOLEAN;
  v_status          TEXT;
  v_coupon_country  TEXT;
  v_user_country    TEXT;
  v_user_uuid       UUID;
BEGIN
  -- Lock the row
  SELECT is_used, status, country_code INTO v_is_used, v_status, v_coupon_country
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  IF v_is_used THEN
    RAISE EXCEPTION 'Coupon already redeemed';
  END IF;

  IF v_status = 'DISABLED' OR v_status = 'disabled' THEN
    RAISE EXCEPTION 'Coupon disabled';
  END IF;

  -- Enforce country matching if game_user_id is a UUID matching a user profile
  BEGIN
    v_user_uuid := p_game_user_id::UUID;
    SELECT country_code INTO v_user_country
    FROM public.profiles
    WHERE id = v_user_uuid;

    IF v_coupon_country IS NOT NULL AND v_user_country IS NOT NULL AND v_coupon_country <> v_user_country THEN
      RAISE EXCEPTION 'Country mismatch: This coupon was issued for % and cannot be redeemed by an account in %', v_coupon_country, v_user_country;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Ignore if game_user_id is not a valid UUID string
  END;

  -- Mark as used
  UPDATE coupons SET is_used = true, status = 'redeemed', redeemed_at = now() WHERE id = p_coupon_id;

  -- Record redemption
  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;


-- 4. Update validate_coupon and validate_coupon_by_id RPCs to include country_code
DROP FUNCTION IF EXISTS public.validate_coupon(TEXT);

CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT)
RETURNS TABLE (
  coupon_id         UUID,
  company_name      TEXT,
  coupon_code       TEXT,
  is_used           BOOLEAN,
  issued_at         TIMESTAMPTZ,
  remaining_balance NUMERIC,
  expiry_date       TIMESTAMPTZ,
  status            TEXT,
  country_code      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    cu.id AS coupon_id,
    co.name AS company_name,
    cu.code AS coupon_code,
    cu.is_used,
    cu.created_at AS issued_at,
    COALESCE(NULLIF(cu.remaining_balance, 0), cu.amount, 0) AS remaining_balance,
    cu.expiry_date,
    cu.status,
    cu.country_code::TEXT
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE upper(trim(cu.code)) = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon code';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.validate_coupon_by_id(UUID);

CREATE OR REPLACE FUNCTION public.validate_coupon_by_id(p_coupon_id UUID)
RETURNS TABLE (
  coupon_id         UUID,
  company_name      TEXT,
  coupon_code       TEXT,
  is_used           BOOLEAN,
  issued_at         TIMESTAMPTZ,
  remaining_balance NUMERIC,
  expiry_date       TIMESTAMPTZ,
  status            TEXT,
  country_code      TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    cu.id AS coupon_id,
    co.name::TEXT AS company_name,
    cu.code::TEXT AS coupon_code,
    cu.is_used,
    cu.created_at AS issued_at,
    COALESCE(NULLIF(cu.remaining_balance, 0), cu.amount, 0) AS remaining_balance,
    cu.expiry_date,
    cu.status,
    cu.country_code::TEXT
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.id = p_coupon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon ID';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid, text, text, text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon_by_id(uuid) TO authenticated, anon;

COMMIT;
