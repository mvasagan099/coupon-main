-- ============================================================
-- Migration: Enforce Country Locking System on Profiles
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Function to prevent country modification on existing profiles
CREATE OR REPLACE FUNCTION public.prevent_country_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If country_code is already set, disallow changing it
  IF OLD.country_code IS NOT NULL AND NEW.country_code IS DISTINCT FROM OLD.country_code THEN
    RAISE EXCEPTION 'Country cannot be changed once assigned to an account. Please create a new account if you relocate.';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Trigger on public.profiles BEFORE UPDATE
DROP TRIGGER IF EXISTS trg_prevent_country_change ON public.profiles;
CREATE TRIGGER trg_prevent_country_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_country_change();

-- Document column policy
COMMENT ON COLUMN public.profiles.country_code IS 'ISO country code locked permanently to account upon signup.';
