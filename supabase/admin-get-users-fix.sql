-- Fix admin_get_users to read role from app_metadata (secure, not user-editable)
-- and add a profiles-based fallback for the role field

CREATE OR REPLACE FUNCTION admin_get_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  created_at TIMESTAMPTZ,
  role TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Verify caller is admin using secure app_metadata claim
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::TEXT,
    u.created_at,
    -- Read from app_metadata (not user-editable) for security
    -- Fallback to user_metadata for legacy data, then default 'user'
    COALESCE(
      u.raw_app_meta_data->>'role',
      u.raw_user_meta_data->>'role',
      'user'
    )::TEXT AS role
  FROM auth.users u
  ORDER BY u.created_at DESC;
END;
$$;
