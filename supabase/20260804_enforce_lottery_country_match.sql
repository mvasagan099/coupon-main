-- ============================================================
-- Migration: Enforce Country Matching for Lottery Coupon Redemption
-- File: supabase/20260804_enforce_lottery_country_match.sql
-- ============================================================

BEGIN;

-- Helper to normalize country names and codes to 2-letter ISO codes
CREATE OR REPLACE FUNCTION public.normalize_country_code(p_country TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_clean TEXT;
BEGIN
  IF p_country IS NULL OR trim(p_country) = '' THEN
    RETURN NULL;
  END IF;
  v_clean := upper(trim(p_country));
  IF length(v_clean) = 2 THEN
    RETURN v_clean;
  END IF;

  CASE v_clean
    WHEN 'UNITED STATES', 'UNITED STATES OF AMERICA', 'USA' THEN RETURN 'US';
    WHEN 'INDIA', 'IND' THEN RETURN 'IN';
    WHEN 'AUSTRALIA', 'AUS' THEN RETURN 'AU';
    WHEN 'UNITED KINGDOM', 'GREAT BRITAIN', 'UK', 'GBR' THEN RETURN 'GB';
    WHEN 'CANADA', 'CAN' THEN RETURN 'CA';
    WHEN 'GERMANY', 'DEU' THEN RETURN 'DE';
    WHEN 'FRANCE', 'FRA' THEN RETURN 'FR';
    ELSE RETURN substring(v_clean from 1 for 2);
  END CASE;
END;
$$;

-- 1. Update verify_game_coupon to return country_code
DROP FUNCTION IF EXISTS public.verify_game_coupon(TEXT);

CREATE OR REPLACE FUNCTION public.verify_game_coupon(p_code TEXT)
RETURNS TABLE (
  id UUID,
  code TEXT,
  is_used BOOLEAN,
  amount NUMERIC,
  status TEXT,
  country_code TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.code,
    c.is_used,
    COALESCE(NULLIF(c.amount, 0), c.remaining_balance, 0) AS amount,
    c.status,
    public.normalize_country_code(COALESCE(c.country_code, p.country_code, p.country)) AS country_code
  FROM coupons c
  LEFT JOIN profiles p ON p.id = c.issued_to
  WHERE upper(trim(c.code)) = upper(trim(p_code));
END;
$$;

-- 2. Update redeem_game_coupon to accept user's account country and enforce country match
DROP FUNCTION IF EXISTS public.redeem_game_coupon(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.redeem_game_coupon(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.redeem_game_coupon(
  p_coupon_id UUID,
  p_game_user_id TEXT,
  p_game_id TEXT,
  p_wallet_transaction_id TEXT,
  p_ip_address TEXT,
  p_device TEXT,
  p_user_country TEXT DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_used         BOOLEAN;
  v_status          TEXT;
  v_coupon_country  TEXT;
  v_user_country    TEXT;
  v_user_uuid       UUID;
  v_issued_to       UUID;
BEGIN
  SELECT is_used, status, country_code, issued_to
  INTO v_is_used, v_status, v_coupon_country, v_issued_to
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

  -- Fallback: If coupon country_code is missing on coupon, resolve from issuer profile
  IF (v_coupon_country IS NULL OR trim(v_coupon_country) = '') AND v_issued_to IS NOT NULL THEN
    SELECT COALESCE(country_code, country) INTO v_coupon_country
    FROM public.profiles
    WHERE id = v_issued_to;
  END IF;

  v_coupon_country := public.normalize_country_code(v_coupon_country);
  v_user_country   := public.normalize_country_code(p_user_country);

  IF (v_user_country IS NULL) THEN
    BEGIN
      v_user_uuid := p_game_user_id::UUID;
      SELECT public.normalize_country_code(COALESCE(country_code, country)) INTO v_user_country
      FROM public.profiles
      WHERE id = v_user_uuid;
    EXCEPTION WHEN OTHERS THEN
      v_user_country := NULL;
    END;
  END IF;

  IF v_coupon_country IS NOT NULL THEN
    IF v_user_country IS NULL OR v_coupon_country <> v_user_country THEN
      RAISE EXCEPTION 'Country mismatch: This coupon was issued for % and cannot be redeemed by an account in %', v_coupon_country, COALESCE(v_user_country, 'UNKNOWN');
    END IF;
  END IF;

  UPDATE coupons SET is_used = true, status = 'redeemed', redeemed_at = now() WHERE id = p_coupon_id;

  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_game_coupon(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid, text, text, text, text, text, text) TO authenticated, anon;

-- Ensure coupons table allows SELECT for verification and redemption API calls
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
CREATE POLICY "Allow select coupons for verification" ON public.coupons FOR SELECT USING (true);
GRANT SELECT ON public.coupons TO anon, authenticated, service_role;

COMMIT;
