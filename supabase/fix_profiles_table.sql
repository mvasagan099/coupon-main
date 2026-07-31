-- Fix missing public.profiles table for wallet balance reads.
-- Run this in Supabase SQL Editor against the same project used by production.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance numeric NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Safe re-run: recreate policies
DROP POLICY IF EXISTS "user_view_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_insert_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_update_profile" ON public.profiles;

CREATE POLICY "user_view_profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "user_insert_profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "user_update_profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- Keep updated_at current
CREATE OR REPLACE FUNCTION public.set_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_profiles_updated_at();

-- Auto-create profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, wallet_balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_profile();

-- Backfill old users
INSERT INTO public.profiles (id, wallet_balance)
SELECT id, 0.00
FROM auth.users
ON CONFLICT (id) DO NOTHING;

COMMIT;
