-- ============================================================
-- BUG FIX: 403 Permission Denied for Table Users
-- ============================================================
-- The previous version of is_admin() queried `auth.users` directly.
-- When called from the frontend, this triggered a "permission denied" error
-- because the authenticated role does not have SELECT access to auth.users.
-- 
-- This updated function reads the role securely from the user's JWT instead,
-- completely avoiding the table lookup and fixing the 403 errors across
-- the orders, coupons, gift_cards, and redemptions tables!

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', false);
$$;
