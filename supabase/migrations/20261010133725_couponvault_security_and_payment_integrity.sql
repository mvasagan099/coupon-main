-- Incremental migration: preserves existing application data and payment history.
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_account_active(p_user_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin() THEN
  RETURN false;
 END IF;
 RETURN EXISTS (SELECT 1 FROM public.profiles WHERE id=p_user_id AND NOT is_locked);
END;
$$;
CREATE OR REPLACE FUNCTION public.assert_account_access(p_user_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT public.is_account_active(p_user_id) THEN RAISE EXCEPTION 'Account is locked or unavailable'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.is_account_active(uuid),public.assert_account_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid),public.assert_account_access(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_set_account_locked(p_user_id uuid,p_locked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF NOT public.is_admin() OR p_user_id=auth.uid() THEN RAISE EXCEPTION 'Unauthorized account update'; END IF;
 UPDATE public.profiles SET is_locked=p_locked WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account not found'; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_get_account_locks()
RETURNS TABLE(id uuid,is_locked boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 RETURN QUERY SELECT p.id,p.is_locked FROM public.profiles p;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_account_locked(uuid,boolean),public.admin_get_account_locks() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_set_account_locked(uuid,boolean),public.admin_get_account_locks() TO authenticated;

-- Locks also restrict database reads/writes, even with a previously issued JWT.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','companies','gift_cards','coupons','orders','redemptions','campaigns',
 'coupon_redemptions','withdrawals','deposits','settlements','wallet_transfers','payment_transactions','support_tickets','support_messages'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS account_must_be_active ON public.%I',t);
  EXECUTE format('CREATE POLICY account_must_be_active ON public.%I AS RESTRICTIVE TO authenticated USING (public.is_account_active(auth.uid())) WITH CHECK (public.is_account_active(auth.uid()))',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.protect_company_controls()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin','service_role') OR public.is_admin() THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.owner_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Unauthorized owner'; END IF;
  NEW.status:='pending'; NEW.coupon_limit:=100;
 ELSE
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.coupon_limit IS DISTINCT FROM OLD.coupon_limit THEN
   RAISE EXCEPTION 'Company ownership and limits are controlled by administrators';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='rejected' AND NEW.status='pending') THEN
   RAISE EXCEPTION 'Approval status is controlled by administrators';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_company_controls ON public.companies;
CREATE TRIGGER protect_company_controls BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.protect_company_controls();

-- Public table reads cover only branding. Authorized callers use a masked RPC for KYC.
REVOKE SELECT ON public.companies FROM anon,authenticated;
GRANT SELECT(id,name,prefix,created_at,status,owner_id) ON public.companies TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_companies()
RETURNS SETOF public.companies LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.companies%ROWTYPE;
BEGIN
 IF auth.uid() IS NOT NULL THEN PERFORM public.assert_account_access(auth.uid()); END IF;
 FOR c IN SELECT * FROM public.companies ORDER BY created_at DESC LOOP
  IF public.is_admin() OR (auth.uid() IS NOT NULL AND c.owner_id=auth.uid()) THEN RETURN NEXT c;
  ELSIF c.status='approved' THEN
   RETURN NEXT jsonb_populate_record(NULL::public.companies,jsonb_build_object('id',c.id,'name',c.name,'prefix',c.prefix,'status',c.status,'created_at',c.created_at));
  END IF;
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.get_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_companies() TO anon,authenticated,service_role;

DROP POLICY IF EXISTS "Allow select coupons for verification" ON public.coupons;
REVOKE SELECT ON public.coupons FROM anon;
DROP POLICY IF EXISTS authorized_coupon_reader ON public.coupons;
CREATE POLICY authorized_coupon_reader ON public.coupons FOR SELECT TO authenticated
 USING (issued_to=auth.uid() OR public.is_admin() OR EXISTS (
  SELECT 1 FROM public.companies co WHERE co.id=company_id AND co.owner_id=auth.uid() AND co.status='approved'));

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
 IF c.issued_to=auth.uid() THEN
  SELECT public.normalize_country_code(COALESCE(p.country_code,p.country)) INTO v_country FROM public.profiles p WHERE p.id=auth.uid();
  IF c.country_code IS NOT NULL AND public.normalize_country_code(c.country_code) IS DISTINCT FROM v_country THEN
   RAISE EXCEPTION 'Country mismatch';
  END IF;
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
REVOKE ALL ON FUNCTION public.redeem_coupon_amount(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_amount(uuid,numeric) TO authenticated;

-- Provider amounts, ownership, state and quotes are maintained by trusted servers only.
REVOKE INSERT,UPDATE,DELETE ON public.payment_transactions FROM authenticated,anon;
DROP POLICY IF EXISTS "user_insert_own_transactions" ON public.payment_transactions;
DROP POLICY IF EXISTS "user_update_own_transactions" ON public.payment_transactions;
CREATE UNIQUE INDEX IF NOT EXISTS payment_order_once ON public.payment_transactions(gateway,gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.payment_credits(
 transaction_id uuid PRIMARY KEY REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
 gateway text NOT NULL,
 capture_id text NOT NULL,
 amount_usd numeric NOT NULL CHECK(amount_usd>0 AND amount_usd<=1000000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(gateway,capture_id)
);
ALTER TABLE public.payment_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_credits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.payment_credits TO service_role;
CREATE OR REPLACE FUNCTION public.settle_verified_payment(p_transaction_id uuid,p_capture_id text,p_amount numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.payment_transactions%ROWTYPE; v_balance numeric;
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
 IF t.amount_usd IS NULL OR NOT (t.amount_usd>0 AND t.amount_usd<=1000000) OR t.exchange_rate IS NULL
  OR NOT (t.exchange_rate>0 AND t.exchange_rate<=1000000)
  OR t.amount_usd IS DISTINCT FROM round(t.amount_major*t.exchange_rate,2) THEN RAISE EXCEPTION 'Invalid stored currency quote'; END IF;
 PERFORM public.assert_account_access(t.user_id);
 INSERT INTO public.payment_credits(transaction_id,gateway,capture_id,amount_usd)
 VALUES(t.id,t.gateway,p_capture_id,t.amount_usd);
 UPDATE public.profiles SET wallet_balance=wallet_balance+t.amount_usd WHERE id=t.user_id RETURNING wallet_balance INTO v_balance;
 IF NOT FOUND THEN RAISE EXCEPTION 'Wallet profile missing'; END IF;
 INSERT INTO public.deposits(user_id,amount,payment_method,reference_id,status)
 VALUES(t.user_id,t.amount_usd,t.gateway,p_capture_id,'completed');
 UPDATE public.payment_transactions SET status='paid',gateway_payment_id=p_capture_id,updated_at=now() WHERE id=t.id;
 RETURN jsonb_build_object('alreadyCredited',false,'balance',v_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) TO service_role;

-- Previously seeded rates have no trusted publication date. Refresh them before conversion.
UPDATE public.exchange_rates SET updated_at=LEAST(updated_at,now()-interval '73 hours') WHERE target_currency<>'USD';
-- Withdrawals use a current stored FX rate; the existing balance trigger reserves funds atomically.
REVOKE INSERT ON public.withdrawals FROM authenticated,anon;
CREATE OR REPLACE FUNCTION public.request_withdrawal(p_amount numeric,p_currency text,p_routing text,p_account text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rate numeric:=1; v_amount numeric; w public.withdrawals%ROWTYPE;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF p_amount IS NULL OR NOT(p_amount>0 AND p_amount<=100000) OR p_currency IS NULL
  OR p_routing IS NULL OR length(trim(p_routing))=0 OR p_account IS NULL OR length(trim(p_account))=0 THEN RAISE EXCEPTION 'Invalid withdrawal details'; END IF;
 IF upper(p_currency)<>'USD' THEN
  SELECT rate INTO v_rate FROM public.exchange_rates WHERE base_currency='USD' AND target_currency=upper(p_currency)
   AND updated_at>=now()-interval '72 hours';
  IF v_rate IS NULL OR NOT (v_rate>0 AND v_rate<=1000000) THEN RAISE EXCEPTION 'Current exchange rate unavailable'; END IF;
 END IF;
 v_amount:=round(p_amount/v_rate,2);
 IF v_amount<=0 THEN RAISE EXCEPTION 'Withdrawal is below the minimum amount'; END IF;
 INSERT INTO public.withdrawals(user_id,amount,routing_number,account_number,status)
 VALUES(auth.uid(),v_amount,p_routing,p_account,'pending') RETURNING * INTO w;
 RETURN to_jsonb(w);
END;
$$;
REVOKE ALL ON FUNCTION public.request_withdrawal(numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric,text,text,text) TO authenticated;

-- A customer must not be able to impersonate a support administrator.
CREATE OR REPLACE FUNCTION public.protect_support_sender()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
 IF NEW.sender_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Invalid message sender'; END IF;
 NEW.is_admin:=public.is_admin();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_support_sender ON public.support_messages;
CREATE TRIGGER protect_support_sender BEFORE INSERT OR UPDATE ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.protect_support_sender();

-- All existing privileged browser RPCs must reject locked accounts before bypassing RLS.
DO $$ DECLARE f record; definition text; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('admin_get_users','admin_get_purchased_coupons','admin_get_withdrawals','generate_monthly_settlements') LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('assert_account_access' in definition)=0 THEN
   definition:=regexp_replace(definition,'\mBEGIN\M','BEGIN PERFORM public.assert_account_access(auth.uid());','i');
   EXECUTE definition;
  END IF;
 END LOOP;
END $$;

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
  COALESCE(v_card.expiry_date,now()+interval '1 year'),'active',false,v_country)
 RETURNING id INTO v_coupon;
 INSERT INTO public.orders(user_id,company_id,coupon_id,gift_card_id,status,amount)
 VALUES(p_user_id,v_company.id,v_coupon,v_card.id,'paid',v_card.price) RETURNING id INTO v_order;
 RETURN QUERY SELECT v_code,v_order,v_coupon;
END;
$$;


CREATE OR REPLACE FUNCTION public.validate_coupon(p_code TEXT)
RETURNS TABLE (
  coupon_id         UUID,
  company_name      TEXT,
  coupon_code       TEXT,
  is_used           BOOLEAN,
  issued_at         TIMESTAMPTZ,
  remaining_balance NUMERIC,
  expiry_date       TIMESTAMPTZ,
  status            TEXT,
  country_code      TEXT
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  RETURN QUERY
  SELECT
    cu.id AS coupon_id,
    co.name AS company_name,
    cu.code AS coupon_code,
    cu.is_used,
    cu.created_at AS issued_at,
    COALESCE(cu.remaining_balance, 0) AS remaining_balance,
    cu.expiry_date,
    cu.status,
    cu.country_code::TEXT
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE upper(trim(cu.code)) = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon code';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_coupon_by_id(p_coupon_id UUID)
RETURNS TABLE (
  coupon_id         UUID,
  company_name      TEXT,
  coupon_code       TEXT,
  is_used           BOOLEAN,
  issued_at         TIMESTAMPTZ,
  remaining_balance NUMERIC,
  expiry_date       TIMESTAMPTZ,
  status            TEXT,
  country_code      TEXT
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  RETURN QUERY
  SELECT
    cu.id AS coupon_id,
    co.name::TEXT AS company_name,
    cu.code::TEXT AS coupon_code,
    cu.is_used,
    cu.created_at AS issued_at,
    COALESCE(cu.remaining_balance, 0) AS remaining_balance,
    cu.expiry_date,
    cu.status,
    cu.country_code::TEXT
  FROM coupons cu
  JOIN companies co ON co.id = cu.company_id
  WHERE cu.id = p_coupon_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon ID';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_coupon(text),public.validate_coupon_by_id(uuid),public.verify_game_coupon(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text),public.validate_coupon_by_id(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_coupon(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verify_game_coupon(text) FROM authenticated;
-- Accounting rows are written only by the purchase/redemption functions and administrators.
DROP POLICY IF EXISTS user_insert_orders ON public.orders;
DROP POLICY IF EXISTS merchant_manage_redemptions ON public.redemptions;
DROP POLICY IF EXISTS merchant_read_redemptions ON public.redemptions;
CREATE POLICY merchant_read_redemptions ON public.redemptions FOR SELECT TO authenticated
 USING (EXISTS(SELECT 1 FROM public.coupons cu JOIN public.companies co ON co.id=cu.company_id WHERE cu.id=coupon_id AND co.owner_id=auth.uid()));
COMMIT;
