-- =============================================================================
-- COUPONVAULT - COMPLETE ALL-IN-ONE MASTER SETUP SCRIPT (UNIFIED & IDEMPOTENT)
-- Supports standalone use OR shared database with Lottery Platform
-- Execute in: Supabase Dashboard (https://supabase.com/dashboard)
--             Project -> SQL Editor -> New Query -> Paste & Run
-- =============================================================================

-- 1. Enable Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 2. Helper Functions (Defined FIRST before any tables or policies)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'role' = 'service_role') OR
    ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin') OR
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- =============================================================================
-- 3. Core Tables & Column Harmonization
-- =============================================================================

-- Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
  paypal_email        TEXT,
  country             TEXT,
  country_code        CHAR(2),
  currency            CHAR(3) NOT NULL DEFAULT 'USD',
  timezone            TEXT DEFAULT 'UTC',
  phone_country_code  TEXT,
  updated_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paypal_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_country_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure country_code and currency types are TEXT to prevent CHAR length issues
ALTER TABLE public.profiles ALTER COLUMN country_code TYPE TEXT;
ALTER TABLE public.profiles ALTER COLUMN currency TYPE TEXT;

-- Backfill profile for any existing auth.users (syncing country & metadata)
INSERT INTO public.profiles (
  id,
  email,
  wallet_balance,
  country,
  country_code,
  currency,
  timezone,
  phone_country_code,
  created_at,
  updated_at
)
SELECT 
  id,
  email,
  0.00,
  raw_user_meta_data->>'country',
  raw_user_meta_data->>'country_code',
  COALESCE(raw_user_meta_data->>'currency', 'USD'),
  COALESCE(raw_user_meta_data->>'timezone', 'UTC'),
  raw_user_meta_data->>'phone_country_code',
  now(),
  now()
FROM auth.users
ON CONFLICT (id) DO UPDATE SET
  email = COALESCE(public.profiles.email, EXCLUDED.email),
  country = COALESCE(NULLIF(public.profiles.country, ''), EXCLUDED.country),
  country_code = COALESCE(NULLIF(public.profiles.country_code, ''), EXCLUDED.country_code),
  currency = COALESCE(NULLIF(public.profiles.currency, ''), EXCLUDED.currency),
  timezone = COALESCE(NULLIF(public.profiles.timezone, ''), EXCLUDED.timezone),
  phone_country_code = COALESCE(NULLIF(public.profiles.phone_country_code, ''), EXCLUDED.phone_country_code),
  updated_at = now();

-- Companies
CREATE TABLE IF NOT EXISTS public.companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  coupon_limit  INTEGER NOT NULL DEFAULT 1000 CHECK (coupon_limit > 0),
  status        TEXT DEFAULT 'approved',
  is_approved   BOOLEAN NOT NULL DEFAULT true,
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT companies_prefix_unique UNIQUE (prefix)
);

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS coupon_limit INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS balance NUMERIC(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS gstin TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pan TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS document_url TEXT;

-- Gift Cards
CREATE TABLE IF NOT EXISTS public.gift_cards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  price         NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  value         NUMERIC(14,2) NOT NULL CHECK (value >= 0),
  banner_image  TEXT,
  terms         TEXT,
  issue_limit   INTEGER NOT NULL DEFAULT 1000 CHECK (issue_limit > 0),
  expiry_date   TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS banner_image TEXT;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS issue_limit INTEGER DEFAULT 1000;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Coupons
CREATE TABLE IF NOT EXISTS public.coupons (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  gift_card_id      UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  remaining_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  status            TEXT NOT NULL DEFAULT 'active',
  is_used           BOOLEAN NOT NULL DEFAULT false,
  issued_to         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  country_code      CHAR(2),
  expiry_date       TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 year'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_unique UNIQUE (code)
);

ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS is_used BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS issued_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS country_code CHAR(2);
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS expiry_date TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 year');

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  coupon_id     UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  gift_card_id  UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL,
  amount        NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  status        TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending', 'paid', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS gift_card_id UUID REFERENCES public.gift_cards(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Redemptions
CREATE TABLE IF NOT EXISTS public.redemptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id               UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount                  NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  remaining_balance_after NUMERIC(14,2) DEFAULT 0.00,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS coupon_id UUID;
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS remaining_balance_after NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.redemptions ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ DEFAULT now();

-- Wallet Transfers
CREATE TABLE IF NOT EXISTS public.wallet_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status          TEXT NOT NULL DEFAULT 'SUCCESS',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_transfers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Deposits (Harmonized with both camelCase "userId" and snake_case user_id)
CREATE TABLE IF NOT EXISTS public.deposits (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id         TEXT,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  payment_method  TEXT NOT NULL DEFAULT 'PayPal',
  reference_id    TEXT,
  status          TEXT NOT NULL DEFAULT 'completed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'PayPal';
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Withdrawals (Harmonized with both camelCase "userId" and snake_case user_id)
CREATE TABLE IF NOT EXISTS public.withdrawals (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id         TEXT,
  amount          NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  routing_number  TEXT,
  account_number  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS routing_number TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Campaigns Table
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  banner_url          TEXT,
  discount_percentage NUMERIC(5,2) DEFAULT 0,
  start_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_date            TIMESTAMPTZ,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Settlements Table
CREATE TABLE IF NOT EXISTS public.settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period_month        TEXT NOT NULL,
  total_redemptions   INTEGER NOT NULL DEFAULT 0,
  amount_due          NUMERIC NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  UNIQUE(company_id, period_month)
);

-- Payment Transactions & Audit
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount          NUMERIC(14,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  payment_gateway TEXT NOT NULL DEFAULT 'PAYPAL',
  transaction_id  TEXT,
  status          TEXT NOT NULL DEFAULT 'COMPLETED',
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Exchange Rates
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_curr   CHAR(3) NOT NULL DEFAULT 'USD',
  target_curr CHAR(3) NOT NULL,
  rate        NUMERIC(18,6) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_currency_pair UNIQUE (base_curr, target_curr)
);

-- Support Tickets & Messages (Harmonized with both camelCase and snake_case)
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     TEXT,
  user_email  TEXT,
  subject     TEXT NOT NULL DEFAULT 'Support Request',
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS user_email TEXT;

CREATE TABLE IF NOT EXISTS public.support_messages (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  ticket_id   TEXT,
  sender_id   TEXT,
  message     TEXT NOT NULL DEFAULT '',
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add all possible missing columns on support_messages
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS ticket_id TEXT;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS sender_id TEXT;
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Sync camelCase and snake_case columns & Harmonize Prisma legacy schemas
DO $$
BEGIN
  -- Support Messages
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_messages' AND column_name = 'ticketId') THEN
    EXECUTE 'UPDATE public.support_messages SET ticket_id = "ticketId"::TEXT WHERE ticket_id IS NULL AND "ticketId" IS NOT NULL;';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_messages' AND column_name = 'senderId') THEN
    EXECUTE 'UPDATE public.support_messages SET sender_id = "senderId"::TEXT WHERE sender_id IS NULL AND "senderId" IS NOT NULL;';
  END IF;

  -- Support Tickets
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'support_tickets' AND column_name = 'userId') THEN
    EXECUTE 'UPDATE public.support_tickets SET user_id = "userId"::TEXT WHERE user_id IS NULL AND "userId" IS NOT NULL;';
  END IF;

  -- Drop NOT NULL constraints from Prisma legacy columns
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'walletId') THEN
    ALTER TABLE public.deposits ALTER COLUMN "walletId" DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'gateway') THEN
    ALTER TABLE public.deposits ALTER COLUMN "gateway" DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'walletId') THEN
    ALTER TABLE public.withdrawals ALTER COLUMN "walletId" DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'gateway') THEN
    ALTER TABLE public.withdrawals ALTER COLUMN "gateway" DROP NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'accountDetails') THEN
    ALTER TABLE public.withdrawals ALTER COLUMN "accountDetails" DROP NOT NULL;
  END IF;

  -- Ensure status columns can hold text values
  BEGIN
    ALTER TABLE public.deposits ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.deposits ALTER COLUMN status TYPE TEXT USING status::TEXT;
    ALTER TABLE public.deposits ALTER COLUMN status SET DEFAULT 'completed';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  BEGIN
    ALTER TABLE public.withdrawals ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.withdrawals ALTER COLUMN status TYPE TEXT USING status::TEXT;
    ALTER TABLE public.withdrawals ALTER COLUMN status SET DEFAULT 'pending';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Sync createdAt/updatedAt to created_at/updated_at
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'createdAt') THEN
    EXECUTE 'UPDATE public.deposits SET created_at = "createdAt" WHERE created_at IS NULL AND "createdAt" IS NOT NULL;';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'createdAt') THEN
    EXECUTE 'UPDATE public.withdrawals SET created_at = "createdAt" WHERE created_at IS NULL AND "createdAt" IS NOT NULL;';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'updatedAt') THEN
    EXECUTE 'UPDATE public.withdrawals SET updated_at = "updatedAt" WHERE updated_at IS NULL AND "updatedAt" IS NOT NULL;';
  END IF;

  -- Sync user_id from userId if present
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'userId') THEN
    EXECUTE 'UPDATE public.deposits SET user_id = "userId"::TEXT WHERE user_id IS NULL AND "userId" IS NOT NULL;';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'userId') THEN
    EXECUTE 'UPDATE public.withdrawals SET user_id = "userId"::TEXT WHERE user_id IS NULL AND "userId" IS NOT NULL;';
  END IF;

  -- Sync user_id from wallets if walletId is present
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallets') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deposits' AND column_name = 'walletId') THEN
      EXECUTE 'UPDATE public.deposits d SET user_id = w."userId"::TEXT FROM public.wallets w WHERE d."walletId" = w.id AND d.user_id IS NULL;';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'walletId') THEN
      EXECUTE 'UPDATE public.withdrawals w_draw SET user_id = w."userId"::TEXT FROM public.wallets w WHERE w_draw."walletId" = w.id AND w_draw.user_id IS NULL;';
    END IF;
  END IF;
END $$;

-- Triggers to automatically synchronize camelCase and snake_case
CREATE OR REPLACE FUNCTION public.sync_support_columns()
RETURNS trigger AS $$
DECLARE
  v_json jsonb;
BEGIN
  v_json := to_jsonb(NEW);

  -- tickets
  IF TG_TABLE_NAME = 'support_tickets' THEN
    IF NEW.user_id IS NULL AND v_json ? 'userId' THEN
      NEW.user_id := v_json->>'userId';
    END IF;
  END IF;

  -- messages
  IF TG_TABLE_NAME = 'support_messages' THEN
    IF NEW.ticket_id IS NULL AND v_json ? 'ticketId' THEN
      NEW.ticket_id := v_json->>'ticketId';
    END IF;
    IF NEW.sender_id IS NULL AND v_json ? 'senderId' THEN
      NEW.sender_id := v_json->>'senderId';
    END IF;
  END IF;

  -- deposits
  IF TG_TABLE_NAME = 'deposits' THEN
    IF NEW.user_id IS NULL AND v_json ? 'userId' THEN
      NEW.user_id := v_json->>'userId';
    END IF;
    IF NEW.created_at IS NULL AND v_json ? 'createdAt' THEN
      NEW.created_at := (v_json->>'createdAt')::timestamptz;
    END IF;
  END IF;

  -- withdrawals
  IF TG_TABLE_NAME = 'withdrawals' THEN
    IF NEW.user_id IS NULL AND v_json ? 'userId' THEN
      NEW.user_id := v_json->>'userId';
    END IF;
    IF NEW.created_at IS NULL AND v_json ? 'createdAt' THEN
      NEW.created_at := (v_json->>'createdAt')::timestamptz;
    END IF;
    IF NEW.updated_at IS NULL AND v_json ? 'updatedAt' THEN
      NEW.updated_at := (v_json->>'updatedAt')::timestamptz;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_support_tickets ON public.support_tickets;
CREATE TRIGGER trg_sync_support_tickets
BEFORE INSERT OR UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.sync_support_columns();

DROP TRIGGER IF EXISTS trg_sync_support_messages ON public.support_messages;
CREATE TRIGGER trg_sync_support_messages
BEFORE INSERT OR UPDATE ON public.support_messages
FOR EACH ROW EXECUTE FUNCTION public.sync_support_columns();

DROP TRIGGER IF EXISTS trg_sync_deposits ON public.deposits;
CREATE TRIGGER trg_sync_deposits
BEFORE INSERT OR UPDATE ON public.deposits
FOR EACH ROW EXECUTE FUNCTION public.sync_support_columns();

DROP TRIGGER IF EXISTS trg_sync_withdrawals ON public.withdrawals;
CREATE TRIGGER trg_sync_withdrawals
BEFORE INSERT OR UPDATE ON public.withdrawals
FOR EACH ROW EXECUTE FUNCTION public.sync_support_columns();

-- =============================================================================
-- 4. Indexes (Safe Creation)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_coupons_company_id ON public.coupons(company_id);
CREATE INDEX IF NOT EXISTS idx_coupons_issued_to ON public.coupons(issued_to);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_company_id ON public.orders(company_id);
CREATE INDEX IF NOT EXISTS idx_gift_cards_company_id ON public.gift_cards(company_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_coupon_id ON public.redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_tx_id ON public.wallet_transfers(transaction_id);

-- =============================================================================
-- 5. Row-Level Security (RLS) Policies
-- =============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id OR public.is_admin());

-- Companies Policies
DROP POLICY IF EXISTS "companies_read_all" ON public.companies;
CREATE POLICY "companies_read_all" ON public.companies FOR SELECT USING (true);

DROP POLICY IF EXISTS "companies_admin_manage" ON public.companies;
DROP POLICY IF EXISTS "companies_admin_all" ON public.companies;
CREATE POLICY "companies_admin_all" ON public.companies FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "companies_merchant_insert" ON public.companies;
DROP POLICY IF EXISTS "merchant_insert_company" ON public.companies;
CREATE POLICY "companies_merchant_insert" ON public.companies FOR INSERT WITH CHECK (
  auth.uid() IS NOT NULL AND (owner_id = auth.uid() OR public.is_admin())
);

DROP POLICY IF EXISTS "companies_owner_update" ON public.companies;
DROP POLICY IF EXISTS "owner_update_company" ON public.companies;
CREATE POLICY "companies_owner_update" ON public.companies FOR UPDATE USING (
  owner_id = auth.uid() OR public.is_admin()
)
WITH CHECK (
  owner_id = auth.uid() OR public.is_admin()
);

-- Gift Cards Policies
DROP POLICY IF EXISTS "gift_cards_read_all" ON public.gift_cards;
CREATE POLICY "gift_cards_read_all" ON public.gift_cards FOR SELECT USING (true);

DROP POLICY IF EXISTS "gift_cards_admin_manage" ON public.gift_cards;
CREATE POLICY "gift_cards_admin_manage" ON public.gift_cards FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "gift_cards_merchant_manage" ON public.gift_cards;
DROP POLICY IF EXISTS "merchant_manage_gift_cards" ON public.gift_cards;
CREATE POLICY "gift_cards_merchant_manage" ON public.gift_cards FOR ALL USING (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()) OR public.is_admin()
)
WITH CHECK (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()) OR public.is_admin()
);

-- Coupons Policies
DROP POLICY IF EXISTS "coupons_user_own" ON public.coupons;
CREATE POLICY "coupons_user_own" ON public.coupons FOR SELECT USING (issued_to = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "coupons_admin_all" ON public.coupons;
CREATE POLICY "coupons_admin_all" ON public.coupons FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "coupons_merchant_manage" ON public.coupons;
CREATE POLICY "coupons_merchant_manage" ON public.coupons FOR ALL USING (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()) OR public.is_admin()
);

-- Orders Policies
DROP POLICY IF EXISTS "orders_user_own" ON public.orders;
CREATE POLICY "orders_user_own" ON public.orders FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "orders_user_insert" ON public.orders;
CREATE POLICY "orders_user_insert" ON public.orders FOR INSERT WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "orders_admin_all" ON public.orders;
CREATE POLICY "orders_admin_all" ON public.orders FOR ALL USING (public.is_admin());

-- Redemptions Policies
DROP POLICY IF EXISTS "redemptions_user_own" ON public.redemptions;
CREATE POLICY "redemptions_user_own" ON public.redemptions FOR SELECT USING (
  user_id = auth.uid() 
  OR EXISTS (
    SELECT 1 FROM public.coupons 
    WHERE coupons.id = redemptions.coupon_id AND coupons.issued_to = auth.uid()
  )
  OR public.is_admin()
);

DROP POLICY IF EXISTS "redemptions_insert_auth" ON public.redemptions;
CREATE POLICY "redemptions_insert_auth" ON public.redemptions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Wallet Transfers Policies
DROP POLICY IF EXISTS "wallet_transfers_user_own" ON public.wallet_transfers;
CREATE POLICY "wallet_transfers_user_own" ON public.wallet_transfers FOR SELECT USING (user_id = auth.uid() OR public.is_admin());

-- Deposits Policies
DROP POLICY IF EXISTS "deposits_user_own" ON public.deposits;
CREATE POLICY "deposits_user_own" ON public.deposits FOR SELECT USING (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

DROP POLICY IF EXISTS "deposits_user_insert" ON public.deposits;
CREATE POLICY "deposits_user_insert" ON public.deposits FOR INSERT WITH CHECK (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

-- Withdrawals Policies
DROP POLICY IF EXISTS "withdrawals_user_own" ON public.withdrawals;
CREATE POLICY "withdrawals_user_own" ON public.withdrawals FOR SELECT USING (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

DROP POLICY IF EXISTS "withdrawals_user_insert" ON public.withdrawals;
CREATE POLICY "withdrawals_user_insert" ON public.withdrawals FOR INSERT WITH CHECK (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

DROP POLICY IF EXISTS "withdrawals_admin_update" ON public.withdrawals;
CREATE POLICY "withdrawals_admin_update" ON public.withdrawals FOR UPDATE USING (
  public.is_admin()
);

-- Campaigns Policies
DROP POLICY IF EXISTS "campaigns_public_read" ON public.campaigns;
CREATE POLICY "campaigns_public_read" ON public.campaigns FOR SELECT USING (true);

DROP POLICY IF EXISTS "campaigns_admin_all" ON public.campaigns;
CREATE POLICY "campaigns_admin_all" ON public.campaigns FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "campaigns_merchant_manage" ON public.campaigns;
CREATE POLICY "campaigns_merchant_manage" ON public.campaigns FOR ALL USING (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()) OR public.is_admin()
)
WITH CHECK (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid()) OR public.is_admin()
);

-- Settlements Policies
DROP POLICY IF EXISTS "settlements_admin_all" ON public.settlements;
CREATE POLICY "settlements_admin_all" ON public.settlements FOR ALL USING (public.is_admin());

DROP POLICY IF EXISTS "settlements_merchant_read" ON public.settlements;
CREATE POLICY "settlements_merchant_read" ON public.settlements FOR SELECT USING (
  company_id IN (SELECT id FROM public.companies WHERE owner_id = auth.uid())
);

-- Exchange Rates Policies
DROP POLICY IF EXISTS "exchange_rates_public_read" ON public.exchange_rates;
CREATE POLICY "exchange_rates_public_read" ON public.exchange_rates FOR SELECT USING (true);

-- Support Tickets Policies
DROP POLICY IF EXISTS "tickets_user_own" ON public.support_tickets;
CREATE POLICY "tickets_user_own" ON public.support_tickets FOR SELECT USING (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

DROP POLICY IF EXISTS "tickets_user_insert" ON public.support_tickets;
CREATE POLICY "tickets_user_insert" ON public.support_tickets FOR INSERT WITH CHECK (
  user_id::TEXT = auth.uid()::TEXT OR public.is_admin()
);

-- Support Messages Policies
DROP POLICY IF EXISTS "messages_user_own" ON public.support_messages;
CREATE POLICY "messages_user_own" ON public.support_messages FOR SELECT USING (
  ticket_id::TEXT IN (SELECT id::TEXT FROM public.support_tickets WHERE user_id::TEXT = auth.uid()::TEXT)
  OR public.is_admin()
);

DROP POLICY IF EXISTS "messages_user_insert" ON public.support_messages;
CREATE POLICY "messages_user_insert" ON public.support_messages FOR INSERT WITH CHECK (
  ticket_id::TEXT IN (SELECT id::TEXT FROM public.support_tickets WHERE user_id::TEXT = auth.uid()::TEXT)
  OR public.is_admin()
);

-- =============================================================================
-- 6. RPC Functions
-- =============================================================================

-- get_gift_cards_with_counts()
DROP FUNCTION IF EXISTS public.get_gift_cards_with_counts();
CREATE OR REPLACE FUNCTION public.get_gift_cards_with_counts()
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
  LEFT JOIN companies c ON c.id = g.company_id
  ORDER BY g.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated, anon;

-- issue_gift_card_coupon()
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
  SELECT wallet_balance, country_code INTO v_user_balance, v_country_code
  FROM public.profiles WHERE id = p_user_id FOR UPDATE;

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

  SELECT prefix INTO v_prefix FROM companies WHERE id = v_company_id;
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

-- add_funds_secure()
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

  UPDATE public.profiles
  SET wallet_balance = wallet_balance + p_amount
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, wallet_balance)
    VALUES (p_user_id, p_amount);
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.add_funds_secure(UUID, NUMERIC) TO service_role, authenticated;

-- validate_coupon()
CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT)
RETURNS TABLE (
  valid BOOLEAN,
  coupon_id UUID,
  company_id UUID,
  company_name TEXT,
  amount NUMERIC,
  remaining_balance NUMERIC,
  status TEXT,
  error_message TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_coupon RECORD;
BEGIN
  SELECT c.id, c.company_id, comp.name AS company_name, c.amount, c.remaining_balance, c.status, c.is_used, c.expiry_date
  INTO v_coupon
  FROM public.coupons c
  JOIN public.companies comp ON comp.id = c.company_id
  WHERE c.code = p_code;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::UUID, NULL::UUID, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, 'not_found', 'Coupon code does not exist';
    RETURN;
  END IF;

  IF v_coupon.is_used OR v_coupon.remaining_balance <= 0 THEN
    RETURN QUERY SELECT false, v_coupon.id, v_coupon.company_id, v_coupon.company_name, v_coupon.amount, v_coupon.remaining_balance, 'already_used', 'Coupon has already been fully redeemed';
    RETURN;
  END IF;

  IF v_coupon.expiry_date < now() THEN
    RETURN QUERY SELECT false, v_coupon.id, v_coupon.company_id, v_coupon.company_name, v_coupon.amount, v_coupon.remaining_balance, 'expired', 'Coupon has expired';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_coupon.id, v_coupon.company_id, v_coupon.company_name, v_coupon.amount, v_coupon.remaining_balance, v_coupon.status, NULL::TEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated, anon;

-- redeem_coupon_amount()
CREATE OR REPLACE FUNCTION public.redeem_coupon_amount(p_coupon_id UUID, p_amount NUMERIC)
RETURNS TABLE (success BOOLEAN, new_remaining NUMERIC, error_message TEXT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_rem NUMERIC;
BEGIN
  SELECT remaining_balance INTO v_current_rem
  FROM public.coupons WHERE id = p_coupon_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::NUMERIC, 'Coupon not found';
    RETURN;
  END IF;

  IF v_current_rem < p_amount THEN
    RETURN QUERY SELECT false, v_current_rem, 'Insufficient coupon balance';
    RETURN;
  END IF;

  UPDATE public.coupons
  SET remaining_balance = remaining_balance - p_amount,
      is_used = (remaining_balance - p_amount <= 0)
  WHERE id = p_coupon_id;

  INSERT INTO public.redemptions (coupon_id, user_id, amount)
  VALUES (p_coupon_id, auth.uid(), p_amount);

  RETURN QUERY SELECT true, (v_current_rem - p_amount), NULL::TEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid, numeric) TO authenticated, anon;

-- transfer_winnings_to_wallet()
CREATE OR REPLACE FUNCTION public.transfer_winnings_to_wallet(
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

  RETURN QUERY SELECT v_new_balance, v_transfer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transfer_winnings_to_wallet(text, numeric, text) TO authenticated, service_role;

-- admin_get_withdrawals()
DROP FUNCTION IF EXISTS public.admin_get_withdrawals();
CREATE OR REPLACE FUNCTION public.admin_get_withdrawals()
RETURNS TABLE (
  id text,
  user_id text,
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
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT 
    w.id::text,
    w.user_id::text,
    COALESCE(u.email, p.email, '')::text AS email,
    COALESCE(p.country, u.raw_user_meta_data->>'country', 'United States')::text AS country,
    COALESCE(p.country_code, u.raw_user_meta_data->>'country_code', 'US')::text AS country_code,
    COALESCE(p.currency, u.raw_user_meta_data->>'currency', 'USD')::text AS currency,
    w.amount,
    w.routing_number,
    w.account_number,
    w.status,
    w.created_at
  FROM public.withdrawals w
  LEFT JOIN auth.users u ON w.user_id::text = u.id::text
  LEFT JOIN public.profiles p ON w.user_id::text = p.id::text
  ORDER BY w.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_withdrawals() TO authenticated;

-- process_withdrawal_balance() Trigger Function
CREATE OR REPLACE FUNCTION public.process_withdrawal_balance()
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
    WHERE id::text = NEW.user_id::text
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    IF NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Withdrawal amount must be positive';
    END IF;

    IF v_current_balance < NEW.amount THEN
      RAISE EXCEPTION 'Insufficient balance for withdrawal: have %, need %', v_current_balance, NEW.amount;
    END IF;

    UPDATE public.profiles
    SET wallet_balance = wallet_balance - NEW.amount
    WHERE id::text = NEW.user_id::text;

    RETURN NEW;

  ELSIF (TG_OP = 'UPDATE') THEN
    IF OLD.status = 'pending' AND NEW.status = 'rejected' THEN
      UPDATE public.profiles
      SET wallet_balance = wallet_balance + OLD.amount
      WHERE id::text = NEW.user_id::text;
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
  EXECUTE FUNCTION public.process_withdrawal_balance();

-- generate_monthly_settlements()
CREATE OR REPLACE FUNCTION public.generate_monthly_settlements(p_year INT, p_month INT, p_company_id UUID DEFAULT NULL)
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
      SUM(COALESCE(gc.discount_value, c.discount_value, 0)) as total_amount
    FROM public.redemptions r
    JOIN public.coupons c ON c.id = r.coupon_id
    LEFT JOIN public.gift_cards gc ON gc.id = c.gift_card_id
    WHERE r.redeemed_at >= v_start_date 
      AND r.redeemed_at < v_end_date
      AND (p_company_id IS NULL OR c.company_id = p_company_id)
    GROUP BY c.company_id
  )
  INSERT INTO public.settlements (company_id, period_month, total_redemptions, amount_due, status)
  SELECT 
    md.company_id, 
    v_period_str, 
    md.redemption_count, 
    md.total_amount, 
    'pending'
  FROM monthly_data md
  WHERE NOT EXISTS (
    SELECT 1 FROM public.settlements s 
    WHERE s.company_id = md.company_id AND s.period_month = v_period_str
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RETURN v_inserted_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.generate_monthly_settlements(INT, INT, UUID) TO authenticated;

-- handle_new_user_profile() Trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    wallet_balance,
    country,
    country_code,
    currency,
    timezone,
    phone_country_code,
    created_at,
    updated_at
  ) VALUES (
    new.id,
    new.email,
    0.00,
    COALESCE(new.raw_user_meta_data->>'country', NULL),
    COALESCE(new.raw_user_meta_data->>'country_code', NULL),
    COALESCE(new.raw_user_meta_data->>'currency', 'USD'),
    COALESCE(new.raw_user_meta_data->>'timezone', 'UTC'),
    COALESCE(new.raw_user_meta_data->>'phone_country_code', NULL),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(new.email, public.profiles.email),
    country = COALESCE(NULLIF(new.raw_user_meta_data->>'country', ''), public.profiles.country),
    country_code = COALESCE(NULLIF(new.raw_user_meta_data->>'country_code', ''), public.profiles.country_code),
    currency = COALESCE(NULLIF(new.raw_user_meta_data->>'currency', ''), public.profiles.currency),
    timezone = COALESCE(NULLIF(new.raw_user_meta_data->>'timezone', ''), public.profiles.timezone),
    phone_country_code = COALESCE(NULLIF(new.raw_user_meta_data->>'phone_country_code', ''), public.profiles.phone_country_code),
    updated_at = now();
  RETURN new;
EXCEPTION
  WHEN OTHERS THEN
    RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- =============================================================================
-- 7. Seed Initial Companies & Gift Cards
-- =============================================================================
INSERT INTO public.companies (id, name, prefix, coupon_limit)
VALUES 
  ('a1000000-0000-0000-0000-000000000001', 'Amazon', 'AMZ', 10000),
  ('a1000000-0000-0000-0000-000000000002', 'Apple', 'APL', 10000),
  ('a1000000-0000-0000-0000-000000000003', 'Steam', 'STM', 10000),
  ('a1000000-0000-0000-0000-000000000004', 'Google Play', 'GPL', 10000)
ON CONFLICT (prefix) DO NOTHING;

-- Deduplicate existing gift cards safely before adding unique constraint
DO $$
DECLARE
  v_dup RECORD;
  v_canonical_id UUID;
BEGIN
  FOR v_dup IN 
    SELECT company_id, title, COUNT(*) as cnt
    FROM public.gift_cards
    GROUP BY company_id, title
    HAVING COUNT(*) > 1
  LOOP
    SELECT id INTO v_canonical_id
    FROM public.gift_cards
    WHERE company_id = v_dup.company_id AND title = v_dup.title
    ORDER BY created_at ASC, id ASC
    LIMIT 1;

    UPDATE public.coupons
    SET gift_card_id = v_canonical_id
    WHERE gift_card_id IN (
      SELECT id FROM public.gift_cards 
      WHERE company_id = v_dup.company_id AND title = v_dup.title AND id <> v_canonical_id
    );

    UPDATE public.orders
    SET gift_card_id = v_canonical_id
    WHERE gift_card_id IN (
      SELECT id FROM public.gift_cards 
      WHERE company_id = v_dup.company_id AND title = v_dup.title AND id <> v_canonical_id
    );

    DELETE FROM public.gift_cards
    WHERE company_id = v_dup.company_id 
      AND title = v_dup.title 
      AND id <> v_canonical_id;
  END LOOP;
END $$;

-- Ensure unique constraint so duplicate cards can never be inserted again
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_cards_company_title ON public.gift_cards (company_id, title);

INSERT INTO public.gift_cards (id, company_id, title, description, price, value, is_active)
VALUES
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '$25 Amazon Gift Card', 'Valid for all items on Amazon', 25.00, 25.00, true),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '$50 Amazon Gift Card', 'Valid for all items on Amazon', 50.00, 50.00, true),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', '$50 Apple Gift Card', 'For App Store, Apple Music, and devices', 50.00, 50.00, true),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000003', '$20 Steam Wallet Code', 'Instantly add funds to your Steam wallet', 20.00, 20.00, true)
ON CONFLICT (company_id, title) DO NOTHING;

-- Seed Exchange Rates
INSERT INTO public.exchange_rates (base_curr, target_curr, rate)
VALUES
  ('USD', 'USD', 1.000000),
  ('USD', 'INR', 83.500000),
  ('USD', 'EUR', 0.920000),
  ('USD', 'GBP', 0.790000),
  ('USD', 'AUD', 1.520000),
  ('USD', 'CAD', 1.360000),
  ('USD', 'AED', 3.672500)
ON CONFLICT (base_curr, target_curr) DO UPDATE SET rate = EXCLUDED.rate;

-- Seed / Guarantee Default Admin Account (admin@123.com / admin@123)
-- Clean all NULL token columns across auth.users to prevent GoTrue "Database error querying schema"
UPDATE auth.users
SET 
  confirmation_token          = COALESCE(confirmation_token, ''),
  recovery_token              = COALESCE(recovery_token, ''),
  email_change_token_new      = COALESCE(email_change_token_new, ''),
  email_change_token_current  = COALESCE(email_change_token_current, ''),
  email_change                = COALESCE(email_change, ''),
  phone_change                = COALESCE(phone_change, ''),
  phone_change_token          = COALESCE(phone_change_token, ''),
  reauthentication_token      = COALESCE(reauthentication_token, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  is_sso_user                 = COALESCE(is_sso_user, false),
  is_anonymous                = COALESCE(is_anonymous, false),
  is_super_admin              = COALESCE(is_super_admin, false);

DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@123.com';

  IF v_admin_id IS NULL THEN
    v_admin_id := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change_token_current,
      email_change,
      phone_change,
      phone_change_token,
      reauthentication_token,
      email_change_confirm_status,
      is_sso_user,
      is_anonymous,
      is_super_admin
    ) VALUES (
      v_admin_id,
      '00000000-0000-0000-0000-000000000000',
      'admin@123.com',
      crypt('admin@123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb,
      '{"role":"admin","full_name":"Master Admin"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      0,
      false,
      false,
      false
    );
  ELSE
    UPDATE auth.users
    SET 
      encrypted_password          = crypt('admin@123', gen_salt('bf')),
      email_confirmed_at          = now(),
      confirmation_token          = COALESCE(confirmation_token, ''),
      recovery_token              = COALESCE(recovery_token, ''),
      email_change_token_new      = COALESCE(email_change_token_new, ''),
      email_change_token_current  = COALESCE(email_change_token_current, ''),
      email_change                = COALESCE(email_change, ''),
      phone_change                = COALESCE(phone_change, ''),
      phone_change_token          = COALESCE(phone_change_token, ''),
      reauthentication_token      = COALESCE(reauthentication_token, ''),
      raw_app_meta_data           = jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', 'admin'),
      raw_user_meta_data          = jsonb_build_object('role', 'admin', 'full_name', 'Master Admin')
    WHERE id = v_admin_id;
  END IF;

  -- Ensure matching row exists in auth.identities
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_admin_id) THEN
    BEGIN
      INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        v_admin_id,
        v_admin_id,
        jsonb_build_object('sub', v_admin_id::text, 'email', 'admin@123.com'),
        'email',
        v_admin_id::text,
        now(),
        now(),
        now()
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  INSERT INTO public.profiles (id, email, role, wallet_balance)
  VALUES (v_admin_id, 'admin@123.com', 'admin', 999999.00)
  ON CONFLICT (id) DO UPDATE SET
    role = 'admin',
    email = 'admin@123.com';
END $$;

-- =============================================================================
-- GAMING HUB & LOTTERY GAME REDEMPTIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id             UUID NOT NULL REFERENCES public.coupons(id) ON DELETE CASCADE,
  game_user_id          TEXT NOT NULL,
  game_id               TEXT NOT NULL,
  wallet_transaction_id TEXT NOT NULL,
  ip_address            TEXT,
  device                TEXT,
  status                TEXT NOT NULL DEFAULT 'SUCCESS',
  redeemed_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon_id ON public.coupon_redemptions(coupon_id);
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_coupon_redemptions" ON public.coupon_redemptions;
CREATE POLICY "allow_all_coupon_redemptions" ON public.coupon_redemptions FOR ALL USING (true);
GRANT ALL ON public.coupon_redemptions TO anon, authenticated, service_role;

-- Country Normalizer
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
GRANT EXECUTE ON FUNCTION public.normalize_country_code(TEXT) TO anon, authenticated, service_role;

-- Verify Game Coupon Function
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
  FROM public.coupons c
  LEFT JOIN public.profiles p ON p.id = c.issued_to
  WHERE upper(trim(c.code)) = upper(trim(p_code));
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_game_coupon(TEXT) TO authenticated, anon, service_role;

-- Redeem Game Coupon Procedure
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
  FROM public.coupons
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

  -- Resolve coupon country
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

  IF v_coupon_country IS NOT NULL AND v_user_country IS NOT NULL THEN
    IF v_coupon_country <> v_user_country THEN
      RAISE EXCEPTION 'Country mismatch: This coupon was issued for % and cannot be redeemed by an account in %', v_coupon_country, v_user_country;
    END IF;
  END IF;

  UPDATE public.coupons
  SET is_used = true,
      remaining_balance = 0,
      status = 'redeemed',
      redeemed_at = now()
  WHERE id = p_coupon_id;

  INSERT INTO public.coupon_redemptions (
    coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status
  ) VALUES (
    p_coupon_id, p_game_user_id, p_game_id, p_wallet_transaction_id, p_ip_address, p_device, 'SUCCESS'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid, text, text, text, text, text, text) TO authenticated, anon, service_role;

-- Ensure coupons table has public SELECT & UPDATE policy for verification & redemption
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
CREATE POLICY "Allow select coupons for verification" ON public.coupons FOR SELECT USING (true);
GRANT SELECT, UPDATE ON public.coupons TO anon, authenticated, service_role;

-- Reload Supabase PostgREST Schema Cache
NOTIFY pgrst, 'reload schema';
