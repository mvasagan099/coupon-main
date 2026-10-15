-- Atomic, retry-safe support submissions and guarded settlement completion.
BEGIN;
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_user_request ON public.support_tickets(user_id, request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_support_ticket(p_request_id uuid, p_subject text, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ticket public.support_tickets; first_message text; account_email text;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF auth.uid() IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Authenticated account and request ID required'; END IF;
 IF p_subject IS NULL OR length(btrim(p_subject)) NOT BETWEEN 1 AND 200
 OR p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Subject or message is invalid'; END IF;
 -- Serialize retries for this account and request, including an uncertain network result.
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_request_id::text, 0));
 SELECT * INTO ticket FROM public.support_tickets WHERE user_id=auth.uid() AND request_id=p_request_id;
 IF FOUND THEN
  SELECT message INTO first_message FROM public.support_messages WHERE ticket_id=ticket.id ORDER BY created_at,id LIMIT 1;
  IF ticket.subject IS DISTINCT FROM btrim(p_subject) OR first_message IS DISTINCT FROM btrim(p_message) THEN
   RAISE EXCEPTION 'This request ID was already used for another submission';
  END IF;
  RETURN to_jsonb(ticket);
 END IF;
 SELECT email INTO account_email FROM auth.users WHERE id=auth.uid();
 INSERT INTO public.support_tickets(user_id,user_email,subject,request_id)
 VALUES(auth.uid(),account_email,btrim(p_subject),p_request_id) RETURNING * INTO ticket;
 INSERT INTO public.support_messages(ticket_id,sender_id,message,is_admin)
 VALUES(ticket.id,auth.uid()::text,btrim(p_message),false);
 RETURN to_jsonb(ticket);
END;
$$;
REVOKE ALL ON FUNCTION public.create_support_ticket(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_support_ticket(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_settlement_paid(p_settlement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE settlement public.settlements;
BEGIN
 PERFORM public.assert_account_access(auth.uid());
 IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 UPDATE public.settlements SET status='paid',paid_at=now() WHERE id=p_settlement_id AND status='pending' RETURNING * INTO settlement;
 IF NOT FOUND THEN RAISE EXCEPTION 'Settlement is missing or is no longer pending. Refresh the list.'; END IF;
 RETURN to_jsonb(settlement);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_settlement_paid(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_settlement_paid(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_paid_settlement()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status='paid' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Paid settlements cannot be deleted'; END IF;
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Paid settlements cannot be changed'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_paid_settlement ON public.settlements;
CREATE TRIGGER protect_paid_settlement BEFORE UPDATE OR DELETE ON public.settlements FOR EACH ROW EXECUTE FUNCTION public.protect_paid_settlement();
COMMIT;
