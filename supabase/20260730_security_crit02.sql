-- =============================================================================
-- Security Hardening v3 — CRIT-02, CRIT-03, HIGH-01, HIGH-02
-- RUN IN: Supabase Dashboard → SQL Editor
-- =============================================================================

-- =============================================================================
-- CRIT-02 PART A: Project-wide default-deny for database functions
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. This is
-- the root cause of CRIT-02: add_wallet_funds was callable by any authenticated
-- user with no payment verification. This block flips the default.
-- =============================================================================

-- Revoke EXECUTE from PUBLIC and authenticated on all public schema functions.
-- (anon and service_role are unaffected — service_role bypasses this entirely.)
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

-- =============================================================================
-- CRIT-02 PART B: Drop the vulnerable add_wallet_funds function
--
-- add_wallet_funds(uuid, numeric) allows any logged-in user to credit their
-- own wallet any amount with no payment verification — callable directly from
-- the browser via supabase.rpc(). The correct replacement (add_funds_secure)
-- already exists and is service_role only.
-- =============================================================================

DROP FUNCTION IF EXISTS public.add_wallet_funds(uuid, numeric);

-- =============================================================================
-- CRIT-03: Re-apply the canonical is_admin() definition
--
-- Five older SQL files define is_admin() to check raw_user_meta_data (which
-- any user can write to via supabase.auth.updateUser()). The correct version
-- checks app_metadata only. Re-applying it here makes the live state
-- deterministic regardless of which order previous migrations ran.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- app_metadata is server-controlled only — clients CANNOT write to it.
  -- user_metadata (raw_user_meta_data) CAN be written by the client SDK;
  -- do NOT use it for authorization checks.
  RETURN (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
END;
$$;

-- Confirm the trigger that prevents client role escalation via user_metadata is present.
-- (This was added in 20260730_security_hardening.sql — idempotent to re-apply.)
CREATE OR REPLACE FUNCTION public.prevent_user_metadata_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Strip any 'role' key the client tries to inject into user_metadata.
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

-- =============================================================================
-- HIGH-02: Fix issue_gift_card_coupon to use the gift card's real price
--
-- Previously the function trusted p_amount from the client for both the wallet
-- deduction and the coupon's remaining_balance — never validating against the
-- gift card's actual listed price. A user with minted balance could purchase
-- any card at an arbitrary price.
-- =============================================================================

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
  -- Security: caller must be the beneficiary
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- HIGH-02: Look up the real price BEFORE any balance check.
  -- p_amount from the client is ignored; v_real_price is canonical.
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

  -- Lock the user's profile and check balance against the real price
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

  -- Deduct the REAL price (not the client-supplied amount)
  UPDATE profiles
  SET wallet_balance = wallet_balance - v_real_price
  WHERE id = p_user_id;

  -- Lock company to fetch prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

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

  -- Insert coupon with the REAL price as remaining_balance
  INSERT INTO coupons (company_id, code, issued_to, gift_card_id, remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id,
          v_real_price,  -- HIGH-02: real price, not p_amount
          COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  -- Insert order with the real price
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid',
          v_real_price)  -- HIGH-02: real price, not p_amount
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

-- =============================================================================
-- Re-grant EXECUTE only on the functions that authenticated users legitimately need
-- (All others remain revoked — default-deny posture established above.)
-- =============================================================================

-- is_admin() is used inline in RLS policies (not called directly by users)
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Functions called from the frontend via supabase.rpc():
GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_coupon_by_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_purchased_coupons() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_withdrawals() TO authenticated;

-- Server-side only (called by service_role / Edge Functions):
GRANT EXECUTE ON FUNCTION public.deduct_wallet_balance(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_funds_secure(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_user_admin_role(uuid, boolean) TO service_role;

-- =============================================================================
-- Verification queries (run after applying this migration)
-- =============================================================================
-- 1. Confirm add_wallet_funds is gone:
--    SELECT proname FROM pg_proc WHERE proname = 'add_wallet_funds'; -- 0 rows expected
--
-- 2. Confirm is_admin() reads app_metadata:
--    SELECT prosrc FROM pg_proc WHERE proname = 'is_admin';
--    -- should contain 'app_metadata', NOT 'raw_user_meta_data'
--
-- 3. From a browser session, attempt to mint funds (should fail with permission denied):
--    await supabase.rpc('add_wallet_funds', { p_user_id: uid, p_amount: 100 })
--    -- expected: { error: 'Could not find the function ...' }
--
-- 4. Check the strip_role_from_user_metadata trigger is present:
--    SELECT tgname FROM pg_trigger WHERE tgname = 'strip_role_from_user_metadata'; -- 1 row
