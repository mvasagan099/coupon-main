-- Keep different countries' nominal amounts in separate settlement rows.
BEGIN;
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS currency text;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.settlements'::regclass AND contype='u'
  AND pg_get_constraintdef(oid)='UNIQUE (company_id, period_month)' LOOP
  EXECUTE format('ALTER TABLE public.settlements DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS settlements_company_month_currency ON public.settlements(company_id,period_month,currency);
CREATE OR REPLACE FUNCTION public.generate_monthly_settlements(p_year integer,p_month integer,p_company_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE period_start timestamptz; period_end timestamptz; period text; inserted integer;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 period_start:=make_date(p_year,p_month,1)::timestamptz;
 period_end:=period_start+interval '1 month';
 period:=to_char(period_start,'YYYY-MM');
 IF EXISTS(SELECT 1 FROM public.settlements s WHERE s.period_month=period AND s.currency IS NULL AND (p_company_id IS NULL OR s.company_id=p_company_id)) THEN
  RAISE EXCEPTION 'Existing settlements need a verified currency before this month can be regenerated';
 END IF;
 IF EXISTS(SELECT 1 FROM public.redemptions r JOIN public.coupons c ON c.id=r.coupon_id
  WHERE r.created_at>=period_start AND r.created_at<period_end AND (p_company_id IS NULL OR c.company_id=p_company_id)
  AND public.currency_for_country(c.country_code) IS NULL) THEN RAISE EXCEPTION 'Redemption country is required for settlement'; END IF;
 INSERT INTO public.settlements(company_id,period_month,currency,total_redemptions,amount_due,status)
 SELECT c.company_id,period,public.currency_for_country(c.country_code),count(*)::integer,sum(r.amount),'pending'
 FROM public.redemptions r JOIN public.coupons c ON c.id=r.coupon_id
 WHERE r.created_at>=period_start AND r.created_at<period_end AND (p_company_id IS NULL OR c.company_id=p_company_id)
 GROUP BY c.company_id,public.currency_for_country(c.country_code)
 ON CONFLICT(company_id,period_month,currency) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT;
 RETURN inserted;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_monthly_settlements(integer,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_monthly_settlements(integer,integer,uuid) TO authenticated;
ALTER FUNCTION public.prevent_country_change() SET search_path=public;
NOTIFY pgrst,'reload schema';
COMMIT;
