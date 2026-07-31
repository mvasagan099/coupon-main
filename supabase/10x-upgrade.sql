-- =========================================================================
-- 10X UPGRADE: Secure Financial Transactions & Pagination
-- =========================================================================

-- 1. ADD FUNDS RPC
-- Safely adds money to a user's wallet.
CREATE OR REPLACE FUNCTION add_wallet_funds(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  -- Prevent users from adding funds to other users unless they are admins
  IF p_user_id != auth.uid() AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) = false THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  RETURN v_new_balance;
END;
$$;


-- 2. SECURE GIFT CARD ISSUANCE RPC
-- Atomically deducts wallet balance and issues the coupon to prevent double-spending.
CREATE OR REPLACE FUNCTION issue_gift_card_coupon(p_gift_card_id UUID, p_user_id UUID, p_amount NUMERIC)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_company_id    UUID;
  v_prefix        CHAR(3);
  v_code          TEXT;
  v_coupon_id     UUID;
  v_order_id      UUID;
  v_expiry_date   TIMESTAMPTZ;
  v_attempts      INTEGER := 0;
  v_max_attempts  INTEGER := 10;
  v_current_balance NUMERIC;
BEGIN
  -- Security check: Must be the user themselves
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 1. Lock the user's profile and check balance
  SELECT wallet_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  -- 2. Deduct the balance securely
  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  -- 3. Get gift card details
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- 4. Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  -- 5. Generate unique code
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

  -- 6. Insert coupon
  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  -- 7. Insert order
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;
