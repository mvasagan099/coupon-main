-- Data-preserving financial workflow corrections. No historical balances are rewritten.
BEGIN;
CREATE OR REPLACE FUNCTION public.process_withdrawal_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE balance numeric;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status IS DISTINCT FROM 'pending' OR NEW.amount IS NULL OR NOT(NEW.amount>0 AND NEW.amount<=100000) OR NEW.amount<>round(NEW.amount,2) THEN
   RAISE EXCEPTION 'Withdrawals must start pending with a valid amount';
  END IF;
  SELECT wallet_balance INTO balance FROM public.profiles WHERE id=NEW.user_id FOR UPDATE;
  IF NOT FOUND OR balance<NEW.amount THEN RAISE EXCEPTION 'Insufficient wallet balance'; END IF;
  UPDATE public.profiles SET wallet_balance=wallet_balance-NEW.amount WHERE id=NEW.user_id;
 ELSE
  IF (NEW.user_id,NEW.amount,NEW.currency,NEW.routing_number,NEW.account_number) IS DISTINCT FROM
     (OLD.user_id,OLD.amount,OLD.currency,OLD.routing_number,OLD.account_number) THEN
   RAISE EXCEPTION 'Withdrawal financial details are immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF OLD.status<>'pending' OR NEW.status NOT IN ('completed','rejected') THEN
    RAISE EXCEPTION 'Withdrawal was already processed';
   END IF;
   IF NEW.status='rejected' THEN
    UPDATE public.profiles SET wallet_balance=wallet_balance+OLD.amount WHERE id=OLD.user_id;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.process_withdrawal_balance() FROM PUBLIC,anon,authenticated;
REVOKE DELETE ON public.withdrawals FROM authenticated,anon;

CREATE OR REPLACE FUNCTION public.redeem_game_coupon(p_coupon_id uuid,p_game_user_id text,p_game_id text,p_wallet_transaction_id text,p_ip_address text,p_device text,p_user_country text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.coupons%ROWTYPE; prior public.coupon_redemptions%ROWTYPE; country text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted game service required'; END IF;
 IF coalesce(length(trim(p_wallet_transaction_id)),0)=0 OR coalesce(length(trim(p_game_id)),0)=0 OR coalesce(length(trim(p_game_user_id)),0)=0 THEN
  RAISE EXCEPTION 'Game transaction identity is required';
 END IF;
 -- Serialize retries across coupons, without imposing a risky unique index on historical rows.
 PERFORM pg_advisory_xact_lock(hashtextextended('game:'||p_wallet_transaction_id,0));
 SELECT * INTO prior FROM public.coupon_redemptions WHERE wallet_transaction_id=p_wallet_transaction_id LIMIT 1;
 IF FOUND THEN
  IF prior.coupon_id=p_coupon_id AND prior.game_user_id=p_game_user_id AND prior.game_id=p_game_id AND prior.status='SUCCESS' THEN RETURN; END IF;
  RAISE EXCEPTION 'Game transaction already belongs to another redemption';
 END IF;
 SELECT * INTO c FROM public.coupons WHERE id=p_coupon_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;
 -- Lock the owner while checking access and currency, including persisted lock changes.
 SELECT p.country_code INTO country FROM public.profiles p WHERE id=c.issued_to FOR SHARE;
 PERFORM public.assert_account_access(c.issued_to);
 IF c.is_used OR lower(c.status) IS DISTINCT FROM 'active' OR (c.expiry_date IS NOT NULL AND c.expiry_date<=now()) THEN RAISE EXCEPTION 'Coupon is not active'; END IF;
 IF c.country_code IS NULL OR public.currency_for_country(c.country_code) IS NULL OR c.country_code IS DISTINCT FROM country
  OR c.country_code IS DISTINCT FROM public.normalize_country_code(p_user_country) THEN RAISE EXCEPTION 'Country mismatch'; END IF;
 IF c.remaining_balance IS NULL OR NOT(c.remaining_balance>0 AND c.remaining_balance<=1000000) THEN RAISE EXCEPTION 'Invalid coupon balance'; END IF;
 UPDATE public.coupons SET remaining_balance=0,is_used=true,status='redeemed',redeemed_at=now() WHERE id=c.id;
 INSERT INTO public.redemptions(coupon_id,amount,remaining_balance_after) VALUES(c.id,c.remaining_balance,0);
 INSERT INTO public.coupon_redemptions(coupon_id,game_user_id,game_id,wallet_transaction_id,ip_address,device,status)
 VALUES(c.id,p_game_user_id,p_game_id,p_wallet_transaction_id,p_ip_address,p_device,'SUCCESS');
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_game_coupon(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_game_coupon(uuid,text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_monthly_settlements(p_year integer,p_month integer,p_company_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE period_start timestamptz; period_end timestamptz; period text; changed integer;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 period_start:=make_date(p_year,p_month,1)::timestamptz;
 period_end:=period_start+interval '1 month'; period:=to_char(period_start,'YYYY-MM');
 -- A stable snapshot while refreshing totals; concurrent redemptions wait for this short transaction.
 LOCK TABLE public.redemptions IN SHARE MODE;
 LOCK TABLE public.settlements IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.settlements s WHERE s.period_month=period AND s.currency IS NULL AND (p_company_id IS NULL OR s.company_id=p_company_id)) THEN RAISE EXCEPTION 'Existing settlements need a verified currency'; END IF;
 IF EXISTS(SELECT 1 FROM public.redemptions r JOIN public.coupons c ON c.id=r.coupon_id WHERE r.created_at>=period_start AND r.created_at<period_end AND (p_company_id IS NULL OR c.company_id=p_company_id) AND public.currency_for_country(c.country_code) IS NULL) THEN RAISE EXCEPTION 'Redemption country is required for settlement'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.settlements s LEFT JOIN (
   SELECT c.company_id,public.currency_for_country(c.country_code) currency,count(*) n,sum(r.amount) amount
   FROM public.redemptions r JOIN public.coupons c ON c.id=r.coupon_id WHERE r.created_at>=period_start AND r.created_at<period_end
   GROUP BY c.company_id,public.currency_for_country(c.country_code)
  ) a ON a.company_id=s.company_id AND a.currency=s.currency
  WHERE s.period_month=period AND (p_company_id IS NULL OR s.company_id=p_company_id) AND s.status<>'pending'
   AND (s.amount_due IS DISTINCT FROM coalesce(a.amount,0) OR s.total_redemptions IS DISTINCT FROM coalesce(a.n,0))
 ) THEN RAISE EXCEPTION 'Paid settlement differs from redemption totals; an explicit accounting adjustment is required'; END IF;
 INSERT INTO public.settlements(company_id,period_month,currency,total_redemptions,amount_due,status)
 SELECT c.company_id,period,public.currency_for_country(c.country_code),count(*)::integer,sum(r.amount),'pending'
 FROM public.redemptions r JOIN public.coupons c ON c.id=r.coupon_id
 WHERE r.created_at>=period_start AND r.created_at<period_end AND (p_company_id IS NULL OR c.company_id=p_company_id)
 GROUP BY c.company_id,public.currency_for_country(c.country_code)
 ON CONFLICT(company_id,period_month,currency) DO UPDATE SET total_redemptions=excluded.total_redemptions,amount_due=excluded.amount_due
 WHERE settlements.status='pending' AND (settlements.total_redemptions,settlements.amount_due) IS DISTINCT FROM (excluded.total_redemptions,excluded.amount_due);
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.generate_monthly_settlements(integer,integer,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_monthly_settlements(integer,integer,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_gift_cards_with_counts()
RETURNS TABLE(id uuid,title text,description text,price numeric,value numeric,company_id uuid,banner_image text,terms text,issue_limit integer,expiry_date timestamptz,created_at timestamptz,company_name text,issued_count bigint,is_active boolean,country_code text,currency text)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT g.id,g.title,g.description,g.price,g.value,g.company_id,g.banner_image,g.terms,g.issue_limit,g.expiry_date,g.created_at,c.name,
 (SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),g.is_active,g.country_code,g.currency
 FROM public.gift_cards g JOIN public.companies c ON c.id=g.company_id
 WHERE public.is_account_active(auth.uid()) AND (public.is_admin() OR c.owner_id=auth.uid()
 OR (c.status='approved' AND g.is_active AND (g.expiry_date IS NULL OR g.expiry_date>now())));
$$;
REVOKE ALL ON FUNCTION public.get_gift_cards_with_counts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated,service_role;

ALTER FUNCTION public.set_profiles_updated_at() SET search_path=public;
ALTER FUNCTION public.block_user_metadata_role_escalation() SET search_path=public;
ALTER FUNCTION public.set_updated_at() SET search_path=public;
REVOKE ALL ON FUNCTION public.block_user_metadata_role_escalation(),public.prevent_user_metadata_role_escalation() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
