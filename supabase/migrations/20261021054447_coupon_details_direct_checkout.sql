-- Backward-compatible: old wallet top-ups keep their existing settlement behavior.
BEGIN;
ALTER TABLE public.payment_transactions
 ADD COLUMN IF NOT EXISTS gift_card_id uuid REFERENCES public.gift_cards(id),
 ADD COLUMN IF NOT EXISTS offer_snapshot jsonb,
 ADD COLUMN IF NOT EXISTS checkout_result jsonb,
 ADD COLUMN IF NOT EXISTS checkout_cancelled boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS payment_transactions_gift_card_idx ON public.payment_transactions(gift_card_id);

-- Public company information is deliberately allowlisted. Banking, tax, owner and KYC data never leave this RPC.
CREATE OR REPLACE FUNCTION public.get_coupon_offer_details(p_gift_card_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 SELECT jsonb_build_object('coupon', to_jsonb(g) || jsonb_build_object(
   'company_name',c.name,'issued_count',(SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),
   'available_count',greatest(0,least(coalesce(g.issue_limit,2147483647)-(SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),
     c.coupon_limit-(SELECT count(*) FROM public.coupons cp WHERE cp.company_id=c.id)))),
   'company',jsonb_build_object('name',c.name,'address',c.address,'joined_at',c.created_at,'status',c.status)) INTO result
 FROM public.gift_cards g JOIN public.companies c ON c.id=g.company_id
 JOIN public.profiles p ON p.id=auth.uid()
 WHERE g.id=p_gift_card_id AND g.is_active AND c.status='approved'
 AND g.country_code=p.country_code AND g.currency=p.currency;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_coupon_offer_details(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_coupon_offer_details(uuid) TO authenticated;

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
 IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
  RAISE EXCEPTION 'Unauthorized';
 END IF;
 PERFORM public.assert_account_access(p_user_id);
 SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found'; END IF;
 SELECT * INTO v_card FROM public.gift_cards WHERE id=p_gift_card_id FOR UPDATE;
 IF NOT FOUND OR NOT v_card.is_active THEN RAISE EXCEPTION 'Gift card not found or inactive'; END IF;
 IF v_card.price IS NULL OR NOT(v_card.price>0 AND v_card.price<=1000000) OR v_card.value IS NULL OR NOT(v_card.value>0 AND v_card.value<=1000000) THEN RAISE EXCEPTION 'Gift card has no valid price'; END IF;
 IF p_amount IS DISTINCT FROM v_card.price THEN RAISE EXCEPTION 'Coupon price changed. Review the current offer before paying'; END IF;
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
 -- The stored price is authoritative; p_amount protects against a changed quote.
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

REVOKE ALL ON FUNCTION public.issue_gift_card_coupon(uuid,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid,uuid,numeric) TO authenticated,service_role;

-- Wallet retries also reuse an order instead of debiting again after a lost response.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS purchase_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS orders_purchase_request_once ON public.orders(user_id,purchase_request_id) WHERE purchase_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.purchase_coupon_once(p_gift_card_id uuid,p_expected_price numeric,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prior public.orders%ROWTYPE; issued record;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'A signed-in purchase request is required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.orders WHERE user_id=auth.uid() AND purchase_request_id=p_request_id;
 IF FOUND THEN
  IF prior.gift_card_id IS DISTINCT FROM p_gift_card_id THEN RAISE EXCEPTION 'Purchase request belongs to another coupon'; END IF;
  RETURN jsonb_build_object('coupon_id',prior.coupon_id,'order_id',prior.id);
 END IF;
 SELECT * INTO issued FROM public.issue_gift_card_coupon(p_gift_card_id,auth.uid(),p_expected_price);
 UPDATE public.orders SET purchase_request_id=p_request_id WHERE id=issued.order_id;
 RETURN jsonb_build_object('coupon_id',issued.coupon_id,'order_id',issued.order_id);
END;
$$;
REVOKE ALL ON FUNCTION public.purchase_coupon_once(uuid,numeric,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.purchase_coupon_once(uuid,numeric,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.credit_verified_wallet_payment(p_transaction_id uuid,p_capture_id text,p_amount numeric,p_currency text)
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
REVOKE ALL ON FUNCTION public.credit_verified_wallet_payment(uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.credit_verified_wallet_payment(uuid,text,numeric,text) TO service_role;

CREATE OR REPLACE FUNCTION public.abandon_coupon_checkout(p_transaction_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.payment_transactions%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted checkout service required'; END IF;
 SELECT * INTO t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
 IF NOT FOUND OR t.user_id IS DISTINCT FROM p_user_id OR t.gift_card_id IS NULL THEN RAISE EXCEPTION 'Checkout not found'; END IF;
 IF t.status='paid' THEN RETURN jsonb_build_object('state','paid') || t.checkout_result; END IF;
 UPDATE public.payment_transactions SET checkout_cancelled=true WHERE id=t.id;
 RETURN jsonb_build_object('state','cancelled');
END;
$$;
REVOKE ALL ON FUNCTION public.abandon_coupon_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_coupon_checkout(uuid,uuid) TO service_role;

-- The payment row lock serializes webhook/client retries. Credit and successful issuance commit together.
-- If inventory/eligibility changes, keep the verified amount in the wallet and persist a terminal result.
CREATE OR REPLACE FUNCTION public.settle_verified_payment(p_transaction_id uuid,p_capture_id text,p_amount numeric,p_currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.payment_transactions%ROWTYPE; result jsonb; issued record; card public.gift_cards%ROWTYPE;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Trusted payment verification required'; END IF;
 SELECT * INTO t FROM public.payment_transactions WHERE id=p_transaction_id FOR UPDATE;
 result:=public.credit_verified_wallet_payment(p_transaction_id,p_capture_id,p_amount,p_currency);
 IF t.gift_card_id IS NULL THEN RETURN result; END IF;
 IF t.checkout_result IS NOT NULL THEN RETURN t.checkout_result || result; END IF;
 -- Never buy from a historical top-up or an incompletely persisted checkout.
 IF t.status='paid' OR t.offer_snapshot IS NULL THEN RAISE EXCEPTION 'Checkout binding is missing'; END IF;
 BEGIN
  IF t.checkout_cancelled THEN RAISE EXCEPTION 'Checkout cancelled'; END IF;
  SELECT * INTO card FROM public.gift_cards WHERE id=t.gift_card_id FOR UPDATE;
  IF NOT FOUND OR (t.offer_snapshot || jsonb_build_object('expiry_date',(t.offer_snapshot->>'expiry_date')::timestamptz)) IS DISTINCT FROM jsonb_build_object('price',card.price,'value',card.value,
    'currency',card.currency,'country_code',card.country_code,'expiry_date',card.expiry_date,'terms',card.terms,
    'title',card.title,'description',card.description,'company_id',card.company_id) THEN
   RAISE EXCEPTION 'Offer changed during payment';
  END IF;
  SELECT * INTO issued FROM public.issue_gift_card_coupon(t.gift_card_id,t.user_id,t.amount_major);
  result:=result || jsonb_build_object('purchaseStatus','issued','couponId',issued.coupon_id,'orderId',issued.order_id);
 EXCEPTION WHEN OTHERS THEN
  -- The failed purchase subtransaction rolls back; the verified credit remains recoverable by the customer.
  result:=result || jsonb_build_object('purchaseStatus','wallet_credited',
   'message','Payment received, but the coupon is no longer available on the same terms. The full payment is in your wallet.');
 END;
 SELECT result || jsonb_build_object('balance',wallet_balance) INTO result FROM public.profiles WHERE id=t.user_id;
 UPDATE public.payment_transactions SET checkout_result=result WHERE id=t.id;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.settle_verified_payment(uuid,text,numeric,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
