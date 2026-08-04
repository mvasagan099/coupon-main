-- ============================================================
-- Migration: Deduct Wallet Balance on Gift Card / Coupon Purchase
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

BEGIN;

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

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;

COMMIT;
