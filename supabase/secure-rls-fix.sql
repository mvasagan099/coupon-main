-- =========================================================================
-- SECURE RLS VULNERABILITY FIX (USER_METADATA -> APP_METADATA)
-- =========================================================================

-- The Supabase Linter is warning you because your `is_admin()` function was reading from `user_metadata`.
-- Because users can edit their own `user_metadata` from the frontend, a malicious user could potentially make themselves an admin!
-- This script safely redefines the `is_admin()` function to check the highly secure `app_metadata` inside the JWT token instead.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
