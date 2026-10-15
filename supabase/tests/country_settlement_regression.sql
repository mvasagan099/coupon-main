-- Isolated database only; all rows roll back.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('e0000000-0000-0000-0000-000000000001','settle-india@example.invalid','{"country_code":"IN"}','{"role":"admin"}'),
 ('e0000000-0000-0000-0000-000000000002','settle-us@example.invalid','{"country_code":"US"}','{}');
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id) VALUES
 ('e1000000-0000-0000-0000-000000000001','Multi country merchant','MLT',100,'approved','e0000000-0000-0000-0000-000000000001');
INSERT INTO public.coupons(id,company_id,code,issued_to,amount,remaining_balance,status,country_code) VALUES
 ('e2000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000001','SETTLE-IN','e0000000-0000-0000-0000-000000000001',100,90,'active','IN'),
 ('e2000000-0000-0000-0000-000000000002','e1000000-0000-0000-0000-000000000001','SETTLE-US','e0000000-0000-0000-0000-000000000002',100,90,'active','US');
INSERT INTO public.redemptions(coupon_id,amount,remaining_balance_after) VALUES
 ('e2000000-0000-0000-0000-000000000001',10,90),('e2000000-0000-0000-0000-000000000002',10,90);
SELECT set_config('request.jwt.claims','{"sub":"e0000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 n:=public.generate_monthly_settlements(extract(year FROM now())::integer,extract(month FROM now())::integer,'e1000000-0000-0000-0000-000000000001');
 IF n<>2 THEN RAISE EXCEPTION 'Currency settlements were combined'; END IF;
 IF (SELECT amount_due FROM public.settlements WHERE company_id='e1000000-0000-0000-0000-000000000001' AND currency='INR')<>10
 OR (SELECT amount_due FROM public.settlements WHERE company_id='e1000000-0000-0000-0000-000000000001' AND currency='USD')<>10 THEN RAISE EXCEPTION 'Nominal settlement amount mismatch'; END IF;
 n:=public.generate_monthly_settlements(extract(year FROM now())::integer,extract(month FROM now())::integer,'e1000000-0000-0000-0000-000000000001');
 IF n<>0 THEN RAISE EXCEPTION 'Settlement duplicated'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Separate INR/USD settlements and repeat-generation tests passed' AS result;
