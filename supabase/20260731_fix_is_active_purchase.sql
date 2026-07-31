-- =============================================================================
-- FIX v5: Fix wallet deduction blocked by enforce_wallet_balance_immutability trigger
--
-- ROOT CAUSE (FINAL):
--   20260730_security_hardening_v2.sql created a BEFORE UPDATE trigger:
--
--     IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
--       NEW.wallet_balance := OLD.wallet_balance;  -- silently resets balance!
--     END IF;
--
--   When issue_gift_card_coupon (SECURITY DEFINER) runs, current_setting('role')
--   returns 'authenticated' (the calling user's role), NOT 'postgres'.
--   So the trigger overwrites NEW.wallet_balance with OLD.wallet_balance before
--   the row is written — the deduction is silently discarded every time.
--
-- FIX:
--   Add 'postgres' to the allowed roles list in the trigger, so SECURITY DEFINER
--   functions owned by postgres can legitimately deduct wallet_balance.
--   'postgres' is the owner of all SECURITY DEFINER functions created in the
--   Supabase SQL Editor and is the trusted server-side identity.
--
-- RUN IN: Supabase Dashboard -> SQL Editor
-- =============================================================================

-- STEP 0: Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- STEP 1: Add missing is_active column to gift_cards
ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- STEP 2 (THE CRITICAL FIX): Update the wallet-immutability trigger to allow
--         the 'postgres' role to change wallet_balance.
--         'postgres' is what current_setting('role') returns inside a
--         SECURITY DEFINER function called from an authenticated session.
CREATE OR REPLACE FUNCTION public.lock_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow balance changes from:
  --   service_role   — Edge Functions / backend API (service key)
  --   supabase_admin — Supabase internal admin
  --   postgres       — SECURITY DEFINER functions (issue_gift_card_coupon, etc.)
  -- Block balance changes from:
  --   authenticated  — direct client-side PostgREST calls (wallet forgery)
  --   anon           — unauthenticated callers
  IF current_setting('role') NOT IN ('service_role', 'supabase_admin', 'postgres') THEN
    -- Silently reset wallet_balance to its old value (client cannot mint funds)
    NEW.wallet_balance := OLD.wallet_balance;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-attach the trigger (idempotent)
DROP TRIGGER IF EXISTS enforce_wallet_balance_immutability ON public.profiles;
CREATE TRIGGER enforce_wallet_balance_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_wallet_balance();

-- STEP 3: Rewrite issue_gift_card_coupon with verified deduction
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
  -- 1. Security: caller must be the beneficiary
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Look up the authoritative price (ignore client-supplied p_amount)
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

  -- 3. Lock the profile row and read current balance
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

  -- 4. Deduct balance — the trigger now allows this since current_setting('role')
  --    = 'postgres' when called from a SECURITY DEFINER function.
  UPDATE profiles
  SET wallet_balance = wallet_balance - v_real_price
  WHERE id = p_user_id
  RETURNING wallet_balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet deduction failed — 0 rows updated. '
      'Verify the lock_wallet_balance trigger allows the postgres role.';
  END IF;

  -- 5. Fetch company prefix
  SELECT prefix INTO v_prefix
  FROM companies
  WHERE id = v_company_id
  FOR UPDATE;

  -- 6. Generate unique coupon code
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

  -- 7. Insert coupon
  INSERT INTO coupons (company_id, code, issued_to, gift_card_id,
                       remaining_balance, expiry_date, status)
  VALUES (v_company_id, v_code, p_user_id, p_gift_card_id,
          v_real_price, COALESCE(v_expiry_date, now() + interval '1 year'), 'active')
  RETURNING id INTO v_coupon_id;

  -- 8. Insert order
  INSERT INTO orders (user_id, company_id, coupon_id, gift_card_id, status, amount)
  VALUES (p_user_id, v_company_id, v_coupon_id, p_gift_card_id, 'paid', v_real_price)
  RETURNING id INTO v_order_id;

  RETURN QUERY SELECT v_code, v_order_id, v_coupon_id;
END;
$$;

-- STEP 4: Rebuild get_gift_cards_with_counts (DROP required for return type change)
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

-- STEP 5: Re-grant EXECUTE
GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_wallet_balance(uuid, numeric)        TO authenticated;

-- =============================================================================
-- VERIFICATION: Run these AFTER applying to confirm the fix works
-- =============================================================================
-- 1. Check trigger allows postgres:
--    SELECT prosrc FROM pg_proc WHERE proname = 'lock_wallet_balance';
--    Should contain: 'service_role', 'supabase_admin', 'postgres'
--
-- 2. Check wallet IS deducted after purchase:
--    SELECT wallet_balance FROM profiles WHERE id = '<your-user-id>';
--    Buy a card, then re-run — balance should decrease by card price.
--
-- 3. Confirm client cannot forge balance (security check):
--    UPDATE public.profiles SET wallet_balance = 999999 WHERE id = auth.uid();
--    SELECT wallet_balance FROM public.profiles WHERE id = auth.uid();
--    Should still show original value (trigger blocked it for authenticated role).
