-- PSQL TEST ONLY: run against a disposable database after a fresh install.
-- Creates persistent test fixtures. NEVER run against a real Supabase project.
\set ON_ERROR_STOP on
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('f0000000-0000-0000-0000-000000000001','setup-preserve@example.invalid','{"country_code":"IN"}');
UPDATE public.profiles SET wallet_balance=123.45 WHERE id='f0000000-0000-0000-0000-000000000001';
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id) VALUES
 ('f1000000-0000-0000-0000-000000000001','Setup preservation fixture','PRS',100,'approved','f0000000-0000-0000-0000-000000000001');
INSERT INTO public.gift_cards(id,company_id,title,price,value,is_active,country_code) VALUES
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','Preserved country card',100,100,true,'IN');
INSERT INTO public.coupons(id,company_id,gift_card_id,code,issued_to,amount,remaining_balance,status,country_code) VALUES
 ('f3000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','PRESERVE-COUPON','f0000000-0000-0000-0000-000000000001',100,45,'active','IN');
INSERT INTO public.payment_transactions(user_id,gateway,gateway_order_id,amount_major,currency,idempotency_key,wallet_amount,status) VALUES
 ('f0000000-0000-0000-0000-000000000001','razorpay','preserve-pending-order',80,'INR','preserve-pending-order',80,'pending');
CREATE TEMP TABLE setup_before(table_name text PRIMARY KEY,contents jsonb);
DO $$ DECLARE t text; rows jsonb; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','companies','gift_cards','coupons','orders','redemptions','payment_transactions','payment_credits','withdrawals','deposits','settlements','wallet_transfers','campaigns','support_tickets','support_messages','coupon_redemptions'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r',t) INTO rows;
  INSERT INTO setup_before VALUES(t,rows);
 END LOOP;
END $$;
\ir ../ALL_IN_ONE_NEW_DATABASE.sql
DO $$ DECLARE snapshot record; rows jsonb; BEGIN
 FOR snapshot IN SELECT * FROM setup_before LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb) FROM public.%I r',snapshot.table_name) INTO rows;
  IF rows IS DISTINCT FROM snapshot.contents THEN RAISE EXCEPTION 'Setup rerun changed records in %',snapshot.table_name; END IF;
 END LOOP;
 IF (SELECT wallet_balance FROM public.profiles WHERE id='f0000000-0000-0000-0000-000000000001')<>123.45 THEN RAISE EXCEPTION 'Wallet balance changed'; END IF;
 IF (SELECT remaining_balance FROM public.coupons WHERE code='PRESERVE-COUPON')<>45 THEN RAISE EXCEPTION 'Coupon balance changed'; END IF;
END $$;
SELECT 'All-in-one rerun preserved every row in 16 application tables, including balances and pending payments' AS result;
