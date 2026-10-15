-- COUPONVAULT COUNTRY/WALLET UPDATE FOR AN EXISTING DATABASE
-- Applies only the 2026-10-15 country and local-wallet changes.
-- Requires the existing CouponVault schema and security/payment migration.
-- Does not reset tables, delete records, convert balances, or assign campaign countries.
-- Not required if these updates are already installed on your project.
BEGIN;
SET LOCAL search_path = public, extensions;
DO $$
DECLARE object_name text;
BEGIN
 FOREACH object_name IN ARRAY ARRAY['profiles','companies','gift_cards','coupons','orders','redemptions','withdrawals','deposits','payment_transactions','payment_credits','settlements'] LOOP
  IF to_regclass('public.'||object_name) IS NULL THEN
   RAISE EXCEPTION 'Existing CouponVault schema is incomplete: missing %. No updates applied.',object_name;
  END IF;
 END LOOP;
 IF to_regprocedure('public.assert_account_access(uuid)') IS NULL OR to_regprocedure('public.is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Apply the security/payment migration before this update. No updates applied.';
 END IF;
END;
$$;
-- Source: 20261015045528_country_scoped_local_wallets.sql
-- Country-scoped coupons and nominal local-currency wallets. No numeric balances are converted.
CREATE OR REPLACE FUNCTION public.currency_for_country(p_country text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE upper(trim(p_country)) WHEN 'IN' THEN 'INR' WHEN 'US' THEN 'USD' WHEN 'GB' THEN 'GBP' WHEN 'AE' THEN 'AED' WHEN 'AU' THEN 'AUD' END;
$$;
REVOKE ALL ON FUNCTION public.currency_for_country(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.currency_for_country(text) TO anon,authenticated,service_role;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.gift_cards ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.payment_credits ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.payment_credits ADD COLUMN IF NOT EXISTS wallet_amount numeric;
ALTER TABLE public.payment_credits ALTER COLUMN amount_usd DROP NOT NULL;
ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS wallet_amount numeric;
CREATE INDEX IF NOT EXISTS gift_cards_country_idx ON public.gift_cards(country_code);

CREATE OR REPLACE FUNCTION public.enforce_profile_currency()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE expected text;
BEGIN
 NEW.country_code:=upper(trim(NEW.country_code));
 IF TG_OP='UPDATE' AND OLD.country_code IS NOT NULL AND NEW.country_code IS DISTINCT FROM OLD.country_code THEN
  RAISE EXCEPTION 'Country cannot be changed after registration';
 END IF;
 IF NEW.country_code IS NOT NULL THEN
  expected:=public.currency_for_country(NEW.country_code);
  IF expected IS NULL THEN RAISE EXCEPTION 'Select a supported country'; END IF;
  IF NEW.currency IS NOT NULL AND NEW.currency IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Currency must match account country'; END IF;
  NEW.currency:=expected;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_profile_currency ON public.profiles;
CREATE TRIGGER enforce_profile_currency BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_currency();

CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE country text:=upper(trim(NEW.raw_user_meta_data->>'country_code')); currency text;
BEGIN
 currency:=public.currency_for_country(country);
 IF currency IS NULL THEN RAISE EXCEPTION 'Country is required to create an account'; END IF;
 INSERT INTO public.profiles(id,wallet_balance,country,country_code,currency,timezone,phone_country_code)
 VALUES(NEW.id,0,NEW.raw_user_meta_data->>'country',country,currency,NEW.raw_user_meta_data->>'timezone',NEW.raw_user_meta_data->>'phone_country_code');
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user_profile() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.enforce_card_country()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 NEW.country_code:=upper(trim(NEW.country_code));
 NEW.currency:=public.currency_for_country(NEW.country_code);
 IF NEW.currency IS NULL THEN RAISE EXCEPTION 'Select a country before publishing a coupon'; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_card_country ON public.gift_cards;
CREATE TRIGGER enforce_card_country BEFORE INSERT OR UPDATE ON public.gift_cards FOR EACH ROW EXECUTE FUNCTION public.enforce_card_country();

CREATE OR REPLACE FUNCTION public.issue_gift_card_coupon(
 p_gift_card_id uuid, p_user_id uuid, p_amount numeric
)
RETURNS TABLE (coupon_code text, order_id uuid, coupon_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
 v_profile public.profiles%ROWTYPE;
 v_card public.gift_cards%ROWTYPE;
 v_company public.companies%ROWTYPE;
 v_code text; v_coupon uuid; v_order uuid; v_country text;
BEGIN
 IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Unauthorized';
 END IF;
 PERFORM public.assert_account_access(auth.uid());
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
 SELECT * INTO v_card FROM public.gift_cards WHERE id=p_gift_card_id FOR UPDATE;
 IF NOT FOUND OR NOT v_card.is_active THEN RAISE EXCEPTION 'Gift card not found or inactive'; END IF;
 IF v_card.price IS NULL OR NOT(v_card.price>0 AND v_card.price<=1000000) OR v_card.value IS NULL OR NOT(v_card.value>0 AND v_card.value<=1000000) THEN RAISE EXCEPTION 'Gift card has no valid price'; END IF;
 IF v_card.expiry_date IS NOT NULL AND v_card.expiry_date <= now() THEN RAISE EXCEPTION 'Gift card has expired'; END IF;
 IF public.currency_for_country(v_profile.country_code) IS NULL OR v_card.country_code IS DISTINCT FROM v_profile.country_code OR v_card.currency IS DISTINCT FROM v_profile.currency THEN RAISE EXCEPTION 'Coupon is only available to users from its selected country'; END IF;
 IF v_profile.wallet_balance < v_card.price THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
 SELECT * INTO v_company FROM public.companies WHERE id=v_card.company_id FOR UPDATE;
 IF NOT FOUND OR v_company.status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'Company is not approved'; END IF;
 IF (SELECT count(*) FROM public.coupons WHERE company_id=v_company.id) >= v_company.coupon_limit THEN
  RAISE EXCEPTION 'Company coupon limit reached';
 END IF;
 IF v_card.issue_limit IS NOT NULL AND (SELECT count(*) FROM public.coupons WHERE gift_card_id=v_card.id) >= v_card.issue_limit THEN
  RAISE EXCEPTION 'Gift card issue limit reached';
 END IF;
 v_country := public.normalize_country_code(COALESCE(v_profile.country_code, v_profile.country));
 IF v_country IS NULL THEN RAISE EXCEPTION 'Account country is required'; END IF;
 FOR attempt IN 1..10 LOOP
  v_code := trim(v_company.prefix)||'-'||upper(encode(gen_random_bytes(8),'hex'));
  EXIT WHEN NOT EXISTS (SELECT 1 FROM public.coupons WHERE code=v_code);
  IF attempt=10 THEN RAISE EXCEPTION 'Could not generate unique coupon code'; END IF;
 END LOOP;
 -- p_amount remains in the signature for API compatibility; the stored price is authoritative.
 UPDATE public.profiles SET wallet_balance=wallet_balance-v_card.price WHERE id=p_user_id;
 INSERT INTO public.coupons(company_id,code,issued_to,gift_card_id,amount,remaining_balance,expiry_date,status,is_used,country_code)
 VALUES(v_company.id,v_code,p_user_id,v_card.id,v_card.value,v_card.value,
  COALESCE(v_card.expiry_date,now()+interval '1 year'),'active',false,v_card.country_code)
 RETURNING id INTO v_coupon;
 INSERT INTO public.orders(user_id,company_id,coupon_id,gift_card_id,status,amount)
 VALUES(p_user_id,v_company.id,v_coupon,v_card.id,'paid',v_card.price) RETURNING id INTO v_order;
 RETURN QUERY SELECT v_code,v_order,v_coupon;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_coupon_amount(p_coupon_id uuid,p_amount numeric)
RETURNS TABLE(remaining_balance numeric,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.coupons%ROWTYPE; v_balance numeric; v_status text; v_country text;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 SELECT * INTO c FROM public.coupons WHERE id=p_coupon_id FOR UPDATE;
 IF NOT FOUND OR (c.issued_to IS DISTINCT FROM auth.uid() AND NOT public.is_admin() AND NOT EXISTS (
   SELECT 1 FROM public.companies co WHERE co.id=c.company_id AND co.owner_id=auth.uid() AND co.status='approved')) THEN
  RAISE EXCEPTION 'Coupon not found or unauthorized';
 END IF;
 IF c.is_used OR lower(c.status) NOT IN ('active') OR (c.expiry_date IS NOT NULL AND c.expiry_date<=now()) THEN
  RAISE EXCEPTION 'Coupon is not active';
 END IF;
 SELECT p.country_code INTO v_country FROM public.profiles p WHERE p.id=c.issued_to;
 IF c.country_code IS NULL OR public.currency_for_country(v_country) IS NULL OR c.country_code IS DISTINCT FROM v_country THEN
  RAISE EXCEPTION 'Coupon can only be redeemed for a user from its selected country';
 END IF;
 IF p_amount IS NULL OR NOT (p_amount>0 AND p_amount<=1000000) THEN RAISE EXCEPTION 'Invalid redemption amount'; END IF;
 v_balance:=COALESCE(c.remaining_balance,0);
 IF v_balance<p_amount THEN RAISE EXCEPTION 'Insufficient coupon balance'; END IF;
 v_balance:=v_balance-p_amount;
 v_status:=CASE WHEN v_balance=0 THEN 'redeemed' ELSE 'active' END;
 UPDATE public.coupons SET remaining_balance=v_balance,status=v_status,is_used=(v_balance=0),
 redeemed_at=CASE WHEN v_balance=0 THEN now() ELSE redeemed_at END WHERE id=c.id;
 INSERT INTO public.redemptions(coupon_id,amount,remaining_balance_after) VALUES(c.id,p_amount,v_balance);
 RETURN QUERY SELECT v_balance,v_status;
END;
$$;

DROP FUNCTION public.get_gift_cards_with_counts();
CREATE FUNCTION public.get_gift_cards_with_counts()
RETURNS TABLE(id uuid,title text,description text,price numeric,value numeric,company_id uuid,banner_image text,terms text,issue_limit integer,expiry_date timestamptz,created_at timestamptz,company_name text,issued_count bigint,is_active boolean,country_code text,currency text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT g.id,g.title,g.description,g.price,g.value,g.company_id,g.banner_image,g.terms,g.issue_limit,g.expiry_date,g.created_at,c.name,
 (SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),g.is_active,g.country_code,g.currency
 FROM public.gift_cards g LEFT JOIN public.companies c ON c.id=g.company_id;
$$;
REVOKE ALL ON FUNCTION public.get_gift_cards_with_counts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric,p_currency text,p_routing text,p_account text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE expected text; w public.withdrawals%ROWTYPE;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 SELECT public.currency_for_country(country_code) INTO expected FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF expected IS NULL OR upper(p_currency) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Withdrawal currency must match your country'; END IF;
 IF p_amount IS NULL OR NOT(p_amount>0 AND p_amount<=100000) OR p_amount<>round(p_amount,2)
  OR p_routing IS NULL OR length(trim(p_routing))=0 OR p_account IS NULL OR length(trim(p_account))=0 THEN RAISE EXCEPTION 'Invalid withdrawal details'; END IF;
 INSERT INTO public.withdrawals(user_id,amount,currency,routing_number,account_number,status)
 VALUES(auth.uid(),p_amount,expected,p_routing,p_account,'pending') RETURNING * INTO w;
 RETURN to_jsonb(w);
END;
$$;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_verified_payment(p_transaction_id uuid,p_capture_id text,p_amount numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.payment_transactions%ROWTYPE; v_balance numeric; expected text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted payment verification required'; END IF;
 SELECT * INTO t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Payment order not found'; END IF;
 IF p_amount IS DISTINCT FROM t.amount_major OR upper(p_currency) IS DISTINCT FROM upper(t.currency)
  OR p_capture_id IS NULL OR length(trim(p_capture_id))=0 THEN RAISE EXCEPTION 'Captured payment mismatch'; END IF;
 IF t.status='paid' THEN
  IF t.gateway_payment_id IS DISTINCT FROM p_capture_id THEN RAISE EXCEPTION 'Capture mismatch'; END IF;
  RETURN jsonb_build_object('alreadyCredited',true);
 END IF;
 IF t.status NOT IN ('pending','processing') THEN RAISE EXCEPTION 'Payment cannot be credited in this state'; END IF;
 SELECT public.currency_for_country(country_code) INTO expected FROM public.profiles WHERE id=t.user_id FOR UPDATE;
 IF expected IS NULL OR upper(t.currency) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Payment currency must match wallet country'; END IF;
 IF t.amount_major IS NULL OR NOT(t.amount_major>0 AND t.amount_major<=1000000) OR t.amount_major<>round(t.amount_major,2) THEN RAISE EXCEPTION 'Invalid payment amount'; END IF;
 PERFORM public.assert_account_access(t.user_id);
 INSERT INTO public.payment_credits(transaction_id,gateway,capture_id,amount_usd,currency,wallet_amount)
 VALUES(t.id,t.gateway,p_capture_id,CASE WHEN t.currency='USD' THEN t.amount_major ELSE NULL END,t.currency,t.amount_major);
 UPDATE public.profiles SET wallet_balance=wallet_balance+t.amount_major WHERE id=t.user_id RETURNING wallet_balance INTO v_balance;
 IF NOT FOUND THEN RAISE EXCEPTION 'Wallet profile missing'; END IF;
 INSERT INTO public.deposits(user_id,amount,payment_method,reference_id,status,currency)
 VALUES(t.user_id,t.amount_major,t.gateway,p_capture_id,'completed',t.currency);
 UPDATE public.payment_transactions SET status='paid',gateway_payment_id=p_capture_id,updated_at=now() WHERE id=t.id;
 RETURN jsonb_build_object('alreadyCredited',false,'balance',v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) TO service_role;
REVOKE ALL ON FUNCTION public.enforce_card_country(),public.enforce_profile_currency() FROM PUBLIC,anon,authenticated;

-- Source: 20261015051144_country_currency_settlements.sql
-- Keep different countries' nominal amounts in separate settlement rows.
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
SELECT 'CouponVault existing-database country/wallet updates complete' AS result;
