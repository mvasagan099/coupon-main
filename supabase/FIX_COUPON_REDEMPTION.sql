-- ============================================================
-- Migration: Fix Coupon Creation & Redemption Issues
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

BEGIN;

-- 1. Ensure coupons status constraint allows 'redeemed' and all standard states
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_status_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_status_check 
  CHECK (status IN ('active', 'redeemed', 'expired', 'disabled', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'DISABLED'));

-- 2. Ensure both amount and remaining_balance columns exist and are synced
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

-- Backfill missing amounts or balances on existing coupons
UPDATE public.coupons
SET 
  amount = COALESCE(NULLIF(amount, 0), remaining_balance, 0),
  remaining_balance = COALESCE(NULLIF(remaining_balance, 0), amount, 0),
  status = COALESCE(status, 'active')
WHERE amount IS NULL OR remaining_balance IS NULL OR amount = 0 OR remaining_balance = 0;


-- 3. Rebuild issue_gift_card_coupon RPC to populate BOTH amount and remaining_balance
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
  v_attempts      INTEGER := 0;
  v_max_attempts  INTEGER := 10;
BEGIN
  -- Fetch gift card details
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

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

  -- Insert coupon with BOTH amount and remaining_balance set to p_amount
  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false
  )
  RETURNING id INTO v_coupon_id;

  -- Insert paid order record
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;


-- 4. Rebuild redeem_coupon_amount RPC function with fallbacks
CREATE OR REPLACE FUNCTION public.redeem_coupon_amount(p_coupon_id UUID, p_amount NUMERIC)
RETURNS TABLE (remaining_balance NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_remaining_balance NUMERIC;
  v_amount            NUMERIC;
  v_status            TEXT;
  v_expiry_date       TIMESTAMPTZ;
  v_is_used           BOOLEAN;
BEGIN
  -- Lock coupon row for update
  SELECT 
    COALESCE(coupons.remaining_balance, coupons.amount, 0),
    COALESCE(coupons.amount, coupons.remaining_balance, 0),
    coupons.status, coupons.expiry_date, coupons.is_used
  INTO v_remaining_balance, v_amount, v_status, v_expiry_date, v_is_used
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  -- If remaining_balance was 0 or null, set it to v_amount if available
  IF (v_remaining_balance IS NULL OR v_remaining_balance = 0) AND v_amount > 0 AND NOT v_is_used AND v_status != 'redeemed' THEN
    v_remaining_balance := v_amount;
  END IF;

  IF v_status = 'redeemed' OR v_is_used OR v_status = 'REDEEMED' THEN
    RAISE EXCEPTION 'Coupon is already fully redeemed';
  END IF;

  IF v_expiry_date IS NOT NULL AND v_expiry_date < now() THEN
    UPDATE coupons SET status = 'expired' WHERE id = p_coupon_id;
    RAISE EXCEPTION 'Coupon has expired';
  END IF;

  -- Default p_amount to full balance if 0 or null
  IF p_amount IS NULL OR p_amount <= 0 THEN
    p_amount := v_remaining_balance;
  END IF;

  IF v_remaining_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient coupon balance. Available balance: %', v_remaining_balance;
  END IF;

  -- Deduct balance
  v_remaining_balance := v_remaining_balance - p_amount;
  IF v_remaining_balance <= 0 THEN
    v_status := 'redeemed';
    v_is_used := true;
    v_remaining_balance := 0;
  ELSE
    v_status := 'active';
    v_is_used := false;
  END IF;

  -- Update coupon
  UPDATE coupons
  SET amount = COALESCE(coupons.amount, v_amount, p_amount),
      remaining_balance = v_remaining_balance,
      status = v_status,
      is_used = v_is_used,
      redeemed_at = CASE WHEN v_is_used THEN now() ELSE redeemed_at END
  WHERE id = p_coupon_id;

  -- Log redemption transaction
  INSERT INTO redemptions (coupon_id, amount, remaining_balance_after)
  VALUES (p_coupon_id, p_amount, v_remaining_balance);

  RETURN QUERY SELECT v_remaining_balance, v_status;
END;
$$;


-- 5. Rebuild validate_coupon and validate_coupon_by_id RPCs
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
  status            TEXT
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
    cu.status
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
  status            TEXT
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
    cu.status
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.id = p_coupon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon ID';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid, numeric) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon_by_id(uuid) TO authenticated, anon;

COMMIT;
