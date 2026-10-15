-- Run only in an isolated database after the schema and security migration.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('00000000-0000-0000-0000-000000000001','owner@example.invalid','{"country":"United States","country_code":"US","currency":"USD"}','{}'),
 ('00000000-0000-0000-0000-000000000002','stranger@example.invalid','{"country_code":"US","currency":"USD"}','{}'),
 ('00000000-0000-0000-0000-000000000003','merchant@example.invalid','{"country_code":"US"}','{}'),
 ('00000000-0000-0000-0000-000000000004','admin@example.invalid','{"country_code":"US"}','{"role":"admin"}');
UPDATE public.profiles SET wallet_balance=200 WHERE id='00000000-0000-0000-0000-000000000001';
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id,account_number,pan)
VALUES('10000000-0000-0000-0000-000000000001','Test merchant','TST',100,'approved','00000000-0000-0000-0000-000000000003','private-bank','private-pan');
INSERT INTO public.gift_cards(id,company_id,title,price,value,is_active,country_code)
VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Test card',80,100,true,'US');
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result record; BEGIN
 SELECT * INTO result FROM public.issue_gift_card_coupon('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',0.01);
 IF (SELECT wallet_balance FROM public.profiles WHERE id=auth.uid())<>120 THEN RAISE EXCEPTION 'Purchase debit failed'; END IF;
 IF (SELECT remaining_balance FROM public.coupons WHERE id=result.coupon_id)<>100 THEN RAISE EXCEPTION 'Face value issuance failed'; END IF;
 PERFORM public.redeem_coupon_amount(result.coupon_id,25);
 IF (SELECT remaining_balance FROM public.coupons WHERE id=result.coupon_id)<>75 THEN RAISE EXCEPTION 'Partial redemption failed'; END IF;
 BEGIN
  PERFORM public.add_funds_secure(auth.uid(),1000);
  RAISE EXCEPTION 'Browser credit was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.payment_transactions(user_id,gateway,amount_major,idempotency_key) VALUES(auth.uid(),'stripe',1,'fake');
  RAISE EXCEPTION 'Client transaction insert was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Withdrawal reserves the nominal amount in the account currency.
INSERT INTO public.exchange_rates(base_currency,target_currency,rate,updated_at)
VALUES('USD','INR',80,now()) ON CONFLICT(base_currency,target_currency) DO UPDATE SET rate=80,updated_at=now();
SET LOCAL ROLE authenticated;
DO $$ DECLARE w jsonb; BEGIN
 w:=public.request_withdrawal(10,'USD','routing','account');
 IF (w->>'amount')::numeric<>10 OR (SELECT wallet_balance FROM public.profiles WHERE id=auth.uid())<>110 THEN
  RAISE EXCEPTION 'Withdrawal reservation mismatch'; END IF;
 BEGIN
  PERFORM public.request_withdrawal(1,'XXX','routing','account');
  RAISE EXCEPTION 'Unknown currency accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unknown currency accepted' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.profiles SET is_locked=false WHERE id=auth.uid();
  RAISE EXCEPTION 'Client lock update permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.withdrawals SET status='rejected' WHERE user_id='00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF (SELECT wallet_balance FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000001')<>120 THEN
 RAISE EXCEPTION 'Rejected withdrawal refund failed'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE masked public.companies%ROWTYPE; BEGIN
 IF EXISTS(SELECT 1 FROM public.coupons) THEN RAISE EXCEPTION 'Stranger sees coupons'; END IF;
 SELECT * INTO masked FROM public.get_companies() LIMIT 1;
 IF masked.account_number IS NOT NULL OR masked.pan IS NOT NULL THEN RAISE EXCEPTION 'KYC leaked through RPC'; END IF;
 BEGIN
  PERFORM account_number FROM public.companies;
  RAISE EXCEPTION 'Direct KYC read was allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ DECLARE target uuid; BEGIN
 SELECT id INTO target FROM public.coupons LIMIT 1;
 PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',true);
 BEGIN
  PERFORM public.redeem_coupon_amount(target,10);
  RAISE EXCEPTION 'Stranger redemption was allowed';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='Stranger redemption was allowed' THEN RAISE; END IF;
 END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM id FROM public.coupons; RAISE EXCEPTION 'Anonymous coupon read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  UPDATE public.companies SET status='pending' WHERE owner_id=auth.uid();
  RAISE EXCEPTION 'Owner changed approval';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Owner changed approval' THEN RAISE; END IF; END;
 BEGIN
  UPDATE public.companies SET coupon_limit=999 WHERE owner_id=auth.uid();
  RAISE EXCEPTION 'Owner changed limits';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Owner changed limits' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
INSERT INTO public.payment_transactions(id,user_id,gateway,gateway_order_id,amount_major,currency,idempotency_key,amount_usd,exchange_rate)
VALUES('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','stripe','test-order',10,'USD','test-order',10,1),
('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','stripe','test-order-2',10,'USD','test-order-2',10,1);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT public.settle_verified_payment('30000000-0000-0000-0000-000000000001','test-capture',10,'USD');
SELECT public.settle_verified_payment('30000000-0000-0000-0000-000000000001','test-capture',10,'USD');
DO $$ BEGIN
 IF (SELECT wallet_balance FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000001')<>130 THEN RAISE EXCEPTION 'Payment credited twice'; END IF;
 IF (SELECT count(*) FROM public.payment_credits)<>1 THEN RAISE EXCEPTION 'Credit ledger mismatch'; END IF;
 BEGIN
  PERFORM public.settle_verified_payment('30000000-0000-0000-0000-000000000002','test-capture',10,'USD');
  RAISE EXCEPTION 'Capture reused across orders';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT public.admin_set_account_locked('00000000-0000-0000-0000-000000000001',true);
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF public.is_account_active(auth.uid()) THEN RAISE EXCEPTION 'Account lock not persisted'; END IF;
 IF EXISTS(SELECT 1 FROM public.coupons) THEN RAISE EXCEPTION 'Locked account reads coupons'; END IF;
 BEGIN
  PERFORM public.issue_gift_card_coupon('20000000-0000-0000-0000-000000000001',auth.uid(),80);
  RAISE EXCEPTION 'Locked purchase allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Locked purchase allowed' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Security, payment idempotency, KYC, account-lock and face-value regression tests passed' AS result;
