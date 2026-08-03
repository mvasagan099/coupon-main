-- Add paypal_email to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS paypal_email TEXT;
