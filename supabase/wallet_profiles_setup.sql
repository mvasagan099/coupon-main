-- ============================================================
-- PROFILES TABLE + WALLET BALANCE SETUP
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Create profiles table linked to auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance NUMERIC NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0),
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (safe re-run)
DROP POLICY IF EXISTS "admin_all_profiles"  ON public.profiles;
DROP POLICY IF EXISTS "user_view_profile"   ON public.profiles;
DROP POLICY IF EXISTS "user_update_profile" ON public.profiles;
DROP POLICY IF EXISTS "user_insert_profile" ON public.profiles;

-- Policies: users can only access their own row
CREATE POLICY "user_view_profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "user_insert_profile"
  ON public.profiles FOR INSERT
  WITH CHECK (id = auth.uid());

CREATE POLICY "user_update_profile"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid());

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, wallet_balance)
  VALUES (NEW.id, 0.00)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: create profile rows for users who signed up before this migration
INSERT INTO public.profiles (id, wallet_balance)
SELECT id, 0.00
FROM auth.users
ON CONFLICT (id) DO NOTHING;
