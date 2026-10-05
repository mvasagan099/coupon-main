-- SOURCE COVERAGE: additional files resolved by the included sections
-- 20260804_seed_all_exchange_rates.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- 20260803_country_currency_profile.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- is-admin-fix.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- clean_setup.sql: Excluded destructive table reset; schema.sql provides the base schema.
-- 20260804_deduct_wallet_on_purchase.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- CREATE_TEST_COUPONS.sql: Excluded sample/test data.
-- 20260804_country_locked_system.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- coupon_fixes.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- merchant-insert-fix.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- secure-rls-fix.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- giftcards-rls-fix.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- 20260803_payment_transactions.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- FIX_PAYPAL_DEPOSIT.sql: Superseded by deposits schema and server-only wallet credit; public money-minting grants excluded.
-- 20260803_exchange_rates_table.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- 10x-upgrade.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- validate-coupon-fix.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- 20260803_admin_withdrawals_country.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- wallet_profiles_setup.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- ultimate-fix.sql: Superseded by secure company policies and app_metadata admin checks; hard-coded admin update excluded.
-- fix-rls.sql: Superseded by the included schema, security, profile, payment, exchange-rate, country or redemption definitions.
-- archive/DANGEROUS_DO_NOT_RUN_auto_approve_withdrawals.sql: Excluded automatic withdrawal approval; approvals remain manual.

-- COUPONVAULT: ONE-QUERY SETUP FOR A NEW, EMPTY SUPABASE DATABASE
-- Generated from the user-supplied supabase.zip. Run this ENTIRE file in SQL Editor.
-- SQL database objects only. TypeScript Edge Functions require separate deployment.
-- Run once. An existing application schema is rejected to avoid overwriting data.
-- No reset, example coupons, forced admin account, or auto-approved withdrawals.
-- Exchange rates are the supplied static seed values, not live market rates.
-- Conflicting historical definitions are resolved by the final section.
BEGIN;
SET LOCAL search_path = public, extensions;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public'
   AND table_name IN ('profiles','companies','coupons','orders','gift_cards',
     'campaigns','coupon_redemptions','withdrawals','deposits','settlements',
     'payment_transactions','exchange_rates','support_tickets','support_messages','wallet_transfers','redemptions')) THEN
   RAISE EXCEPTION 'This setup requires a new, empty application database. No changes applied.';
 END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE((auth.jwt()->'app_metadata'->>'role')='admin',false);
$$;

-- SOURCE: supabase/schema.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

CREATE INDEX IF NOT EXISTS idx_coupons_company_id ON coupons(company_id);
CREATE INDEX IF NOT EXISTS idx_coupons_issued_to  ON coupons(issued_to);
CREATE INDEX IF NOT EXISTS idx_orders_user_id     ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_id  ON orders(company_id);
CREATE INDEX IF NOT EXISTS idx_orders_coupon_id   ON orders(coupon_id);

ALTER TABLE profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons   ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_profiles" ON profiles;
CREATE POLICY "admin_all_profiles"    ON profiles FOR ALL    USING (is_admin());
DROP POLICY IF EXISTS "user_view_profile" ON profiles;
CREATE POLICY "user_view_profile"     ON profiles FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS "user_update_profile" ON profiles;
CREATE POLICY "user_update_profile"   ON profiles FOR UPDATE USING (id = auth.uid());
DROP POLICY IF EXISTS "user_insert_profile" ON profiles;
CREATE POLICY "user_insert_profile"   ON profiles FOR INSERT WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

DROP POLICY IF EXISTS "admin_all_companies" ON companies;
CREATE POLICY "admin_all_companies"   ON companies FOR ALL    USING (is_admin());
DROP POLICY IF EXISTS "user_read_companies" ON companies;
CREATE POLICY "user_read_companies"   ON companies FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "admin_all_coupons" ON coupons;
CREATE POLICY "admin_all_coupons"     ON coupons FOR ALL    USING (is_admin());
DROP POLICY IF EXISTS "user_own_coupons" ON coupons;
CREATE POLICY "user_own_coupons"      ON coupons FOR SELECT USING (issued_to = auth.uid());

DROP POLICY IF EXISTS "admin_all_orders" ON orders;
CREATE POLICY "admin_all_orders"      ON orders FOR ALL    USING (is_admin());
DROP POLICY IF EXISTS "user_own_orders" ON orders;
CREATE POLICY "user_own_orders"       ON orders FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "user_insert_orders" ON orders;
CREATE POLICY "user_insert_orders"    ON orders FOR INSERT  WITH CHECK (user_id = auth.uid());

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
  SELECT prefix, coupon_limit
  INTO   v_prefix, v_limit
  FROM   companies
  WHERE  id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT COUNT(*) INTO v_issued_count
  FROM coupons WHERE company_id = p_company_id;

  IF v_issued_count >= v_limit THEN
    RAISE EXCEPTION 'Coupon limit reached for this company';
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique coupon code after % attempts', v_max_attempts;
    END IF;

    v_code := v_prefix || '-' || upper(
      translate(
        encode(gen_random_bytes(6), 'base64'),
        '+/=0OIl', 'ABCDEFG'   -- replace ambiguous chars
      )
    );
    v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);

    EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
  END LOOP;

  INSERT INTO coupons (company_id, code, issued_to)
  VALUES (p_company_id, v_code, p_user_id)
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, status)
  VALUES (p_user_id, p_company_id, v_coupon_id, 'paid')
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION mark_coupon_used_by_id(p_coupon_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code TEXT;
BEGIN
  UPDATE coupons SET is_used = true, redeemed_at = now()
  WHERE id = p_coupon_id AND is_used = false
  RETURNING code INTO v_code;

  IF NOT FOUND THEN
    SELECT code INTO v_code FROM coupons WHERE id = p_coupon_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Coupon not found';
    END IF;
  END IF;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  role TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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

ALTER TABLE companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

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

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES gift_cards(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_details JSONB;

CREATE TABLE IF NOT EXISTS redemptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id              UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  amount                 NUMERIC NOT NULL CHECK (amount > 0),
  remaining_balance_after NUMERIC NOT NULL CHECK (remaining_balance_after >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_companies" ON companies;
DROP POLICY IF EXISTS "user_read_companies" ON companies;
DROP POLICY IF EXISTS "owner_manage_company" ON companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;

DROP POLICY IF EXISTS "admin_all_companies" ON companies;
CREATE POLICY "admin_all_companies" ON companies FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "owner_manage_company" ON companies;
CREATE POLICY "owner_manage_company" ON companies FOR ALL USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;
CREATE POLICY "public_read_approved_companies" ON companies FOR SELECT USING (status = 'approved' OR owner_id = auth.uid() OR is_admin());

DROP POLICY IF EXISTS "admin_all_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "public_read_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;

DROP POLICY IF EXISTS "admin_all_gift_cards" ON gift_cards;
CREATE POLICY "admin_all_gift_cards" ON gift_cards FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "public_read_gift_cards" ON gift_cards;
CREATE POLICY "public_read_gift_cards" ON gift_cards FOR SELECT USING (true);
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;
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

DROP POLICY IF EXISTS "admin_all_coupons" ON coupons;
CREATE POLICY "admin_all_coupons" ON coupons FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "user_own_coupons" ON coupons;
CREATE POLICY "user_own_coupons" ON coupons FOR SELECT USING (issued_to = auth.uid());
DROP POLICY IF EXISTS "merchant_view_coupons" ON coupons;
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

DROP POLICY IF EXISTS "admin_all_redemptions" ON redemptions;
CREATE POLICY "admin_all_redemptions" ON redemptions FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "user_view_redemptions" ON redemptions;
CREATE POLICY "user_view_redemptions" ON redemptions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM coupons
    WHERE coupons.id = redemptions.coupon_id
      AND coupons.issued_to = auth.uid()
  )
);
DROP POLICY IF EXISTS "merchant_manage_redemptions" ON redemptions;
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

DROP POLICY IF EXISTS "admin_all_orders" ON orders;
CREATE POLICY "admin_all_orders" ON orders FOR ALL USING (is_admin());
DROP POLICY IF EXISTS "user_own_orders" ON orders;
CREATE POLICY "user_own_orders" ON orders FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "user_insert_orders" ON orders;
CREATE POLICY "user_insert_orders" ON orders FOR INSERT WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "merchant_view_orders" ON orders;
CREATE POLICY "merchant_view_orders" ON orders FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = orders.company_id
      AND companies.owner_id = auth.uid()
  )
);

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
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

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

  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

CREATE OR REPLACE FUNCTION redeem_coupon_amount(p_coupon_id UUID, p_amount NUMERIC)
RETURNS TABLE (remaining_balance NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_remaining_balance NUMERIC;
  v_status            TEXT;
  v_expiry_date       TIMESTAMPTZ;
  v_is_used           BOOLEAN;
BEGIN
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

  v_remaining_balance := v_remaining_balance - p_amount;
  IF v_remaining_balance = 0 THEN
    v_status := 'redeemed';
    v_is_used := true;
  ELSE
    v_status := 'active';
    v_is_used := false;
  END IF;

  UPDATE coupons
  SET remaining_balance = v_remaining_balance,
      status = v_status,
      is_used = v_is_used,
      redeemed_at = CASE WHEN v_is_used THEN now() ELSE redeemed_at END
  WHERE id = p_coupon_id;

  INSERT INTO redemptions (coupon_id, amount, remaining_balance_after)
  VALUES (p_coupon_id, p_amount, v_remaining_balance);

  RETURN QUERY SELECT v_remaining_balance, v_status;
END;
$$;

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


-- SOURCE: supabase/schema_update.sql
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  start_date  TIMESTAMPTZ,
  end_date    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED'));
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

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

DROP POLICY IF EXISTS "admin_all_campaigns" ON campaigns;
DROP POLICY IF EXISTS "admin_all_campaigns" ON campaigns;
CREATE POLICY "admin_all_campaigns" ON campaigns FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "admin_all_coupon_redemptions" ON coupon_redemptions;
DROP POLICY IF EXISTS "admin_all_coupon_redemptions" ON coupon_redemptions;
CREATE POLICY "admin_all_coupon_redemptions" ON coupon_redemptions FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "public_read_campaigns" ON campaigns;
DROP POLICY IF EXISTS "public_read_campaigns" ON campaigns;
CREATE POLICY "public_read_campaigns" ON campaigns FOR SELECT USING (true); -- For API reading active campaigns

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

  UPDATE coupons SET is_used = true WHERE id = p_coupon_id;

  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;

CREATE OR REPLACE FUNCTION verify_game_coupon(p_code TEXT)
RETURNS TABLE (id UUID, code TEXT, is_used BOOLEAN, amount NUMERIC, status TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.code, c.is_used, c.amount, c.status
  FROM coupons c
  WHERE c.code = p_code;
END;
$$;


-- SOURCE: supabase/campaign-limits-patch.sql
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS issue_limit INTEGER CHECK (issue_limit > 0);

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
  SELECT company_id, expiry_date, issue_limit INTO v_company_id, v_expiry_date, v_issue_limit
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  SELECT prefix, coupon_limit INTO v_prefix, v_company_limit
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_company_issued
  FROM coupons WHERE company_id = v_company_id;

  IF v_company_issued >= v_company_limit THEN
    RAISE EXCEPTION 'Global company card limit reached';
  END IF;

  IF v_issue_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_campaign_issued
    FROM coupons WHERE gift_card_id = p_gift_card_id;

    IF v_campaign_issued >= v_issue_limit THEN
      RAISE EXCEPTION 'Campaign sold out (issue limit reached)';
    END IF;
  END IF;

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

  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;


-- SOURCE: supabase/get_global_counts.sql
CREATE OR REPLACE FUNCTION get_gift_cards_with_counts()
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  price NUMERIC,
  value NUMERIC,
  company_id UUID,
  banner_image TEXT,
  terms TEXT,
  issue_limit INTEGER,
  expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  company_name TEXT,
  issued_count BIGINT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT 
    g.id,
    g.title,
    g.description,
    g.price,
    g.value,
    g.company_id,
    g.banner_image,
    g.terms,
    g.issue_limit,
    g.expiry_date,
    g.created_at,
    c.name AS company_name,
    (SELECT COUNT(*) FROM coupons cp WHERE cp.gift_card_id = g.id) AS issued_count
  FROM gift_cards g
  LEFT JOIN companies c ON c.id = g.company_id;
$$;


-- SOURCE: supabase/fix_profiles_table.sql
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance numeric NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_view_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_insert_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_update_profile" ON public.profiles;

DROP POLICY IF EXISTS "user_view_profile" ON public.profiles;
CREATE POLICY "user_view_profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "user_insert_profile" ON public.profiles;
CREATE POLICY "user_insert_profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "user_update_profile" ON public.profiles;
CREATE POLICY "user_update_profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profiles_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, wallet_balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

INSERT INTO public.profiles (id, wallet_balance)
SELECT id, 0.00
FROM auth.users
ON CONFLICT (id) DO NOTHING;


-- SOURCE: supabase/create_withdrawals.sql
CREATE TABLE IF NOT EXISTS withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL CHECK (amount > 0),
    routing_number TEXT NOT NULL,
    account_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_view_own_withdrawals" ON withdrawals;
CREATE POLICY "user_view_own_withdrawals" 
ON withdrawals 
FOR SELECT 
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_insert_own_withdrawals" ON withdrawals;
CREATE POLICY "user_insert_own_withdrawals" 
ON withdrawals 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "admin_all_withdrawals" ON withdrawals;
CREATE POLICY "admin_all_withdrawals" 
ON withdrawals 
FOR ALL 
USING (is_admin());


-- SOURCE: supabase/admin_withdrawals_setup.sql
CREATE OR REPLACE FUNCTION process_withdrawal_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_balance numeric;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT wallet_balance INTO v_current_balance
    FROM public.profiles
    WHERE id = NEW.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found';
    END IF;

    IF NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be positive';
    END IF;

    IF v_current_balance < NEW.amount THEN
      RAISE EXCEPTION 'Insufficient balance for withdrawal: have %, need %', v_current_balance, NEW.amount;
    END IF;

    UPDATE public.profiles
    SET wallet_balance = wallet_balance - NEW.amount
    WHERE id = NEW.user_id;

    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      UPDATE public.profiles
      SET wallet_balance = wallet_balance + OLD.amount
      WHERE id = NEW.user_id;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS handle_withdrawal_balance ON public.withdrawals;
CREATE TRIGGER handle_withdrawal_balance
  BEFORE INSERT OR UPDATE ON public.withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION process_withdrawal_balance();

CREATE OR REPLACE FUNCTION admin_get_withdrawals()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  amount numeric,
  routing_number text,
  account_number text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id,
    w.user_id,
    u.email::text,
    w.amount,
    w.routing_number,
    w.account_number,
    w.status,
    w.created_at
  FROM public.withdrawals w
  JOIN auth.users u ON w.user_id = u.id
  ORDER BY w.created_at DESC;
END;
$$;


-- SOURCE: supabase/create_deposits_table.sql
CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'PayPal',
  reference_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
DROP POLICY IF EXISTS "Service role full access on deposits" ON public.deposits;

DROP POLICY IF EXISTS "Users can view own deposits" ON public.deposits;
CREATE POLICY "Users can view own deposits"
  ON public.deposits FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access on deposits" ON public.deposits;
CREATE POLICY "Service role full access on deposits"
  ON public.deposits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.add_funds_secure(
  p_user_id UUID,
  p_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Single transfer cannot exceed 100,000';
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO profiles (id, wallet_balance)
    VALUES (p_user_id, p_amount);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_funds_secure(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_funds_secure(UUID, NUMERIC) TO service_role, authenticated;


-- SOURCE: supabase/transfer_winnings.sql
CREATE TABLE IF NOT EXISTS public.wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'SUCCESS',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transfers_transaction_id ON public.wallet_transfers(transaction_id);

ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_wallet_transfers" ON public.wallet_transfers;
DROP POLICY IF EXISTS "admin_all_wallet_transfers" ON public.wallet_transfers;
CREATE POLICY "admin_all_wallet_transfers" ON public.wallet_transfers FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "user_view_own_transfers" ON public.wallet_transfers;
DROP POLICY IF EXISTS "user_view_own_transfers" ON public.wallet_transfers;
CREATE POLICY "user_view_own_transfers" ON public.wallet_transfers FOR SELECT USING (user_id = auth.uid());

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DROP FUNCTION IF EXISTS transfer_winnings_to_wallet(TEXT, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION transfer_winnings_to_wallet(
  p_user_email TEXT,
  p_amount NUMERIC,
  p_transaction_id TEXT
)
RETURNS TABLE (new_balance NUMERIC, transfer_id UUID)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance NUMERIC;
  v_transfer_id UUID;
  v_user_uuid UUID;
BEGIN
  SELECT id INTO v_user_uuid FROM auth.users WHERE email = p_user_email LIMIT 1;

  IF v_user_uuid IS NULL THEN
    RAISE EXCEPTION 'User not found in Coupon platform for email: %', p_user_email;
  END IF;

  INSERT INTO public.wallet_transfers (transaction_id, user_id, amount, status)
  VALUES (p_transaction_id, v_user_uuid, p_amount, 'SUCCESS')
  RETURNING id INTO v_transfer_id;

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = v_user_uuid
  RETURNING wallet_balance INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  RETURN QUERY SELECT v_new_balance, v_transfer_id;
END;
$$;


-- SOURCE: supabase/settlements.sql
CREATE TABLE IF NOT EXISTS settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_month        TEXT NOT NULL, -- Format: YYYY-MM
  total_redemptions   INTEGER NOT NULL DEFAULT 0,
  amount_due          NUMERIC NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  UNIQUE(company_id, period_month)
);

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_settlements" ON settlements;
CREATE POLICY "admin_all_settlements" ON settlements FOR ALL USING (is_admin());

DROP POLICY IF EXISTS "merchant_read_own_settlements" ON settlements;
CREATE POLICY "merchant_read_own_settlements" ON settlements FOR SELECT
USING (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
);

CREATE OR REPLACE FUNCTION generate_monthly_settlements(p_year INT, p_month INT, p_company_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
  v_period_str TEXT;
  v_inserted_count INTEGER := 0;
BEGIN
  v_start_date := make_date(p_year, p_month, 1)::timestamptz;
  v_end_date := (v_start_date + interval '1 month');
  v_period_str := to_char(v_start_date, 'YYYY-MM');

  WITH monthly_data AS (
    SELECT 
      c.company_id,
      COUNT(r.id) as redemption_count,
      SUM(r.amount) as total_amount
    FROM redemptions r
    JOIN coupons c ON c.id = r.coupon_id
    WHERE r.created_at >= v_start_date 
      AND r.created_at < v_end_date
      AND (p_company_id IS NULL OR c.company_id = p_company_id)
    GROUP BY c.company_id
  )
  INSERT INTO settlements (company_id, period_month, total_redemptions, amount_due, status)
  SELECT 
    md.company_id, 
    v_period_str, 
    md.redemption_count, 
    md.total_amount, 
    'pending'
  FROM monthly_data md
  WHERE NOT EXISTS (
    SELECT 1 FROM settlements s 
    WHERE s.company_id = md.company_id AND s.period_month = v_period_str
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  RETURN v_inserted_count;
END;
$$;


-- SOURCE: supabase/support_system_migration.sql
CREATE TABLE IF NOT EXISTS support_tickets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email  TEXT,
  subject     TEXT         NOT NULL,
  status      TEXT         NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'closed')),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID         NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   TEXT         NOT NULL,
  message     TEXT         NOT NULL,
  is_admin    BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tickets" ON support_tickets;
CREATE POLICY "Users can view own tickets"
  ON support_tickets FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own tickets" ON support_tickets;
CREATE POLICY "Users can insert own tickets"
  ON support_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view messages on own tickets" ON support_messages;
CREATE POLICY "Users can view messages on own tickets"
  ON support_messages FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM support_tickets WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can send messages on own tickets" ON support_messages;
CREATE POLICY "Users can send messages on own tickets"
  ON support_messages FOR INSERT
  WITH CHECK (
    ticket_id IN (
      SELECT id FROM support_tickets WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all tickets" ON support_tickets;
CREATE POLICY "Admins can view all tickets"
  ON support_tickets FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

DROP POLICY IF EXISTS "Admins can update all tickets" ON support_tickets;
CREATE POLICY "Admins can update all tickets"
  ON support_tickets FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

DROP POLICY IF EXISTS "Admins can view all messages" ON support_messages;
CREATE POLICY "Admins can view all messages"
  ON support_messages FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

DROP POLICY IF EXISTS "Admins can insert messages" ON support_messages;
CREATE POLICY "Admins can insert messages"
  ON support_messages FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'service_role'
    OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );


-- SOURCE: supabase/fix_company_onboarding.sql
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "admin_all_companies" ON public.companies;
DROP POLICY IF EXISTS "user_read_companies" ON public.companies;
DROP POLICY IF EXISTS "owner_manage_company" ON public.companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON public.companies;

DROP POLICY IF EXISTS "admin_all_companies" ON public.companies;
CREATE POLICY "admin_all_companies" ON public.companies FOR ALL USING (
  (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

DROP POLICY IF EXISTS "owner_manage_company" ON public.companies;
CREATE POLICY "owner_manage_company" ON public.companies FOR ALL USING (
  owner_id = auth.uid()
);

DROP POLICY IF EXISTS "public_read_approved_companies" ON public.companies;
CREATE POLICY "public_read_approved_companies" ON public.companies FOR SELECT USING (
  status = 'approved' OR owner_id = auth.uid() OR (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;


-- SOURCE: supabase/companies-rls-fix.sql
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all_companies" ON companies;
DROP POLICY IF EXISTS "owner_manage_company" ON companies;
DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;
DROP POLICY IF EXISTS "merchant_insert_company" ON companies;
DROP POLICY IF EXISTS "user_read_companies" ON companies;

DROP POLICY IF EXISTS "admin_all_companies" ON companies;
CREATE POLICY "admin_all_companies" 
ON companies FOR ALL 
USING (is_admin());

DROP POLICY IF EXISTS "public_read_approved_companies" ON companies;
CREATE POLICY "public_read_approved_companies" 
ON companies FOR SELECT 
USING (status = 'approved');

DROP POLICY IF EXISTS "owner_read_company" ON companies;
CREATE POLICY "owner_read_company" 
ON companies FOR SELECT 
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "owner_update_company" ON companies;
CREATE POLICY "owner_update_company" 
ON companies FOR UPDATE 
USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "merchant_insert_company" ON companies;
CREATE POLICY "merchant_insert_company" 
ON companies FOR INSERT 
WITH CHECK (
  auth.uid() IS NOT NULL AND 
  owner_id = auth.uid()
);


-- SOURCE: supabase/delete-campaign-fix.sql
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_gift_card_id_fkey;
ALTER TABLE coupons ADD CONSTRAINT coupons_gift_card_id_fkey 
  FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_gift_card_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_gift_card_id_fkey 
  FOREIGN KEY (gift_card_id) REFERENCES gift_cards(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_delete_gift_cards" ON gift_cards;

DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards FOR ALL USING (
  EXISTS (
    SELECT 1 FROM companies
    WHERE companies.id = gift_cards.company_id
      AND companies.owner_id = auth.uid()
  )
);


-- SOURCE: supabase/giftcards-rls-fix-v3.sql
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;

DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON gift_cards;
CREATE POLICY "merchant_manage_gift_cards" ON gift_cards 
FOR ALL 
USING (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
)
WITH CHECK (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
);


-- SOURCE: supabase/drop-prefix-constraint.sql
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_prefix_check;


-- SOURCE: supabase/admin-get-users-fix.sql
CREATE OR REPLACE FUNCTION admin_get_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  role TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    u.created_at,
    COALESCE(
      u.raw_app_meta_data->>'role',
      u.raw_user_meta_data->>'role',
      'user'
    )::TEXT AS role
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;


-- SOURCE: supabase/security_fixes.sql
DROP TRIGGER IF EXISTS approve_withdrawal_trigger ON public.withdrawals;
DROP FUNCTION IF EXISTS public.auto_approve_withdrawal();

ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawals_user_select" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_user_select" ON public.withdrawals;
CREATE POLICY "withdrawals_user_select"
  ON public.withdrawals FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "withdrawals_user_insert" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_user_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_user_insert"
  ON public.withdrawals FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'    -- Prevent users from self-approving
  );

DROP POLICY IF EXISTS "withdrawals_admin_update" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_admin_update" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_update"
  ON public.withdrawals FOR UPDATE
  USING (is_admin());

DROP POLICY IF EXISTS "withdrawals_admin_delete" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_admin_delete" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_delete"
  ON public.withdrawals FOR DELETE
  USING (is_admin());

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;


-- SOURCE: supabase/20260730_security_hardening.sql
CREATE OR REPLACE FUNCTION set_user_admin_role(target_user_id uuid, make_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- runs with owner privileges, bypassing RLS
SET search_path = public
AS $$
BEGIN
  IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role assignment requires service_role';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data ||
    jsonb_build_object('role', CASE WHEN make_admin THEN 'admin' ELSE 'user' END)
  WHERE id = target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION block_user_metadata_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF (NEW.raw_user_meta_data ->> 'role') IS DISTINCT FROM (OLD.raw_user_meta_data ->> 'role') THEN
    IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
      NEW.raw_user_meta_data = NEW.raw_user_meta_data - 'role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_user_metadata_role_escalation ON auth.users;
CREATE TRIGGER prevent_user_metadata_role_escalation
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION block_user_metadata_role_escalation();

DROP POLICY IF EXISTS "admin_only" ON companies;
DROP POLICY IF EXISTS "admin_select_all" ON companies;
DROP POLICY IF EXISTS "admin_manage_all" ON companies;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
END;
$$;

ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their profile" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can update own profile" ON profiles;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own_except_balance" ON profiles;
CREATE POLICY "profiles_update_own_except_balance"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
  );

CREATE OR REPLACE FUNCTION deduct_wallet_balance(
  p_user_id uuid,
  p_amount   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- bypasses RLS, runs with owner privileges
SET search_path = public
AS $$
DECLARE
  v_current_balance numeric;
BEGIN
  SELECT wallet_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_current_balance, p_amount;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION add_funds_secure(
  p_user_id uuid,
  p_amount   numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Single transfer cannot exceed 100,000';
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
END;
$$;

DROP POLICY IF EXISTS "merchant_insert_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_update_own_gift_cards" ON gift_cards;

DROP POLICY IF EXISTS "merchant_insert_gift_cards" ON gift_cards;
CREATE POLICY "merchant_insert_gift_cards"
  ON gift_cards FOR INSERT
  WITH CHECK (
    company_id IN (
      SELECT id FROM companies
      WHERE owner_id = auth.uid()
      AND status = 'approved'  -- Only approved merchants can create gift cards
    )
  );

DROP POLICY IF EXISTS "merchant_update_own_gift_cards" ON gift_cards;
CREATE POLICY "merchant_update_own_gift_cards"
  ON gift_cards FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE owner_id = auth.uid()
      AND status = 'approved'
    )
  );

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_wallet_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION add_funds_secure(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION set_user_admin_role(uuid, boolean) TO service_role;


-- SOURCE: supabase/20260730_security_hardening_v2.sql
CREATE OR REPLACE FUNCTION lock_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    NEW.wallet_balance := OLD.wallet_balance;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_wallet_balance_immutability ON public.profiles;
CREATE TRIGGER enforce_wallet_balance_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION lock_wallet_balance();

REVOKE UPDATE (wallet_balance) ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "profiles_update_own_except_balance" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own"                ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.lock_wallet_balance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role') THEN
    NEW.wallet_balance := OLD.wallet_balance;
  END IF;
  RETURN NEW;
END;
$$;


-- SOURCE: supabase/20260731_fix_is_active_purchase.sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.lock_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role') NOT IN ('service_role', 'supabase_admin', 'postgres') THEN
    NEW.wallet_balance := OLD.wallet_balance;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_wallet_balance_immutability ON public.profiles;
CREATE TRIGGER enforce_wallet_balance_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_wallet_balance();

CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
  p_gift_card_id UUID,
  p_user_id      UUID,
  p_amount       NUMERIC   -- ignored; real price looked up server-side
)
RETURNS TABLE (coupon_code TEXT, order_id UUID, coupon_id UUID)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
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
  v_new_balance     NUMERIC;
  v_real_price      NUMERIC;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT price, company_id, expiry_date
    INTO v_real_price, v_company_id, v_expiry_date
  FROM gift_cards
  WHERE id = p_gift_card_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found or inactive';
  END IF;

  IF v_real_price IS NULL OR v_real_price <= 0 THEN
    RAISE EXCEPTION 'Gift card has no valid price';
  END IF;

  SELECT wallet_balance INTO v_current_balance
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet profile not found for user';
  END IF;

  IF v_current_balance < v_real_price THEN
    RAISE EXCEPTION 'Insufficient wallet balance: have %, need %',
      v_current_balance, v_real_price;
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance - v_real_price
  WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet deduction failed — 0 rows updated. '
      'Verify the lock_wallet_balance trigger allows the postgres role.';
  END IF;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  LOOP
    v_attempts := v_attempts + 1;
    IF v_attempts > v_max_attempts THEN
      RAISE EXCEPTION 'Could not generate unique coupon code after % attempts', v_max_attempts;
    END IF;
    v_code := v_prefix || '-' || upper(
      translate(encode(gen_random_bytes(6), 'base64'), '+/=0OIl', 'ABCDEFG')
    );
    v_code := v_prefix || '-' || substring(regexp_replace(v_code, '[^A-Z0-9]', '', 'g'), 1, 8);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM coupons WHERE code = v_code);
  END LOOP;

  INSERT INTO coupons (company_id, code, issued_to, gift_card_id,
                       remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id,
          v_real_price, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', v_real_price)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

DROP FUNCTION IF EXISTS public.get_gift_cards_with_counts();
CREATE FUNCTION public.get_gift_cards_with_counts()
RETURNS TABLE (
  id UUID, title TEXT, description TEXT, price NUMERIC, value NUMERIC,
  company_id UUID, banner_image TEXT, terms TEXT, issue_limit INTEGER,
  expiry_date TIMESTAMPTZ, created_at TIMESTAMPTZ, company_name TEXT,
  issued_count BIGINT, is_active BOOLEAN
)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id, g.title, g.description, g.price, g.value, g.company_id,
    g.banner_image, g.terms, g.issue_limit, g.expiry_date, g.created_at,
    c.name AS company_name,
    (SELECT COUNT(*) FROM coupons cp WHERE cp.gift_card_id = g.id) AS issued_count,
    g.is_active
  FROM gift_cards g
  LEFT JOIN companies c ON c.id = g.company_id;
$$;

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet_balance(uuid, numeric)        TO authenticated;


-- SOURCE: supabase/20260730_security_crit02.sql
DO $$
DECLARE
  func RECORD;
BEGIN
  FOR func IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, authenticated',
      func.proname, func.args
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.add_wallet_funds(uuid, numeric);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_user_metadata_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.raw_user_meta_data ? 'role' THEN
    NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strip_role_from_user_metadata ON auth.users;
CREATE TRIGGER strip_role_from_user_metadata
  BEFORE UPDATE OF raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_user_metadata_role_escalation();

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
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT price, company_id, expiry_date
    INTO v_real_price, v_company_id, v_expiry_date
  FROM gift_cards
  WHERE id = p_gift_card_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found or inactive';
  END IF;

  IF v_real_price IS NULL OR v_real_price <= 0 THEN
    RAISE EXCEPTION 'Gift card has no valid price';
  END IF;

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

  UPDATE profiles
  SET wallet_balance = wallet_balance - v_real_price
  WHERE id = p_user_id;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

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

  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id,
          v_real_price,  -- HIGH-02: real price, not p_amount
          COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid',
          v_real_price)  -- HIGH-02: real price, not p_amount
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_purchased_coupons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_withdrawals() TO authenticated;

GRANT EXECUTE ON FUNCTION public.deduct_wallet_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_funds_secure(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_user_admin_role(uuid, boolean) TO service_role;


-- SOURCE: supabase/FIX_COUPON_REDEMPTION.sql
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_status_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_status_check 
  CHECK (status IN ('active', 'redeemed', 'expired', 'disabled', 'ACTIVE', 'REDEEMED', 'EXPIRED', 'DISABLED'));

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS amount NUMERIC DEFAULT 0;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

UPDATE public.coupons
SET 
  amount = COALESCE(NULLIF(amount, 0), remaining_balance, 0),
  remaining_balance = COALESCE(NULLIF(remaining_balance, 0), amount, 0),
  status = COALESCE(status, 'active')
WHERE amount IS NULL OR remaining_balance IS NULL OR amount = 0 OR remaining_balance = 0;

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
  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

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

  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false
  )
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

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

  IF p_amount IS NULL OR p_amount <= 0 THEN
    p_amount := v_remaining_balance;
  END IF;

  IF v_remaining_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient coupon balance. Available balance: %', v_remaining_balance;
  END IF;

  v_remaining_balance := v_remaining_balance - p_amount;
  IF v_remaining_balance <= 0 THEN
    v_status := 'redeemed';
    v_is_used := true;
    v_remaining_balance := 0;
  ELSE
    v_status := 'active';
    v_is_used := false;
  END IF;

  UPDATE coupons
  SET amount = COALESCE(coupons.amount, v_amount, p_amount),
      remaining_balance = v_remaining_balance,
      status = v_status,
      is_used = v_is_used,
      redeemed_at = CASE WHEN v_is_used THEN now() ELSE redeemed_at END
  WHERE id = p_coupon_id;

  INSERT INTO redemptions (coupon_id, amount, remaining_balance_after)
  VALUES (p_coupon_id, p_amount, v_remaining_balance);

  RETURN QUERY SELECT v_remaining_balance, v_status;
END;
$$;

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


-- SOURCE: supabase/20260803_add_paypal_email.sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paypal_email TEXT;


-- SOURCE: supabase/MASTER_MIGRATION.sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country            TEXT,
  ADD COLUMN IF NOT EXISTS country_code       CHAR(2),
  ADD COLUMN IF NOT EXISTS currency           CHAR(3)    DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone           TEXT,
  ADD COLUMN IF NOT EXISTS phone_country_code TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_country_code ON public.profiles(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_currency      ON public.profiles(currency);

GRANT UPDATE (country, country_code, currency, timezone, phone_country_code)
  ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.country            IS 'Full country name (e.g. India)';
COMMENT ON COLUMN public.profiles.country_code       IS 'ISO 3166-1 alpha-2 (e.g. IN) locked upon signup';
COMMENT ON COLUMN public.profiles.currency           IS 'ISO 4217 currency code (e.g. INR)';
COMMENT ON COLUMN public.profiles.timezone           IS 'IANA timezone string (e.g. Asia/Kolkata)';
COMMENT ON COLUMN public.profiles.phone_country_code IS 'Phone dial code (e.g. +91)';

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    wallet_balance,
    country,
    country_code,
    currency,
    timezone,
    phone_country_code
  )
  VALUES (
    NEW.id,
    0.00,
    NEW.raw_user_meta_data->>'country',
    NEW.raw_user_meta_data->>'country_code',
    NEW.raw_user_meta_data->>'currency',
    NEW.raw_user_meta_data->>'timezone',
    NEW.raw_user_meta_data->>'phone_country_code'
  )
  ON CONFLICT (id) DO UPDATE SET
    country            = COALESCE(EXCLUDED.country, public.profiles.country),
    country_code       = COALESCE(EXCLUDED.country_code, public.profiles.country_code),
    currency           = COALESCE(EXCLUDED.currency, public.profiles.currency),
    timezone           = COALESCE(EXCLUDED.timezone, public.profiles.timezone),
    phone_country_code = COALESCE(EXCLUDED.phone_country_code, public.profiles.phone_country_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

UPDATE public.profiles p
SET
  country            = COALESCE(p.country, u.raw_user_meta_data->>'country'),
  country_code       = COALESCE(p.country_code, u.raw_user_meta_data->>'country_code'),
  currency           = COALESCE(p.currency, u.raw_user_meta_data->>'currency'),
  timezone           = COALESCE(p.timezone, u.raw_user_meta_data->>'timezone'),
  phone_country_code = COALESCE(p.phone_country_code, u.raw_user_meta_data->>'phone_country_code')
FROM auth.users u
WHERE p.id = u.id
  AND p.country_code IS NULL
  AND u.raw_user_meta_data->>'country_code' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.prevent_country_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.country_code IS NOT NULL AND NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    RAISE EXCEPTION 'Country cannot be changed once assigned to an account. Please create a new account if you relocate.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_country_change ON public.profiles;
CREATE TRIGGER trg_prevent_country_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_country_change();

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway             TEXT        NOT NULL CHECK (gateway IN ('paypal', 'razorpay', 'stripe')),
  gateway_order_id    TEXT,
  gateway_payment_id  TEXT,
  amount_major        NUMERIC     NOT NULL CHECK (amount_major > 0),
  currency            TEXT        NOT NULL DEFAULT 'USD',
  status              TEXT        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','processing','paid','failed','cancelled','refunded')),
  idempotency_key     TEXT        NOT NULL UNIQUE,
  exchange_rate       NUMERIC,
  amount_usd          NUMERIC,
  amount_local        NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id         ON public.payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_gateway_order   ON public.payment_transactions(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status          ON public.payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_idempotency_key ON public.payment_transactions(idempotency_key);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_transactions_updated_at ON public.payment_transactions;
CREATE TRIGGER trg_payment_transactions_updated_at
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_view_own_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "user_view_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_view_own_transactions"
  ON public.payment_transactions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "admin_all_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "admin_all_transactions" ON public.payment_transactions;
CREATE POLICY "admin_all_transactions"
  ON public.payment_transactions FOR ALL
  USING (is_admin());

GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;
GRANT ALL ON public.payment_transactions TO service_role;

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency   CHAR(3)     NOT NULL DEFAULT 'USD',
  target_currency CHAR(3)     NOT NULL,
  rate            NUMERIC     NOT NULL CHECK (rate > 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_pair_unique UNIQUE (base_currency, target_currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_base   ON public.exchange_rates(base_currency);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_target ON public.exchange_rates(target_currency);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_exchange_rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "authenticated_read_exchange_rates" ON public.exchange_rates;
CREATE POLICY "authenticated_read_exchange_rates"
  ON public.exchange_rates FOR SELECT
  USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

DROP POLICY IF EXISTS "admin_write_exchange_rates" ON public.exchange_rates;
DROP POLICY IF EXISTS "admin_write_exchange_rates" ON public.exchange_rates;
CREATE POLICY "admin_write_exchange_rates"
  ON public.exchange_rates FOR ALL
  USING (is_admin());

GRANT SELECT ON public.exchange_rates TO authenticated, anon;
GRANT ALL    ON public.exchange_rates TO service_role;

INSERT INTO public.exchange_rates (base_currency, target_currency, rate, updated_at)
VALUES
  ('USD', 'USD', 1.0, NOW()),
  ('USD', 'INR', 83.50, NOW()),
  ('USD', 'GBP', 0.78, NOW()),
  ('USD', 'AED', 3.67, NOW()),
  ('USD', 'AUD', 1.52, NOW()),
  ('USD', 'EUR', 0.92, NOW()),
  ('USD', 'CAD', 1.36, NOW()),
  ('USD', 'JPY', 155.00, NOW())
ON CONFLICT (base_currency, target_currency)
DO UPDATE SET
  rate = EXCLUDED.rate,
  updated_at = NOW();

DROP FUNCTION IF EXISTS public.admin_get_withdrawals();

CREATE OR REPLACE FUNCTION public.admin_get_withdrawals()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  email text,
  country text,
  country_code text,
  currency text,
  amount numeric,
  routing_number text,
  account_number text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id,
    w.user_id,
    u.email::text,
    COALESCE(p.country, u.raw_user_meta_data->>'country', 'United States')::text AS country,
    COALESCE(p.country_code, u.raw_user_meta_data->>'country_code', 'US')::text AS country_code,
    COALESCE(p.currency, u.raw_user_meta_data->>'currency', 'USD')::text AS currency,
    w.amount,
    w.routing_number,
    w.account_number,
    w.status,
    w.created_at
  FROM public.withdrawals w
  JOIN auth.users u ON w.user_id = u.id
  LEFT JOIN public.profiles p ON w.user_id = p.id
  ORDER BY w.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_withdrawals() TO authenticated;

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS country_code CHAR(2);
CREATE INDEX IF NOT EXISTS idx_coupons_country_code ON public.coupons(country_code);

COMMENT ON COLUMN public.coupons.country_code IS 'ISO country code where coupon was issued. Required for redemption match.';

UPDATE public.coupons c
SET country_code = COALESCE(
  (SELECT p.country_code FROM public.profiles p WHERE p.id = c.issued_to),
  'US'
)
WHERE (c.country_code IS NULL OR c.country_code = '');

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
  v_code              TEXT;
  v_coupon_id         UUID;
  v_order_id          UUID;
  v_expiry_date       TIMESTAMPTZ;
  v_country_code      CHAR(2);
  v_user_country_name TEXT;
  v_user_balance      NUMERIC;
  v_attempts          INTEGER := 0;
  v_max_attempts      INTEGER := 10;
BEGIN
  SELECT wallet_balance, country_code, country
  INTO v_user_balance, v_country_code, v_user_country_name
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  IF COALESCE(v_user_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %', p_amount, COALESCE(v_user_balance, 0);
  END IF;

  v_country_code := public.normalize_country_code(COALESCE(v_country_code, v_user_country_name));

  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

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

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used, country_code
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false, v_country_code
  )
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;

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

GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid, text, text, text, text, text, text) TO authenticated, anon;

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
CREATE POLICY "Allow select coupons for verification" ON public.coupons FOR SELECT USING (true);
GRANT SELECT ON public.coupons TO anon, authenticated, service_role;


-- SOURCE: supabase/20260804_coupon_country_match.sql
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS country_code CHAR(2);
CREATE INDEX IF NOT EXISTS idx_coupons_country_code ON public.coupons(country_code);

COMMENT ON COLUMN public.coupons.country_code IS 'ISO country code where coupon was issued. Required for redemption match.';

UPDATE public.coupons c
SET country_code = COALESCE(
  (SELECT p.country_code FROM public.profiles p WHERE p.id = c.issued_to),
  'US'
)
WHERE (c.country_code IS NULL OR c.country_code = '');

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

  SELECT company_id, expiry_date INTO v_company_id, v_expiry_date
  FROM gift_cards WHERE id = p_gift_card_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift card not found';
  END IF;

  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id;

  v_prefix := COALESCE(v_prefix, 'CPN');

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

  UPDATE public.profiles
  SET wallet_balance = wallet_balance - p_amount
  WHERE id = p_user_id;

  INSERT INTO coupons (
    company_id, code, issued_to, gift_card_id, 
    amount, remaining_balance, expiry_date, status, is_used, country_code
  )
  VALUES (
    v_company_id, v_code, p_user_id, p_gift_card_id, 
    p_amount, p_amount, COALESCE(v_expiry_date, now() + interval '1 year'), 'active', false, v_country_code
  )
  RETURNING id INTO v_coupon_id;

  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', p_amount)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

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

  BEGIN
    v_user_uuid := p_game_user_id::UUID;
    SELECT country_code INTO v_user_country
    FROM public.profiles
    WHERE id = v_user_uuid;

    IF v_coupon_country IS NOT NULL AND v_user_country IS NOT NULL AND v_coupon_country <> v_user_country THEN
      RAISE EXCEPTION 'Country mismatch: This coupon was issued for % and cannot be redeemed by an account in %', v_coupon_country, v_user_country;
    END IF;
  EXCEPTION WHEN OTHERS THEN
  END;

  UPDATE coupons SET is_used = true, status = 'redeemed', redeemed_at = now() WHERE id = p_coupon_id;

  INSERT INTO coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;

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


-- SOURCE: supabase/20260804_enforce_lottery_country_match.sql
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

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
CREATE POLICY "Allow select coupons for verification" ON public.coupons FOR SELECT USING (true);
GRANT SELECT ON public.coupons TO anon, authenticated, service_role;


-- SOURCE: supabase/20260803_payment_transactions_rls_authenticated.sql
DROP POLICY IF EXISTS "user_insert_own_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "user_insert_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_insert_own_transactions"
  ON public.payment_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_update_own_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "user_update_own_transactions" ON public.payment_transactions;
CREATE POLICY "user_update_own_transactions"
  ON public.payment_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.payment_transactions TO authenticated;

-- FINAL DEFINITIONS: reconcile overlapping purchase, country, and security fixes.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, auth AS $$
 SELECT COALESCE((auth.jwt()->'app_metadata'->>'role')='admin', false);
$$;

-- Invoker context blocks direct client balance changes, while allowing trusted RPCs.
CREATE OR REPLACE FUNCTION public.lock_wallet_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public AS $$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN
  IF TG_OP = 'INSERT' THEN
   NEW.wallet_balance := 0;
  ELSE
   NEW.wallet_balance := OLD.wallet_balance;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_wallet_balance_immutability ON public.profiles;
CREATE TRIGGER enforce_wallet_balance_immutability
 BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW
 EXECUTE FUNCTION public.lock_wallet_balance();

CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
 p_gift_card_id uuid, p_user_id uuid, p_amount numeric
)
RETURNS TABLE (coupon_code text, order_id uuid, coupon_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
 v_profile public.profiles%ROWTYPE;
 v_card public.gift_cards%ROWTYPE;
 v_company public.companies%ROWTYPE;
 v_code text; v_coupon uuid; v_order uuid; v_country text;
BEGIN
 IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Unauthorized';
 END IF;
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
 SELECT * INTO v_card FROM public.gift_cards WHERE id=p_gift_card_id FOR UPDATE;
 IF NOT FOUND OR NOT v_card.is_active THEN RAISE EXCEPTION 'Gift card not found or inactive'; END IF;
 IF v_card.price IS NULL OR v_card.price <= 0 THEN RAISE EXCEPTION 'Gift card has no valid price'; END IF;
 IF v_card.expiry_date IS NOT NULL AND v_card.expiry_date <= now() THEN RAISE EXCEPTION 'Gift card has expired'; END IF;
 IF v_profile.wallet_balance < v_card.price THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
 SELECT * INTO v_company FROM public.companies WHERE id=v_card.company_id FOR UPDATE;
 IF NOT FOUND OR v_company.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Company is not approved'; END IF;
 IF (SELECT count(*) FROM public.coupons WHERE company_id=v_company.id) >= v_company.coupon_limit THEN
  RAISE EXCEPTION 'Company coupon limit reached';
 END IF;
 IF v_card.issue_limit IS NOT NULL AND (SELECT count(*) FROM public.coupons WHERE gift_card_id=v_card.id) >= v_card.issue_limit THEN
  RAISE EXCEPTION 'Gift card issue limit reached';
 END IF;
 v_country := public.normalize_country_code(COALESCE(v_profile.country_code, v_profile.country));
 IF v_country IS NULL THEN RAISE EXCEPTION 'Account country is required'; END IF;
 FOR attempt IN 1..10 LOOP
  v_code := trim(v_company.prefix)||'-'||upper(encode(gen_random_bytes(8),'hex'));
  EXIT WHEN NOT EXISTS (SELECT 1 FROM public.coupons WHERE code=v_code);
  IF attempt=10 THEN RAISE EXCEPTION 'Could not generate unique coupon code'; END IF;
 END LOOP;
 -- p_amount remains in the signature for API compatibility; the stored price is authoritative.
 UPDATE public.profiles SET wallet_balance=wallet_balance-v_card.price WHERE id=p_user_id;
 INSERT INTO public.coupons(company_id,code,issued_to,gift_card_id,amount,remaining_balance,expiry_date,status,is_used,country_code)
 VALUES(v_company.id,v_code,p_user_id,v_card.id,v_card.price,v_card.price,
  COALESCE(v_card.expiry_date,now()+interval '1 year'),'active',false,v_country)
 RETURNING id INTO v_coupon;
 INSERT INTO public.orders(user_id,company_id,coupon_id,gift_card_id,status,amount)
 VALUES(p_user_id,v_company.id,v_coupon,v_card.id,'paid',v_card.price) RETURNING id INTO v_order;
 RETURN QUERY SELECT v_code,v_order,v_coupon;
END;
$$;

CREATE OR REPLACE FUNCTION generate_monthly_settlements(p_year INT, p_month INT, p_company_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
  v_period_str TEXT;
  v_inserted_count INTEGER := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  v_start_date := make_date(p_year, p_month, 1)::timestamptz;
  v_end_date := (v_start_date + interval '1 month');
  v_period_str := to_char(v_start_date, 'YYYY-MM');

  WITH monthly_data AS (
    SELECT 
      c.company_id,
      COUNT(r.id) as redemption_count,
      SUM(r.amount) as total_amount
    FROM redemptions r
    JOIN coupons c ON c.id = r.coupon_id
    WHERE r.created_at >= v_start_date 
      AND r.created_at < v_end_date
      AND (p_company_id IS NULL OR c.company_id = p_company_id)
    GROUP BY c.company_id
  )
  INSERT INTO settlements (company_id, period_month, total_redemptions, amount_due, status)
  SELECT 
    md.company_id, 
    v_period_str, 
    md.redemption_count, 
    md.total_amount, 
    'pending'
  FROM monthly_data md
  WHERE NOT EXISTS (
    SELECT 1 FROM settlements s 
    WHERE s.company_id = md.company_id AND s.period_month = v_period_str
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  RETURN v_inserted_count;
END;
$$;

-- Pending withdrawals must not be inserted as already approved by clients.
DROP POLICY IF EXISTS "user_insert_own_withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_user_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_user_insert" ON public.withdrawals FOR INSERT TO authenticated
 WITH CHECK (auth.uid()=user_id AND status='pending');

-- Restrict function privileges only for this application's functions.
DO $$
DECLARE f record;
BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN (
 'is_admin','issue_coupon','issue_gift_card_coupon','validate_coupon','validate_coupon_by_id',
 'mark_coupon_used','mark_coupon_used_by_id','redeem_coupon_amount','redeem_game_coupon',
 'verify_game_coupon','admin_get_users','admin_get_purchased_coupons','admin_get_withdrawals',
 'get_gift_cards_with_counts','deduct_wallet_balance','add_funds_secure','set_user_admin_role',
 'transfer_winnings_to_wallet','generate_monthly_settlements','normalize_country_code')
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions',f.signature);
 END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_country_code(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text),public.validate_coupon_by_id(uuid),
 public.verify_game_coupon(text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid,numeric),
 public.admin_get_users(),public.admin_get_purchased_coupons(),public.admin_get_withdrawals(),
 public.get_gift_cards_with_counts(),public.generate_monthly_settlements(integer,integer,uuid) TO authenticated;

-- Ensure table access does not depend on project-specific default privileges.
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.companies,public.gift_cards,public.campaigns TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.companies,public.gift_cards,public.campaigns,
 public.profiles,public.orders,public.coupons,public.redemptions,public.coupon_redemptions,
 public.withdrawals,public.deposits,public.settlements,public.wallet_transfers,
 public.payment_transactions,public.exchange_rates,public.support_tickets,public.support_messages TO authenticated;
GRANT ALL ON public.companies,public.gift_cards,public.campaigns,
 public.profiles,public.orders,public.coupons,public.redemptions,public.coupon_redemptions,
 public.withdrawals,public.deposits,public.settlements,public.wallet_transfers,
 public.payment_transactions,public.exchange_rates,public.support_tickets,public.support_messages TO service_role;

-- Direct client wallet edits are never allowed; trusted RPCs update as the owner.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE(country,country_code,currency,timezone,phone_country_code,paypal_email)
 ON public.profiles TO authenticated;

COMMIT;
SELECT 'CouponVault database setup complete' AS result;
