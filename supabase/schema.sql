-- -- ============================================================
-- -- COUPON GENERATION SYSTEM - COMPLETE DATABASE SCHEMA
-- -- ============================================================

-- -- Enable UUID extension
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -- ============================================================
-- -- TABLES
-- -- ============================================================

-- CREATE TABLE companies (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   name        TEXT NOT NULL,
--   prefix      CHAR(3) NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
--   coupon_limit INTEGER NOT NULL CHECK (coupon_limit > 0),
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
--   CONSTRAINT companies_prefix_unique UNIQUE (prefix)
-- );

-- CREATE TABLE coupons (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
--   code        TEXT NOT NULL,
--   is_used     BOOLEAN NOT NULL DEFAULT false,
--   issued_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
--   CONSTRAINT coupons_code_unique UNIQUE (code)
-- );

-- CREATE TABLE orders (
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
--   company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
--   coupon_id   UUID REFERENCES coupons(id) ON DELETE SET NULL,
--   status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
-- );

-- -- Prevent a user from ordering multiple coupons from the same company
-- CREATE UNIQUE INDEX orders_user_company_unique
--   ON orders(user_id, company_id)
--   WHERE status = 'paid';

-- -- ============================================================
-- -- INDEXES
-- -- ============================================================

-- CREATE INDEX idx_coupons_company_id ON coupons(company_id);
-- CREATE INDEX idx_coupons_issued_to  ON coupons(issued_to);
-- CREATE INDEX idx_orders_user_id     ON orders(user_id);
-- CREATE INDEX idx_orders_company_id  ON orders(company_id);
-- CREATE INDEX idx_orders_coupon_id   ON orders(coupon_id);

-- -- ============================================================
-- -- ROW-LEVEL SECURITY
-- -- ============================================================

-- ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE coupons   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders    ENABLE ROW LEVEL SECURITY;

-- -- Helper: is the current user an admin?
-- CREATE OR REPLACE FUNCTION is_admin()
-- RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
--   SELECT COALESCE(
--     (SELECT raw_user_meta_data->>'role' = 'admin'
--      FROM auth.users WHERE id = auth.uid()),
--     false
--   );
-- $$;

-- -- Companies: admins can do everything, users can read
-- CREATE POLICY "admin_all_companies"   ON companies FOR ALL    USING (is_admin());
-- CREATE POLICY "user_read_companies"   ON companies FOR SELECT USING (auth.uid() IS NOT NULL);

-- -- Coupons: admins see all; users see only their own
-- CREATE POLICY "admin_all_coupons"     ON coupons FOR ALL    USING (is_admin());
-- CREATE POLICY "user_own_coupons"      ON coupons FOR SELECT USING (issued_to = auth.uid());

-- -- Orders: admins see all; users see only their own
-- CREATE POLICY "admin_all_orders"      ON orders FOR ALL    USING (is_admin());
-- CREATE POLICY "user_own_orders"       ON orders FOR SELECT USING (user_id = auth.uid());
-- CREATE POLICY "user_insert_orders"    ON orders FOR INSERT  WITH CHECK (user_id = auth.uid());

-- -- ============================================================
-- -- STORED PROCEDURE: issue_coupon
-- -- Atomically checks limit, generates unique code, inserts coupon+order
-- -- ============================================================

-- CREATE OR REPLACE FUNCTION issue_coupon(p_company_id UUID, p_user_id UUID)
-- RETURNS TABLE (coupon_code TEXT, order_id UUID)
-- LANGUAGE plpgsql SECURITY DEFINER AS $$
-- DECLARE
--   v_prefix        CHAR(3);
--   v_limit         INTEGER;
--   v_issued_count  INTEGER;
--   v_code          TEXT;
--   v_coupon_id     UUID;
--   v_order_id      UUID;
--   v_attempts      INTEGER := 0;
--   v_max_attempts  INTEGER := 10;
-- BEGIN
--   -- Lock the company row to prevent race conditions
--   SELECT prefix, coupon_limit
--   INTO   v_prefix, v_limit
--   FROM   companies
--   WHERE  id = p_company_id
--   FOR UPDATE;

--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Company not found';
--   END IF;

--   -- Count already issued coupons for this company
--   SELECT COUNT(*) INTO v_issued_count
--   FROM coupons WHERE company_id = p_company_id;

--   IF v_issued_count >= v_limit THEN
--     RAISE EXCEPTION 'Coupon limit reached for this company';
--   END IF;

--   -- Check if user already has a coupon for this company (idempotency)
--   SELECT c.code, o.id
--   INTO   v_code, v_order_id
--   FROM   orders o
--   JOIN   coupons c ON c.id = o.coupon_id
--   WHERE  o.user_id = p_user_id
--     AND  o.company_id = p_company_id
--     AND  o.status = 'paid';

--   IF FOUND THEN
--     -- Return existing coupon (idempotent)
--     RETURN QUERY SELECT v_code, v_order_id;
--     RETURN;
--   END IF;

--   -- Generate a unique coupon code with retry logic
--   LOOP
--     v_attempts := v_attempts + 1;
--     IF v_attempts > v_max_attempts THEN
--       RAISE EXCEPTION 'Could not generate unique coupon code after % attempts', v_max_attempts;
--     END IF;

--     -- Generate: PREFIX-XXXXXXXX (8 chars from base36 alphabet, cryptographically random)
--     v_code := v_prefix || '-' || upper(
--       translate(
--         encode(gen_random_bytes(6), 'base64'),
--         '+/=0OIl', 'ABCDEFG'   -- replace ambiguous chars
--       )
--     );
--     -- Keep only first 8 alphanumeric chars
--     v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);

--     EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
--   END LOOP;

--   -- Insert coupon
--   INSERT INTO coupons (company_id, code, issued_to)
--   VALUES (p_company_id, v_code, p_user_id)
--   RETURNING id INTO v_coupon_id;

--   -- Insert order
--   INSERT INTO orders (user_id, company_id, coupon_id, status)
--   VALUES (p_user_id, p_company_id, v_coupon_id, 'paid')
--   RETURNING id INTO v_order_id;

--   RETURN QUERY SELECT v_code, v_order_id;
-- END;
-- $$;

-- -- ============================================================
-- -- FUNCTION: validate_coupon (for scan page)
-- -- ============================================================

-- CREATE OR REPLACE FUNCTION validate_coupon(p_code TEXT)
-- RETURNS TABLE (
--   company_name  TEXT,
--   coupon_code   TEXT,
--   is_used       BOOLEAN,
--   issued_at     TIMESTAMPTZ
-- )
-- LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   RETURN QUERY
--   SELECT
--     co.name,
--     cu.code,
--     cu.is_used,
--     cu.created_at
--   FROM coupons cu
--   JOIN companies co ON co.id = cu.company_id
--   WHERE cu.code = upper(trim(p_code));

--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Invalid coupon code';
--   END IF;
-- END;
-- $$;

-- -- ============================================================
-- -- FUNCTION: mark_coupon_used
-- -- ============================================================

-- CREATE OR REPLACE FUNCTION mark_coupon_used(p_code TEXT)
-- RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
-- BEGIN
--   UPDATE coupons SET is_used = true
--   WHERE code = upper(trim(p_code)) AND is_used = false;

--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Coupon not found or already used';
--   END IF;
-- END;
-- $$;

-- -- ============================================================
-- -- SEED: admin user role helper
-- -- After creating admin user via Supabase Auth, run:
-- --   UPDATE auth.users SET raw_user_meta_data = '{"role":"admin"}'
-- --   WHERE email = 'admin@yourapp.com';
-- -- ============================================================
-- ============================================================
-- COUPON GENERATION SYSTEM - COMPLETE DATABASE SCHEMA
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance NUMERIC NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0)
);

CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  prefix      CHAR(3) NOT NULL CHECK (prefix ~ '^[A-Z]{3}$'),
  coupon_limit INTEGER NOT NULL CHECK (coupon_limit > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_prefix_unique UNIQUE (prefix)
);

CREATE TABLE IF NOT EXISTS coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  code        TEXT NOT NULL,
  is_used     BOOLEAN NOT NULL DEFAULT false,
  issued_to   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  coupon_id   UUID REFERENCES coupons(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (Removed to allow users to purchase multiple coupons from the same company)
-- CREATE UNIQUE INDEX IF NOT EXISTS orders_user_company_unique
--   ON orders(user_id, company_id)
--   WHERE status = 'paid';

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_coupons_company_id ON coupons(company_id);
CREATE INDEX IF NOT EXISTS idx_coupons_issued_to  ON coupons(issued_to);
CREATE INDEX IF NOT EXISTS idx_orders_user_id     ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_id  ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_coupon_id   ON orders(coupon_id);

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
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
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

  -- (Idempotency check removed to allow purchasing multiple coupons of the same company)

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
-- SEED: admin user role helper
-- After creating admin user via Supabase Auth, run:
--   UPDATE auth.users SET raw_user_meta_data = '{"role":"admin"}'
--   WHERE email = 'admin@yourapp.com';
-- ============================================================


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

-- Alter tables to add new columns if they do not exist
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
CREATE TABLE IF NOT EXISTS gift_cards (
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

-- Alter coupons to support gift card balance tracking
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired'));

-- Alter orders to support gift cards and prices
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_details JSONB;

-- Create Redemptions table
CREATE TABLE IF NOT EXISTS redemptions (
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
END $$;- -   C r e a t e   S e t t l e m e n t s   t a b l e  
 C R E A T E   T A B L E   I F   N O T   E X I S T S   s e t t l e m e n t s   (  
     i d                                     U U I D   P R I M A R Y   K E Y   D E F A U L T   g e n _ r a n d o m _ u u i d ( ) ,  
     c o m p a n y _ i d                     U U I D   N O T   N U L L   R E F E R E N C E S   c o m p a n i e s ( i d )   O N   D E L E T E   C A S C A D E ,  
     p e r i o d _ m o n t h                 T E X T   N O T   N U L L ,   - -   F o r m a t :   Y Y Y Y - M M  
     t o t a l _ r e d e m p t i o n s       I N T E G E R   N O T   N U L L   D E F A U L T   0 ,  
     a m o u n t _ d u e                     N U M E R I C   N O T   N U L L   D E F A U L T   0   C H E C K   ( a m o u n t _ d u e   > =   0 ) ,  
     s t a t u s                             T E X T   N O T   N U L L   D E F A U L T   ' p e n d i n g '   C H E C K   ( s t a t u s   I N   ( ' p e n d i n g ' ,   ' p a i d ' ) ) ,  
     c r e a t e d _ a t                     T I M E S T A M P T Z   N O T   N U L L   D E F A U L T   n o w ( ) ,  
     p a i d _ a t                           T I M E S T A M P T Z ,  
     U N I Q U E ( c o m p a n y _ i d ,   p e r i o d _ m o n t h )  
 ) ;  
  
 - -   E n a b l e   R L S  
 A L T E R   T A B L E   s e t t l e m e n t s   E N A B L E   R O W   L E V E L   S E C U R I T Y ;  
  
 - -   P o l i c i e s   f o r   S e t t l e m e n t s  
 - -   A d m i n s   c a n   d o   e v e r y t h i n g  
 C R E A T E   P O L I C Y   " a d m i n _ a l l _ s e t t l e m e n t s "   O N   s e t t l e m e n t s   F O R   A L L   U S I N G   ( i s _ a d m i n ( ) ) ;  
  
 - -   M e r c h a n t s   c a n   r e a d   t h e i r   o w n   s e t t l e m e n t s  
 C R E A T E   P O L I C Y   " m e r c h a n t _ r e a d _ o w n _ s e t t l e m e n t s "   O N   s e t t l e m e n t s   F O R   S E L E C T  
 U S I N G   (  
     c o m p a n y _ i d   I N   (  
         S E L E C T   i d   F R O M   c o m p a n i e s   W H E R E   o w n e r _ i d   =   a u t h . u i d ( )  
     )  
 ) ;  
  
 - -   F u n c t i o n   t o   g e n e r a t e   m o n t h l y   s e t t l e m e n t s  
 C R E A T E   O R   R E P L A C E   F U N C T I O N   g e n e r a t e _ m o n t h l y _ s e t t l e m e n t s ( p _ y e a r   I N T ,   p _ m o n t h   I N T )  
 R E T U R N S   I N T E G E R  
 L A N G U A G E   p l p g s q l   S E C U R I T Y   D E F I N E R   A S   $ $  
 D E C L A R E  
     v _ s t a r t _ d a t e   T I M E S T A M P T Z ;  
     v _ e n d _ d a t e   T I M E S T A M P T Z ;  
     v _ p e r i o d _ s t r   T E X T ;  
     v _ i n s e r t e d _ c o u n t   I N T E G E R   : =   0 ;  
 B E G I N  
     - -   C o n s t r u c t   d a t e s  
     v _ s t a r t _ d a t e   : =   m a k e _ d a t e ( p _ y e a r ,   p _ m o n t h ,   1 ) : : t i m e s t a m p t z ;  
     v _ e n d _ d a t e   : =   ( v _ s t a r t _ d a t e   +   i n t e r v a l   ' 1   m o n t h ' ) ;  
     v _ p e r i o d _ s t r   : =   t o _ c h a r ( v _ s t a r t _ d a t e ,   ' Y Y Y Y - M M ' ) ;  
  
     - -   I n s e r t   s e t t l e m e n t s   f o r   c o m p a n i e s   t h a t   h a d   r e d e m p t i o n s   i n   t h i s   p e r i o d  
     - -   a n d   h a v e n ' t   b e e n   s e t t l e d   y e t .  
     W I T H   m o n t h l y _ d a t a   A S   (  
         S E L E C T    
             c . c o m p a n y _ i d ,  
             C O U N T ( r . i d )   a s   r e d e m p t i o n _ c o u n t ,  
             S U M ( r . a m o u n t )   a s   t o t a l _ a m o u n t  
         F R O M   r e d e m p t i o n s   r  
         J O I N   c o u p o n s   c   O N   c . i d   =   r . c o u p o n _ i d  
         W H E R E   r . c r e a t e d _ a t   > =   v _ s t a r t _ d a t e    
             A N D   r . c r e a t e d _ a t   <   v _ e n d _ d a t e  
         G R O U P   B Y   c . c o m p a n y _ i d  
     )  
     I N S E R T   I N T O   s e t t l e m e n t s   ( c o m p a n y _ i d ,   p e r i o d _ m o n t h ,   t o t a l _ r e d e m p t i o n s ,   a m o u n t _ d u e ,   s t a t u s )  
     S E L E C T    
         m d . c o m p a n y _ i d ,    
         v _ p e r i o d _ s t r ,    
         m d . r e d e m p t i o n _ c o u n t ,    
         m d . t o t a l _ a m o u n t ,    
         ' p e n d i n g '  
     F R O M   m o n t h l y _ d a t a   m d  
     W H E R E   N O T   E X I S T S   (  
         S E L E C T   1   F R O M   s e t t l e m e n t s   s    
         W H E R E   s . c o m p a n y _ i d   =   m d . c o m p a n y _ i d   A N D   s . p e r i o d _ m o n t h   =   v _ p e r i o d _ s t r  
     ) ;  
  
     G E T   D I A G N O S T I C S   v _ i n s e r t e d _ c o u n t   =   R O W _ C O U N T ;  
      
     R E T U R N   v _ i n s e r t e d _ c o u n t ;  
 E N D ;  
 $ $ ;  
 

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

CREATE POLICY "admin_all_campaigns" ON campaigns FOR ALL USING (is_admin());
CREATE POLICY "admin_all_coupon_redemptions" ON coupon_redemptions FOR ALL USING (is_admin());
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
