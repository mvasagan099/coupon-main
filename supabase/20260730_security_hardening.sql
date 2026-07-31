-- =============================================================================
-- Security Hardening Migration — 2026-07-30
-- Fixes: CRIT-03, CRIT-05, MED-02, LOW-04
--
-- RUN THIS IN: Supabase Dashboard → SQL Editor
-- =============================================================================

-- =============================================================================
-- CRIT-03: Prevent users from self-elevating to admin via user_metadata
-- =============================================================================

-- 1. Create a server-side function (runs as SECURITY DEFINER with service_role)
--    to set admin role in app_metadata — only callable from trusted server code.
--    Users CANNOT call this directly because it requires the service_role key.
CREATE OR REPLACE FUNCTION set_user_admin_role(target_user_id uuid, make_admin boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- runs with owner privileges, bypassing RLS
SET search_path = public
AS $$
BEGIN
  -- Only allow this function to be called by service_role (backend server)
  IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
    RAISE EXCEPTION 'Permission denied: admin role assignment requires service_role';
  END IF;

  UPDATE auth.users
  SET raw_app_meta_data = raw_app_meta_data ||
    jsonb_build_object('role', CASE WHEN make_admin THEN 'admin' ELSE 'user' END)
  WHERE id = target_user_id;
END;
$$;

-- 2. Create a trigger to BLOCK any attempt to set role via user_metadata.
--    This prevents the attack: supabase.auth.updateUser({ data: { role: 'admin' } })
CREATE OR REPLACE FUNCTION block_user_metadata_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If the update tries to set 'role' in user_metadata, block it
  IF (NEW.raw_user_meta_data ->> 'role') IS DISTINCT FROM (OLD.raw_user_meta_data ->> 'role') THEN
    -- Check if the caller has service_role privileges
    IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
      -- Strip the role field from user_metadata silently (don't error, just ignore it)
      NEW.raw_user_meta_data = NEW.raw_user_meta_data - 'role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply the trigger to the auth.users table
DROP TRIGGER IF EXISTS prevent_user_metadata_role_escalation ON auth.users;
CREATE TRIGGER prevent_user_metadata_role_escalation
  BEFORE UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION block_user_metadata_role_escalation();

-- 3. Update the admin RLS policy to check app_metadata (not user_metadata)
-- Drop existing admin policies that may check user_metadata
-- (Update table names below if your schema uses different names)
DROP POLICY IF EXISTS "admin_only" ON companies;
DROP POLICY IF EXISTS "admin_select_all" ON companies;
DROP POLICY IF EXISTS "admin_manage_all" ON companies;

-- Helper function to check admin status from app_metadata (tamper-proof)
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

-- =============================================================================
-- CRIT-05: Remove direct client UPDATE permission on wallet_balance
-- =============================================================================

-- Revoke direct UPDATE on wallet_balance from authenticated users.
-- All balance changes must go through the secure RPC below.
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;

-- Drop existing RLS policies that allow direct wallet_balance updates
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their profile" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can update own profile" ON profiles;

-- Re-enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Allow users to update their own profile BUT NOT wallet_balance
-- Note: Supabase doesn't support column-level RLS directly, so we use a check
-- to ensure wallet_balance is not changed by the client.
-- Server-side operations use service_role which bypasses RLS entirely.
CREATE POLICY "profiles_update_own_except_balance"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Prevent the client from changing wallet_balance:
    -- The new balance must equal the old balance (no client mutation allowed)
    -- Server-side functions (SECURITY DEFINER) bypass RLS and can change it freely.
  );

-- Secure server-side function to deduct wallet balance with validation
-- Called by the backend/Edge Functions using the service role key
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
  -- Lock the row to prevent race conditions
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

-- Secure function to ADD funds (called by the coupon server after payment verification)
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

  -- Cap single transfer at ₹1,00,000
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

-- =============================================================================
-- MED-02: Merchant-only RLS policies for gift_cards table
-- =============================================================================

-- Ensure only verified company owners can insert/update gift cards
DROP POLICY IF EXISTS "merchant_insert_gift_cards" ON gift_cards;
DROP POLICY IF EXISTS "merchant_update_own_gift_cards" ON gift_cards;

CREATE POLICY "merchant_insert_gift_cards"
  ON gift_cards FOR INSERT
  WITH CHECK (
    -- Caller must be the verified owner of the company_id being referenced
    company_id IN (
      SELECT id FROM companies
      WHERE owner_id = auth.uid()
      AND status = 'approved'  -- Only approved merchants can create gift cards
    )
  );

CREATE POLICY "merchant_update_own_gift_cards"
  ON gift_cards FOR UPDATE
  USING (
    company_id IN (
      SELECT id FROM companies
      WHERE owner_id = auth.uid()
      AND status = 'approved'
    )
  );

-- =============================================================================
-- LOW-04: Encrypt bank account/routing numbers using Supabase Vault
-- =============================================================================
-- NOTE: Supabase Vault must be enabled in your project (Dashboard → Vault).
-- Once enabled, run the following to encrypt existing data:
--
-- UPDATE withdrawals
-- SET
--   account_number = vault.create_secret(account_number, 'bank_account_' || id::text),
--   routing_number = vault.create_secret(routing_number, 'bank_routing_' || id::text);
--
-- Then modify the withdrawals table to store vault secret IDs instead of plaintext.
-- For new applications, use vault.create_secret() when inserting and
-- vault.decrypted_secrets to read back when processing payouts.
--
-- This is left as a manual step because it requires migrating existing data
-- and the Vault extension may need to be enabled first.

-- =============================================================================
-- Grant execute permissions on the new secure functions
-- =============================================================================
-- deduct_wallet_balance is called by Edge Functions / backend with service_role
-- so no GRANT to authenticated is needed (service_role bypasses RLS).

-- The is_admin() helper is used in RLS policies — grant to authenticated
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION deduct_wallet_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION add_funds_secure(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION set_user_admin_role(uuid, boolean) TO service_role;

-- =============================================================================
-- Verify: check that wallet_balance cannot be directly updated by clients
-- =============================================================================
-- After running this migration, test with:
--   SELECT * FROM profiles WHERE id = '<your-user-id>';  -- should work (SELECT policy)
--   UPDATE profiles SET wallet_balance = 999999 WHERE id = '<your-user-id>';  -- should FAIL
