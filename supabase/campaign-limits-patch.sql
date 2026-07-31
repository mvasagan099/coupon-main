-- Add issue_limit to gift_cards table
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS issue_limit INTEGER CHECK (issue_limit > 0);

-- Update the stored procedure to enforce both campaign and company limits
CREATE OR REPLACE FUNCTION issue_gift_card_coupon(p_gift_card_id UUID, p_user_id UUID, p_amount NUMERIC)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id      UUID;
  v_prefix          CHAR(3);
  v_code            TEXT;
  v_coupon_id       UUID;
  v_order_id        UUID;
  v_expiry_date     TIMESTAMPTZ;
  v_issue_limit     INTEGER;
  v_company_limit   INTEGER;
  v_company_issued  INTEGER;
  v_campaign_issued INTEGER;
  v_attempts        INTEGER := 0;
  v_max_attempts    INTEGER := 10;
BEGIN
  -- Get gift card details
  SELECT company_id, expiry_date, issue_limit INTO v_company_id, v_expiry_date, v_issue_limit
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- Lock company to fetch prefix and limit
  SELECT prefix, coupon_limit INTO v_prefix, v_company_limit
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  -- 1. Check global company limit
  SELECT COUNT(*) INTO v_company_issued
  FROM coupons WHERE company_id = v_company_id;

  IF v_company_issued >= v_company_limit THEN
    RAISE EXCEPTION 'Global company card limit reached';
  END IF;

  -- 2. Check campaign-specific issue limit
  IF v_issue_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_campaign_issued
    FROM coupons WHERE gift_card_id = p_gift_card_id;

    IF v_campaign_issued >= v_issue_limit THEN
      RAISE EXCEPTION 'Campaign sold out (issue limit reached)';
    END IF;
  END IF;

  -- Generate unique code
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

  -- Insert coupon with original value as remaining balance
  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  -- Insert order
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;
