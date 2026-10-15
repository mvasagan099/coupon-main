-- Isolated PostgreSQL only. All fixtures roll back; never run on production.
BEGIN;
DO $$ BEGIN
 BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('a0000000-0000-0000-0000-000000000099','missing-country@example.invalid','{}');
  RAISE EXCEPTION 'Missing country was accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Missing country was accepted' THEN RAISE; END IF; END;
END $$;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('a0000000-0000-0000-0000-000000000001','india@example.invalid','{"country_code":"IN","currency":"USD"}'),
 ('a0000000-0000-0000-0000-000000000002','usa@example.invalid','{"country_code":"US"}'),
 ('a0000000-0000-0000-0000-000000000003','merchant-country@example.invalid','{"country_code":"IN"}');
UPDATE public.profiles SET wallet_balance=200 WHERE id IN ('a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002');
DO $$ BEGIN
 IF (SELECT currency FROM public.profiles WHERE id='a0000000-0000-0000-0000-000000000001')<>'INR' THEN RAISE EXCEPTION 'Signup currency was not derived from country'; END IF;
END $$;
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id)
 VALUES('b0000000-0000-0000-0000-000000000001','Country merchant','CTY',100,'approved','a0000000-0000-0000-0000-000000000003');
DO $$ BEGIN
 BEGIN
  INSERT INTO public.gift_cards(company_id,title,price,value) VALUES('b0000000-0000-0000-0000-000000000001','Missing country',80,100);
  RAISE EXCEPTION 'Card without country accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Card without country accepted' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.gift_cards(id,company_id,title,price,value,is_active,country_code)
 VALUES('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','India only',80,100,true,'IN');
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.issue_gift_card_coupon('c0000000-0000-0000-0000-000000000001',auth.uid(),80);
  RAISE EXCEPTION 'Foreign-country purchase accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Foreign-country purchase accepted' THEN RAISE; END IF; END;
 IF (SELECT wallet_balance FROM public.profiles WHERE id=auth.uid())<>200 THEN RAISE EXCEPTION 'Failed purchase changed balance'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result record; w jsonb; BEGIN
 SELECT * INTO result FROM public.issue_gift_card_coupon('c0000000-0000-0000-0000-000000000001',auth.uid(),0.01);
 IF (SELECT wallet_balance FROM public.profiles WHERE id=auth.uid())<>120 THEN RAISE EXCEPTION 'Nominal price debit mismatch'; END IF;
 IF (SELECT country_code FROM public.coupons WHERE id=result.coupon_id)<>'IN' THEN RAISE EXCEPTION 'Coupon country not snapshotted'; END IF;
 PERFORM public.redeem_coupon_amount(result.coupon_id,25);
 IF (SELECT remaining_balance FROM public.coupons WHERE id=result.coupon_id)<>75 THEN RAISE EXCEPTION 'Matching-country redemption failed'; END IF;
 BEGIN
  UPDATE public.profiles SET currency='USD' WHERE id=auth.uid();
  RAISE EXCEPTION 'Currency tampering permitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Currency tampering permitted' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.profiles SET country_code='US',currency='USD' WHERE id=auth.uid();
  RAISE EXCEPTION 'Country switching permitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Country switching permitted' THEN RAISE; END IF; END;
 w:=public.request_withdrawal(10,'INR','bank','account');
 IF (w->>'amount')::numeric<>10 OR w->>'currency'<>'INR' OR (SELECT wallet_balance FROM public.profiles WHERE id=auth.uid())<>110 THEN RAISE EXCEPTION 'Withdrawal converted local units'; END IF;
 BEGIN
  PERFORM public.request_withdrawal(10,'USD','bank','account');
  RAISE EXCEPTION 'Foreign-currency withdrawal accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Foreign-currency withdrawal accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
-- Changing a campaign affects future issues, not the country on an issued coupon.
UPDATE public.gift_cards SET country_code='US' WHERE id='c0000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF (SELECT country_code FROM public.coupons WHERE gift_card_id='c0000000-0000-0000-0000-000000000001')<>'IN' THEN RAISE EXCEPTION 'Issued country was mutated'; END IF;
END $$;
-- Simulate an inconsistent old coupon; even its owner cannot redeem it across countries.
UPDATE public.coupons SET country_code='US' WHERE issued_to='a0000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ DECLARE target uuid; BEGIN
 SELECT id INTO target FROM public.coupons WHERE issued_to=auth.uid();
 BEGIN
  PERFORM public.redeem_coupon_amount(target,1);
  RAISE EXCEPTION 'Mismatched-country redemption accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Mismatched-country redemption accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
INSERT INTO public.payment_transactions(id,user_id,gateway,gateway_order_id,amount_major,currency,idempotency_key,amount_usd,exchange_rate)
 VALUES('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','razorpay','country-local-order',80,'INR','country-local-order',1,0.0125),
 ('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','stripe','country-foreign-order',80,'USD','country-foreign-order',80,1);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT public.settle_verified_payment('d0000000-0000-0000-0000-000000000001','country-capture',80,'INR');
SELECT public.settle_verified_payment('d0000000-0000-0000-0000-000000000001','country-capture',80,'INR');
DO $$ BEGIN
 IF (SELECT wallet_balance FROM public.profiles WHERE id='a0000000-0000-0000-0000-000000000001')<>190 THEN RAISE EXCEPTION 'Payment converted or duplicated'; END IF;
 IF (SELECT wallet_amount FROM public.payment_credits WHERE capture_id='country-capture')<>80 OR (SELECT amount_usd FROM public.payment_credits WHERE capture_id='country-capture') IS NOT NULL THEN RAISE EXCEPTION 'Local amount was mislabeled as USD'; END IF;
 IF (SELECT currency FROM public.payment_credits WHERE capture_id='country-capture')<>'INR' THEN RAISE EXCEPTION 'Credit currency missing'; END IF;
 BEGIN
  PERFORM public.settle_verified_payment('d0000000-0000-0000-0000-000000000002','wrong-currency',80,'USD');
  RAISE EXCEPTION 'Foreign-currency payment accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Foreign-currency payment accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Country signup, purchase, redemption, currency locks, nominal withdrawal and idempotent local payment tests passed' AS result;
