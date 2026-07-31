-- Fix: Update validate_coupon functions to return balance and status
-- These fields are required for the checkout and redemption flows

DROP FUNCTION IF EXISTS validate_coupon(TEXT);

CREATE OR REPLACE FUNCTION validate_coupon(p_code TEXT)
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
    cu.remaining_balance,
    cu.expiry_date,
    cu.status
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.code = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon code';
  END IF;
END;
$$;


DROP FUNCTION IF EXISTS validate_coupon_by_id(UUID);

CREATE OR REPLACE FUNCTION validate_coupon_by_id(p_coupon_id UUID)
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
    CASE WHEN cu.is_used THEN cu.code ELSE NULL END::TEXT AS coupon_code,
    cu.is_used,
    cu.created_at AS issued_at,
    cu.remaining_balance,
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
