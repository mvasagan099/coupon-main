-- ============================================================
-- COUPON GENERATION SYSTEM - CLEAN SETUP SQL SCRIPT
-- WARNING: This will drop any existing tables to avoid conflict.
-- ============================================================

-- Drop conflicting tables from previous/alternate schemas
DROP TABLE IF EXISTS public.analytics CASCADE;
DROP TABLE IF EXISTS public.audit_logs CASCADE;
DROP TABLE IF EXISTS public.cashback_transactions CASCADE;
DROP TABLE IF EXISTS public.company_addresses CASCADE;
DROP TABLE IF EXISTS public.company_bank_details CASCADE;
DROP TABLE IF EXISTS public.company_documents CASCADE;
DROP TABLE IF EXISTS public.company_legal_details CASCADE;
DROP TABLE IF EXISTS public.company_staff CASCADE;
DROP TABLE IF EXISTS public.coupon_redemptions CASCADE;
DROP TABLE IF EXISTS public.notifications CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.referrals CASCADE;
DROP TABLE IF EXISTS public.subscription_plans CASCADE;
DROP TABLE IF EXISTS public.withdrawals CASCADE;

-- Drop primary application tables
DROP TABLE IF EXISTS public.redemptions CASCADE;
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.coupons CASCADE;
DROP TABLE IF EXISTS public.gift_cards CASCADE;
DROP TABLE IF EXISTS public.companies CASCADE;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance NUMERIC NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0)
);

CREATE TABLE companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  prefix      CHAR(3) NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
  coupon_limit INTEGER NOT NULL CHECK (coupon_limit > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_prefix_unique UNIQUE (prefix)
);

CREATE TABLE coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL,
  is_used     BOOLEAN NOT NULL DEFAULT false,
  issued_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code)
);

CREATE TABLE orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  coupon_id   UUID REFERENCES coupons(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_coupons_company_id ON coupons(company_id);
CREATE INDEX idx_coupons_issued_to  ON coupons(issued_to);
CREATE INDEX idx_orders_user_id     ON orders(user_id);
CREATE INDEX idx_orders_company_id  ON orders(company_id);
CREATE INDEX idx_orders_coupon_id   ON orders(coupon_id);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders    ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "admin_all_profiles"    ON profiles FOR ALL    USING (is_admin());
CREATE POLICY "user_view_profile"     ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "user_update_profile"   ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "user_insert_profile"   ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT raw_user_meta_data->>'role' = 'admin'
     FROM auth.users WHERE id = auth.uid()),
    false
  );
$$;

-- Companies: admins can do everything, users can read
CREATE POLICY "admin_all_companies"   ON companies FOR ALL    USING (is_admin());
CREATE POLICY "user_read_companies"   ON companies FOR SELECT USING (auth.uid() IS NOT NULL);

-- Coupons: admins see all; users see only their own
CREATE POLICY "admin_all_coupons"     ON coupons FOR ALL    USING (is_admin());
CREATE POLICY "user_own_coupons"      ON coupons FOR SELECT USING (issued_to = auth.uid());

-- Orders: admins see all; users see only their own
CREATE POLICY "admin_all_orders"      ON orders FOR ALL    USING (is_admin());
CREATE POLICY "user_own_orders"       ON orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_insert_orders"    ON orders FOR INSERT  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- STORED PROCEDURE: issue_coupon
-- Atomically checks limit, generates unique code, inserts coupon+order
-- ============================================================

DROP FUNCTION IF EXISTS issue_coupon(UUID, UUID);

-- Note: The function body below defines the core issue_coupon behavior for backward compatibility/initial schema compliance
CREATE OR REPLACE FUNCTION issue_coupon(p_company_id UUID, p_user_id UUID)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prefix        CHAR(3);
  v_limit         INTEGER;
  v_issued_count  INTEGER;
  v_code          TEXT;
  v_coupon_id     UUID;
  v_order_id      UUID;
  v_attempts      INTEGER := 0;
  v_max_attempts  INTEGER := 10;
BEGIN
  -- Lock the company row to prevent race conditions
  SELECT prefix, coupon_limit
  INTO   v_prefix, v_limit
  FROM   companies
  WHERE  id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- Count already issued coupons for this company
  SELECT COUNT(*) INTO v_issued_count
  FROM coupons WHERE company_id = p_company_id;

  IF v_issued_count >= v_limit THEN
    RAISE EXCEPTION 'Coupon limit reached for this company';
  END IF;

  -- Generate a unique coupon code with retry logic
  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique coupon code after % attempts', v_max_attempts;
    END IF;

    -- Generate: PREFIX-XXXXXXXX (8 chars from base36 alphabet, cryptographically random)
    v_code := v_prefix || '-' || upper(
      translate(
        encode(gen_random_bytes(6), 'base64'),
        '+/=0OIl', 'ABCDEFG'   -- replace ambiguous chars
      )
    );
    -- Keep only first 8 alphanumeric chars
    v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
  END LOOP;

  -- Insert coupon
  INSERT INTO coupons (company_id, code, issued_to)
  VALUES (p_company_id, v_code, p_user_id)
  RETURNING id INTO v_coupon_id;

  -- Insert order
  INSERT INTO orders (user_id, company_id, coupon_id, status)
  VALUES (p_user_id, p_company_id, v_coupon_id, 'paid')
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

-- ============================================================
-- FUNCTION: validate_coupon (for scan page)
-- ============================================================

CREATE OR REPLACE FUNCTION validate_coupon(p_code TEXT)
RETURNS TABLE (
  company_name  TEXT,
  coupon_code   TEXT,
  is_used       BOOLEAN,
  issued_at     TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    co.name,
    cu.code,
    cu.is_used,
    cu.created_at
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.code = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon code';
  END IF;
END;
$$;

-- ============================================================
-- FUNCTION: mark_coupon_used
-- ============================================================

CREATE OR REPLACE FUNCTION mark_coupon_used(p_code TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE coupons SET is_used = true, redeemed_at = now()
  WHERE code = upper(trim(p_code)) AND is_used = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found or already used';
  END IF;
END;
$$;

-- ============================================================
-- FUNCTION: validate_coupon_by_id (secure UUID validation)
-- Does NOT return the plaintext coupon code if it is not yet used!
-- ============================================================

CREATE OR REPLACE FUNCTION validate_coupon_by_id(p_coupon_id UUID)
RETURNS TABLE (
  company_name  TEXT,
  coupon_code   TEXT,
  is_used       BOOLEAN,
  issued_at     TIMESTAMPTZ
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    co.name::TEXT,
    CASE WHEN cu.is_used THEN cu.code ELSE NULL END::TEXT,
    cu.is_used,
    cu.created_at
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.id = p_coupon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon ID';
  END IF;
END;
$$;

-- ============================================================
-- FUNCTION: mark_coupon_used_by_id (secure UUID redemption)
-- Redeems the coupon and securely returns the plaintext code.
-- ============================================================

CREATE OR REPLACE FUNCTION mark_coupon_used_by_id(p_coupon_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  UPDATE coupons SET is_used = true, redeemed_at = now()
  WHERE id = p_coupon_id AND is_used = false
  RETURNING code INTO v_code;

  IF NOT FOUND THEN
    -- Check if it was already used
    SELECT code INTO v_code FROM coupons WHERE id = p_coupon_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Coupon not found';
    END IF;
  END IF;

  RETURN v_code;
END;
$$;

-- ============================================================
-- FUNCTION: admin_get_users
-- Fetches all registered users (admin-only, SECURITY DEFINER)
-- ============================================================

CREATE OR REPLACE FUNCTION admin_get_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  role TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify caller is admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT 
    u.id,
    u.email::TEXT,
    u.created_at,
    COALESCE(u.raw_user_meta_data->>'role', 'user')::TEXT
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;

-- ============================================================
-- EXTENDING CORE DATABASE FOR FULL GIFT CARD WEBSITE FLOW
-- ============================================================

-- Alter tables to add new columns
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create Gift Cards table
CREATE TABLE gift_cards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  value        NUMERIC NOT NULL CHECK (value > 0),
  price        NUMERIC NOT NULL CHECK (price >= 0),
  expiry_date  TIMESTAMPTZ,
  banner_image TEXT,
  terms        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Alter coupons to support gift card balance tracking and redemption fields
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired'));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

-- Alter orders to support gift cards and prices
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_details JSONB;

-- Create Redemptions table
CREATE TABLE redemptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id              UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  amount                 NUMERIC NOT NULL CHECK (amount > 0),
  remaining_balance_after NUMERIC NOT NULL CHECK (remaining_balance_after >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;

-- Recreate policies to support roles and onboarding status
DROP POLICY IF EXISTS "admin_all_companies" ON companies;
DROP POLICY IF EXISTS "user_read_companies" ON companies;
DROP POLICY IF EXISTS "owner_manage_company" ON companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;

CREATE POLICY "admin_all_companies" ON companies FOR ALL USING (is_admin());
CREATE POLICY "owner_manage_company" ON companies FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "public_read_approved_companies" ON companies FOR SELECT USING (status = 'approved' OR owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "admin_all_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "public_read_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;

CREATE POLICY "admin_all_gift_cards" ON gift_cards FOR ALL USING (is_admin());
CREATE POLICY "public_read_gift_cards" ON gift_cards FOR SELECT USING (true);
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards FOR ALL USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = gift_cards.company_id
      AND companies.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "admin_all_coupons" ON coupons;
DROP POLICY IF EXISTS "user_own_coupons" ON coupons;
DROP POLICY IF EXISTS "merchant_view_coupons" ON coupons;

CREATE POLICY "admin_all_coupons" ON coupons FOR ALL USING (is_admin());
CREATE POLICY "user_own_coupons" ON coupons FOR SELECT USING (issued_to = auth.uid());
CREATE POLICY "merchant_view_coupons" ON coupons FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = coupons.company_id
      AND companies.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "admin_all_redemptions" ON redemptions;
DROP POLICY IF EXISTS "user_view_redemptions" ON redemptions;
DROP POLICY IF EXISTS "merchant_manage_redemptions" ON redemptions;

CREATE POLICY "admin_all_redemptions" ON redemptions FOR ALL USING (is_admin());
CREATE POLICY "user_view_redemptions" ON redemptions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM coupons
    WHERE coupons.id = redemptions.coupon_id
      AND coupons.issued_to = auth.uid()
  )
);
CREATE POLICY "merchant_manage_redemptions" ON redemptions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM coupons
    JOIN companies ON companies.id = coupons.company_id
    WHERE coupons.id = redemptions.coupon_id
      AND companies.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "admin_all_orders" ON orders;
DROP POLICY IF EXISTS "user_own_orders" ON orders;
DROP POLICY IF EXISTS "user_insert_orders" ON orders;
DROP POLICY IF EXISTS "merchant_view_orders" ON orders;

CREATE POLICY "admin_all_orders" ON orders FOR ALL USING (is_admin());
CREATE POLICY "user_own_orders" ON orders FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user_insert_orders" ON orders FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "merchant_view_orders" ON orders FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = orders.company_id
      AND companies.owner_id = auth.uid()
  )
);

-- ============================================================
-- STORED PROCEDURE: issue_gift_card_coupon
-- ============================================================
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
BEGIN
  -- Get gift card details
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  -- Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

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

-- ============================================================
-- STORED PROCEDURE: redeem_coupon_amount
-- ============================================================
CREATE OR REPLACE FUNCTION redeem_coupon_amount(p_coupon_id UUID, p_amount NUMERIC)
RETURNS TABLE (remaining_balance NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_remaining_balance NUMERIC;
  v_status            TEXT;
  v_expiry_date       TIMESTAMPTZ;
  v_is_used           BOOLEAN;
BEGIN
  -- Get coupon details
  SELECT coupons.remaining_balance, coupons.status, coupons.expiry_date, coupons.is_used
  INTO v_remaining_balance, v_status, v_expiry_date, v_is_used
  FROM coupons
  WHERE id = p_coupon_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coupon not found';
  END IF;

  IF v_status = 'redeemed' OR v_is_used THEN
    RAISE EXCEPTION 'Coupon is already fully redeemed';
  END IF;

  IF v_expiry_date < now() THEN
    UPDATE coupons SET status = 'expired' WHERE id = p_coupon_id;
    RAISE EXCEPTION 'Coupon has expired';
  END IF;

  IF v_remaining_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient coupon balance. Available balance: %', v_remaining_balance;
  END IF;

  -- Deduct balance
  v_remaining_balance := v_remaining_balance - p_amount;
  IF v_remaining_balance = 0 THEN
    v_status := 'redeemed';
    v_is_used := true;
  ELSE
    v_status := 'active';
    v_is_used := false;
  END IF;

  -- Update coupon
  UPDATE coupons
  SET remaining_balance = v_remaining_balance,
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

-- ============================================================
-- FUNCTION: admin_get_purchased_coupons
-- ============================================================
DROP FUNCTION IF EXISTS admin_get_purchased_coupons();

CREATE OR REPLACE FUNCTION admin_get_purchased_coupons()
RETURNS TABLE (
  coupon_id UUID,
  coupon_code TEXT,
  company_name TEXT,
  is_used BOOLEAN,
  purchased_at TIMESTAMPTZ,
  user_id UUID,
  user_email TEXT,
  redeemed_at TIMESTAMPTZ,
  remaining_balance NUMERIC,
  status TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify caller is admin
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    c.id as coupon_id,
    c.code as coupon_code,
    co.name as company_name,
    c.is_used,
    c.created_at as purchased_at,
    u.id as user_id,
    u.email::TEXT as user_email,
    c.redeemed_at,
    c.remaining_balance,
    c.status
  FROM coupons c
  JOIN companies co ON co.id = c.company_id
  LEFT JOIN auth.users u ON u.id = c.issued_to
  ORDER BY c.created_at DESC;
END;
$$;

-- ============================================================
-- REALTIME & REPLICATION SETUP
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'coupons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE coupons;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'redemptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE redemptions;
  END IF;
END $$;
