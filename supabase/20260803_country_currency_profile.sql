-- ============================================================
-- Migration: Add country & currency fields to profiles
-- Safe: uses ADD COLUMN IF NOT EXISTS — no data loss to existing rows
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- Add country fields to profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS country_code      CHAR(2),
  ADD COLUMN IF NOT EXISTS currency          CHAR(3)    DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS timezone          TEXT,
  ADD COLUMN IF NOT EXISTS phone_country_code TEXT;

-- Index for efficient country-based queries
CREATE INDEX IF NOT EXISTS idx_profiles_country_code ON public.profiles(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_currency      ON public.profiles(currency);

-- RLS: users can update their own country/currency fields
-- (existing "users can update own profile" policy covers this,
--  but we add explicit column grants just in case)
GRANT UPDATE (country, country_code, currency, timezone, phone_country_code)
  ON public.profiles TO authenticated;

-- Comment documenting the columns
COMMENT ON COLUMN public.profiles.country           IS 'Full country name (e.g. India)';
COMMENT ON COLUMN public.profiles.country_code      IS 'ISO 3166-1 alpha-2 (e.g. IN)';
COMMENT ON COLUMN public.profiles.currency          IS 'ISO 4217 currency code (e.g. INR)';
COMMENT ON COLUMN public.profiles.timezone          IS 'IANA timezone string (e.g. Asia/Kolkata)';
COMMENT ON COLUMN public.profiles.phone_country_code IS 'Phone dial code (e.g. +91)';

-- Auto-create/populate profile row on signup using metadata passed during auth.signUp()
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    wallet_balance,
    country,
    country_code,
    currency,
    timezone,
    phone_country_code
  )
  VALUES (
    NEW.id,
    0.00,
    NEW.raw_user_meta_data->>'country',
    NEW.raw_user_meta_data->>'country_code',
    NEW.raw_user_meta_data->>'currency',
    NEW.raw_user_meta_data->>'timezone',
    NEW.raw_user_meta_data->>'phone_country_code'
  )
  ON CONFLICT (id) DO UPDATE SET
    country            = COALESCE(EXCLUDED.country, public.profiles.country),
    country_code       = COALESCE(EXCLUDED.country_code, public.profiles.country_code),
    currency           = COALESCE(EXCLUDED.currency, public.profiles.currency),
    timezone           = COALESCE(EXCLUDED.timezone, public.profiles.timezone),
    phone_country_code = COALESCE(EXCLUDED.phone_country_code, public.profiles.phone_country_code);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill profiles table with country data from auth.users metadata for existing users
UPDATE public.profiles p
SET
  country            = COALESCE(p.country, u.raw_user_meta_data->>'country'),
  country_code       = COALESCE(p.country_code, u.raw_user_meta_data->>'country_code'),
  currency           = COALESCE(p.currency, u.raw_user_meta_data->>'currency'),
  timezone           = COALESCE(p.timezone, u.raw_user_meta_data->>'timezone'),
  phone_country_code = COALESCE(p.phone_country_code, u.raw_user_meta_data->>'phone_country_code')
FROM auth.users u
WHERE p.id = u.id
  AND p.country_code IS NULL
  AND u.raw_user_meta_data->>'country_code' IS NOT NULL;

