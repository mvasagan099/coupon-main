-- Local disposable database only. All test records and test triggers roll back.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('a1000000-0000-0000-0000-000000000001','support-user@example.invalid','{"country_code":"IN"}','{}'),
 ('a1000000-0000-0000-0000-000000000002','support-admin@example.invalid','{"country_code":"IN"}','{"role":"admin"}');
INSERT INTO public.companies(id,name,prefix,coupon_limit,status,owner_id) VALUES
 ('a2000000-0000-0000-0000-000000000001','Workflow merchant','WFR',100,'approved','a1000000-0000-0000-0000-000000000001');
INSERT INTO public.settlements(id,company_id,period_month,currency,total_redemptions,amount_due,status) VALUES
 ('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','2026-10','INR',1,10,'pending');
CREATE FUNCTION public.test_fail_support_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.message='simulate-message-failure' THEN RAISE EXCEPTION 'Simulated message write failure'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER test_fail_support_message BEFORE INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.test_fail_support_message();
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE first_ticket jsonb; retry_ticket jsonb; BEGIN
 first_ticket:=public.create_support_ticket('a4000000-0000-0000-0000-000000000001','Help','First message');
 retry_ticket:=public.create_support_ticket('a4000000-0000-0000-0000-000000000001','Help','First message');
 IF first_ticket->>'id' IS DISTINCT FROM retry_ticket->>'id' THEN RAISE EXCEPTION 'Retry created a duplicate'; END IF;
 IF first_ticket->>'user_email'<>'support-user@example.invalid' THEN RAISE EXCEPTION 'Email not derived from authenticated account'; END IF;
 IF (SELECT count(*) FROM public.support_messages WHERE ticket_id=(first_ticket->>'id')::uuid)<>1 THEN RAISE EXCEPTION 'Retry duplicated message'; END IF;
 BEGIN
  PERFORM public.create_support_ticket('a4000000-0000-0000-0000-000000000001','Changed','First message'); RAISE EXCEPTION 'Changed replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Changed replay accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.create_support_ticket('a4000000-0000-0000-0000-000000000002','Will fail','simulate-message-failure'); RAISE EXCEPTION 'Message failure ignored';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Message failure ignored' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.support_tickets WHERE request_id='a4000000-0000-0000-0000-000000000002') THEN RAISE EXCEPTION 'Orphan ticket persisted'; END IF;
 BEGIN
  PERFORM public.admin_mark_settlement_paid('a3000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Customer paid settlement';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Customer paid settlement' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
UPDATE public.profiles SET is_locked=true WHERE id='a1000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.create_support_ticket('a4000000-0000-0000-0000-000000000003','Locked','No access'); RAISE EXCEPTION 'Locked customer submitted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Locked customer submitted' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE paid jsonb; BEGIN
 paid:=public.admin_mark_settlement_paid('a3000000-0000-0000-0000-000000000001');
 IF paid->>'status'<>'paid' OR paid->>'paid_at' IS NULL THEN RAISE EXCEPTION 'Settlement not completed'; END IF;
 BEGIN PERFORM public.admin_mark_settlement_paid('a3000000-0000-0000-0000-000000000001'); RAISE EXCEPTION 'Repeated paid action accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Repeated paid action accepted' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_mark_settlement_paid('a3000000-0000-0000-0000-000000000099'); RAISE EXCEPTION 'Missing settlement accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Missing settlement accepted' THEN RAISE; END IF; END;
 BEGIN UPDATE public.settlements SET status='pending' WHERE id='a3000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Paid settlement reopened';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Paid settlement reopened' THEN RAISE; END IF; END;
 BEGIN UPDATE public.settlements SET amount_due=999 WHERE id='a3000000-0000-0000-0000-000000000001'; RAISE EXCEPTION 'Paid amount changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Paid amount changed' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Support and settlement regression passed' AS result;
