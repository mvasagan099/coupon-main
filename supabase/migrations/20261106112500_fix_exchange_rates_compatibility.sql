-- Migration: 20261106112500_fix_exchange_rates_compatibility.sql
-- Description: Allow base_currency and target_currency in exchange_rates with bidirectional trigger compatibility.

BEGIN;

ALTER TABLE public.exchange_rates ALTER COLUMN base_curr DROP NOT NULL;
ALTER TABLE public.exchange_rates ALTER COLUMN target_curr DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_exchange_rate_compat()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.base_currency IS NOT NULL AND NEW.base_curr IS NULL THEN
    NEW.base_curr := substring(NEW.base_currency from 1 for 3);
  ELSIF NEW.base_curr IS NOT NULL AND NEW.base_currency IS NULL THEN
    NEW.base_currency := trim(NEW.base_curr);
  END IF;

  IF NEW.target_currency IS NOT NULL AND NEW.target_curr IS NULL THEN
    NEW.target_curr := substring(NEW.target_currency from 1 for 3);
  ELSIF NEW.target_curr IS NOT NULL AND NEW.target_currency IS NULL THEN
    NEW.target_currency := trim(NEW.target_curr);
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sync_exchange_rate_compat') THEN
    CREATE TRIGGER trg_sync_exchange_rate_compat
      BEFORE INSERT OR UPDATE ON public.exchange_rates
      FOR EACH ROW EXECUTE FUNCTION public.sync_exchange_rate_compat();
  END IF;
END $$;

COMMIT;
