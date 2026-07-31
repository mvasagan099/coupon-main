-- =============================================================================
-- FIX for issue_gift_card_coupon
-- Removes the incorrect "is_active" check from the gift_cards query since the table 
-- doesn't have this column, resolving the "Gateway error: column is_active does not exist".
-- =============================================================================

CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
  p_gift_card_id UUID,
  p_user_id      UUID,
  p_amount       NUMERIC  -- accepted for API compatibility but IGNORED; real price is looked up
)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id      UUID;
  v_prefix          CHAR(3);
  v_code            TEXT;
  v_coupon_id       UUID;
  v_order_id        UUID;
  v_expiry_date     TIMESTAMPTZ;
  v_attempts        INTEGER := 0;
  v_max_attempts    INTEGER := 10;
  v_current_balance NUMERIC;
  v_real_price      NUMERIC;  -- HIGH-02: authoritative price from gift_cards table
BEGIN
  -- Security: caller must be the beneficiary
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- HIGH-02: Look up the real price BEFORE any balance check.
  -- p_amount from the client is ignored; v_real_price is canonical.
  SELECT price, company_id, expiry_date
    INTO v_real_price, v_company_id, v_expiry_date
  FROM gift_cards
  WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  IF v_real_price IS NULL OR v_real_price <= 0 THEN
    RAISE EXCEPTION 'Gift card has no valid price';
  END IF;

  -- Lock the user's profile and check balance against the real price
  SELECT wallet_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_balance < v_real_price THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  -- Deduct the REAL price (not the client-supplied amount)
  UPDATE profiles
  SET wallet_balance = wallet_balance - v_real_price
  WHERE id = p_user_id;

  -- Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  -- Generate unique coupon code
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

  -- Insert coupon with the REAL price as remaining_balance
  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id,
          v_real_price,  -- HIGH-02: real price, not p_amount
          COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  -- Insert order with the real price
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid',
          v_real_price)  -- HIGH-02: real price, not p_amount
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;
