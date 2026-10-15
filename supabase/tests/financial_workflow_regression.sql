-- Disposable database only; fixtures roll back.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('91000000-0000-0000-0000-000000000001','audit-customer@example.invalid','{"country_code":"IN"}','{}'),
 ('91000000-0000-0000-0000-000000000002','audit-merchant@example.invalid','{"country_code":"IN"}','{}'),
 ('91000000-0000-0000-0000-000000000003','audit-admin@example.invalid','{"country_code":"IN"}','{"role":"admin"}');
UPDATE public.profiles SET wallet_balance=200 WHERE id='91000000-0000-0000-0000-000000000001';
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id) VALUES
 ('92000000-0000-0000-0000-000000000001','Audit merchant','AUD',100,'approved','91000000-0000-0000-0000-000000000002');
INSERT INTO public.coupons(id,company_id,code,issued_to,amount,remaining_balance,status,country_code,expiry_date) VALUES
 ('93000000-0000-0000-0000-000000000001','92000000-0000-0000-0000-000000000001','AUD-PARTIAL','91000000-0000-0000-0000-000000000001',100,75,'active','IN',now()+interval '1 year'),
 ('93000000-0000-0000-0000-000000000002','92000000-0000-0000-0000-000000000001','AUD-EXPIRED','91000000-0000-0000-0000-000000000001',100,100,'active','IN',now()-interval '1 day'),
 ('93000000-0000-0000-0000-000000000003','92000000-0000-0000-0000-000000000001','AUD-LATER','91000000-0000-0000-0000-000000000001',100,100,'active','IN',now()+interval '1 year');
UPDATE public.profiles SET is_locked=true WHERE id='91000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000001','game-user','game','tx-locked','ip','device','IN'); RAISE EXCEPTION 'Locked owner accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Locked owner accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.profiles SET is_locked=false WHERE id='91000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000002','game-user','game','tx-expired','ip','device','IN'); RAISE EXCEPTION 'Expired coupon accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Expired coupon accepted' THEN RAISE; END IF; END;
 BEGIN PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000001','game-user','game','tx-country','ip','device','US'); RAISE EXCEPTION 'Wrong country accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Wrong country accepted' THEN RAISE; END IF; END;
 PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000001','game-user','game','tx-success','ip','device','IN');
 PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000001','game-user','game','tx-success','ip','device','IN');
 BEGIN PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000003','game-user','game','tx-success','ip','device','IN'); RAISE EXCEPTION 'Transaction replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Transaction replay accepted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT(SELECT is_used AND remaining_balance=0 FROM public.coupons WHERE id='93000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Game coupon balance inconsistent'; END IF;
 IF (SELECT sum(amount) FROM public.redemptions WHERE coupon_id='93000000-0000-0000-0000-000000000001')<>75 OR (SELECT count(*) FROM public.coupon_redemptions WHERE wallet_transaction_id='tx-success')<>1 THEN RAISE EXCEPTION 'Game ledger or retry incorrect'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
SELECT public.request_withdrawal(10,'INR','bank','account');
RESET ROLE;
UPDATE public.withdrawals SET status='rejected' WHERE user_id='91000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 BEGIN UPDATE public.withdrawals SET status='completed' WHERE user_id='91000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Refunded withdrawal completed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Refunded withdrawal completed' THEN RAISE; END IF; END;
 BEGIN UPDATE public.withdrawals SET amount=999 WHERE user_id='91000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Withdrawal amount changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Withdrawal amount changed' THEN RAISE; END IF; END;
 IF (SELECT wallet_balance FROM public.profiles WHERE id='91000000-0000-0000-0000-000000000001')<>200 THEN RAISE EXCEPTION 'Withdrawal refund incorrect'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
SELECT public.generate_monthly_settlements(extract(year FROM now())::integer,extract(month FROM now())::integer,'92000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO public.redemptions(coupon_id,amount,remaining_balance_after) VALUES('93000000-0000-0000-0000-000000000003',5,95);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 n:=public.generate_monthly_settlements(extract(year FROM now())::integer,extract(month FROM now())::integer,'92000000-0000-0000-0000-000000000001');
 IF n<>1 OR (SELECT amount_due FROM public.settlements WHERE company_id='92000000-0000-0000-0000-000000000001')<>80 THEN RAISE EXCEPTION 'Later redemption omitted'; END IF;
END $$;
RESET ROLE;
UPDATE public.settlements SET status='paid' WHERE company_id='92000000-0000-0000-0000-000000000001';
INSERT INTO public.redemptions(coupon_id,amount,remaining_balance_after) VALUES('93000000-0000-0000-0000-000000000003',5,90);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.generate_monthly_settlements(extract(year FROM now())::integer,extract(month FROM now())::integer,'92000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Paid settlement silently omitted change';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Paid settlement silently omitted change' THEN RAISE; END IF; END;
 IF (SELECT amount_due FROM public.settlements WHERE company_id='92000000-0000-0000-0000-000000000001')<>80 THEN RAISE EXCEPTION 'Paid history changed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.redeem_game_coupon('93000000-0000-0000-0000-000000000001','u','g','t','i','d','IN'); RAISE EXCEPTION 'Anonymous game redemption'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Game expiry/lock/accounting/retries, terminal withdrawals and refreshed settlements passed' AS result;
