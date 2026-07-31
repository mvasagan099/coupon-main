-- =============================================================================
-- Security Hardening v2 — 2026-07-30
-- Fixes: CRIT-01 (wallet_balance forgery via PostgREST)
--
-- RUN THIS IN: Supabase Dashboard → SQL Editor (after the v1 migration)
-- =============================================================================

-- =============================================================================
-- CRIT-01: Lock wallet_balance — BEFORE UPDATE trigger
--
-- Background: The RLS policy "profiles_update_own_except_balance" in the v1
-- migration contains only a comment describing its intent; the WITH CHECK
-- clause only verifies auth.uid() = id but does NOT compare wallet_balance
-- between old and new rows. Any authenticated user can therefore call:
--
--   supabase.from('profiles').update({ wallet_balance: 999999 }).eq('id', uid)
--
-- and freely mint funds. The trigger below closes this at the database engine
-- level: for any UPDATE on profiles, if the caller is not service_role or
-- supabase_admin, the trigger silently overwrites NEW.wallet_balance with
-- OLD.wallet_balance before the row is written — making the column
-- structurally immutable to authenticated (client-side) callers.
-- =============================================================================

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION lock_wallet_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only service_role and supabase_admin may change wallet_balance.
  -- Authenticated clients (PostgREST / frontend) are silently prevented.
  IF current_setting('role') NOT IN ('service_role', 'supabase_admin') THEN
    -- Overwrite any client-supplied wallet_balance with the current value
    NEW.wallet_balance := OLD.wallet_balance;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Attach the trigger BEFORE every UPDATE on profiles
DROP TRIGGER IF EXISTS enforce_wallet_balance_immutability ON public.profiles;
CREATE TRIGGER enforce_wallet_balance_immutability
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION lock_wallet_balance();

-- 3. Belt-and-suspenders: also revoke column-level UPDATE privilege on
--    wallet_balance from the authenticated role. This causes PostgREST to
--    return a 403 if the client explicitly tries to include wallet_balance
--    in an UPDATE, rather than silently ignoring it via the trigger.
--    (The trigger above is still needed for SECURITY DEFINER functions that
--    run as authenticated but legitimately touch other columns.)
REVOKE UPDATE (wallet_balance) ON public.profiles FROM authenticated;

-- 4. Fix the broken WITH CHECK clause on the existing RLS policy so that it
--    no longer misleadingly implies it protects wallet_balance.
--    Drop and recreate with an accurate comment.
DROP POLICY IF EXISTS "profiles_update_own_except_balance" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
-- wallet_balance immutability is enforced by the trigger above, not this policy.

-- =============================================================================
-- Verification queries (run these manually after applying the migration)
-- =============================================================================
-- As an authenticated user (not service_role), this should NO-OP (balance unchanged):
--   UPDATE public.profiles SET wallet_balance = 999999 WHERE id = auth.uid();
--   SELECT wallet_balance FROM public.profiles WHERE id = auth.uid(); -- original value
--
-- As service_role (Edge Function / backend), this should succeed:
--   UPDATE public.profiles SET wallet_balance = wallet_balance + 100 WHERE id = '<uuid>';
