-- Fix is_admin() to check both app_metadata and user_metadata
-- This is necessary because some users were assigned the admin role via user_metadata

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' OR 
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin', 
    false
  );
$$;
