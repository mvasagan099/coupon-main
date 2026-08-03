-- ============================================================
-- Migration: Update admin_get_withdrawals RPC to include country & currency
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Drop old function signature first because returning table columns changed
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
