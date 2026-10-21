-- ============================================================
-- Coupon Destination Restrictions
-- Adds `redemption_destination` to companies, gift_cards, coupons.
-- Only admins can assign a company's destination.
-- Destination is inherited down: company -> gift_card -> coupon (immutable after issuance).
-- Unclassified coupons (destination IS NULL) are BLOCKED everywhere.
-- ============================================================
BEGIN;

-- 1. Add destination column to companies (admin-controlled, nullable = unclassified)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS redemption_destination TEXT
  CHECK (redemption_destination IN ('gaming','lottery','couponvault'));

-- 2. Add destination column to gift_cards (inherited from company at creation, immutable after)
ALTER TABLE public.gift_cards
  ADD COLUMN IF NOT EXISTS redemption_destination TEXT
  CHECK (redemption_destination IN ('gaming','lottery','couponvault'));

-- 3. Add destination column to coupons (stamped at issuance from gift_card, permanently immutable)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS redemption_destination TEXT
  CHECK (redemption_destination IN ('gaming','lottery','couponvault'));

-- 4. Make coupons.redemption_destination immutable once set
CREATE OR REPLACE FUNCTION public.prevent_coupon_destination_change()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  -- Once a non-null destination is written, it can never be changed.
  IF OLD.redemption_destination IS NOT NULL AND NEW.redemption_destination IS DISTINCT FROM OLD.redemption_destination THEN
    RAISE EXCEPTION 'Coupon redemption destination is immutable after issuance';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_coupon_destination_change ON public.coupons;
CREATE TRIGGER prevent_coupon_destination_change
  BEFORE UPDATE ON public.coupons
  FOR EACH ROW EXECUTE FUNCTION public.prevent_coupon_destination_change();

-- 5. Admin RPC: assign redemption destination to a company
--    Does NOT retroactively update already-issued coupons.
--    Does NOT update existing gift_cards (only new ones created after this).
CREATE OR REPLACE FUNCTION public.admin_set_company_destination(
  p_company_id uuid,
  p_destination text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE co public.companies%ROWTYPE;
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized: admin role required'; END IF;
  IF p_destination IS NOT NULL AND p_destination NOT IN ('gaming','lottery','couponvault') THEN
    RAISE EXCEPTION 'Invalid destination. Must be: gaming, lottery, or couponvault';
  END IF;
  UPDATE public.companies
    SET redemption_destination = p_destination
    WHERE id = p_company_id
    RETURNING * INTO co;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
  RETURN to_jsonb(co);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_company_destination(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_company_destination(uuid,text) TO authenticated;

-- 6. Update issue_gift_card_coupon to stamp destination from gift_card onto coupon.
--    gift_card.redemption_destination is set at gift_card creation from company.
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
  -- Stamp the destination from the gift_card at issuance time (immutable after).
  INSERT INTO public.coupons(company_id,code,issued_to,gift_card_id,amount,remaining_balance,expiry_date,status,is_used,country_code,redemption_destination)
  VALUES(v_company.id,v_code,p_user_id,v_card.id,v_card.value,v_card.value,
    COALESCE(v_card.expiry_date,now()+interval '1 year'),'active',false,v_card.country_code,
    v_card.redemption_destination)  -- ← inherit from gift_card at moment of issuance
  RETURNING id INTO v_coupon;
  INSERT INTO public.orders(user_id,company_id,coupon_id,gift_card_id,status,amount)
  VALUES(p_user_id,v_company.id,v_coupon,v_card.id,'paid',v_card.price) RETURNING id INTO v_order;
  RETURN QUERY SELECT v_code,v_order,v_coupon;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_gift_card_coupon(uuid,uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.issue_gift_card_coupon(uuid,uuid,numeric) TO authenticated,service_role;

-- 7. Core redemption RPC for external applications (gaming + lottery).
--    p_calling_app is supplied ONLY by the trusted server; never from the browser.
--    This replaces redeem_game_coupon but old one is preserved for backward compat.
CREATE OR REPLACE FUNCTION public.redeem_application_coupon(
  p_coupon_id              uuid,
  p_calling_app            text,   -- 'gaming' or 'lottery' — set by server from verified API key
  p_app_user_id            text,
  p_app_transaction_id     text,
  p_ip_address             text    DEFAULT '0.0.0.0',
  p_device                 text    DEFAULT 'unknown',
  p_user_country           text    DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c public.coupons%ROWTYPE;
  prior public.coupon_redemptions%ROWTYPE;
  owner_country text;
BEGIN
  -- Only the trusted server (service_role) may call this RPC.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Trusted application service required';
  END IF;

  -- Validate calling_app is a recognized external destination.
  IF p_calling_app NOT IN ('gaming','lottery') THEN
    RAISE EXCEPTION 'Invalid calling application: %', p_calling_app;
  END IF;

  -- Validate required identity fields.
  IF coalesce(length(trim(p_app_transaction_id)),0)=0 OR
     coalesce(length(trim(p_app_user_id)),0)=0 THEN
    RAISE EXCEPTION 'Application transaction identity is required';
  END IF;

  -- Serialize concurrent retries on the same transaction ID.
  PERFORM pg_advisory_xact_lock(hashtextextended('app:'||p_calling_app||':'||p_app_transaction_id, 0));

  -- Idempotency: if the same transaction ID was already processed successfully, return silently.
  SELECT * INTO prior FROM public.coupon_redemptions
    WHERE wallet_transaction_id = p_app_transaction_id LIMIT 1;
  IF FOUND THEN
    IF prior.coupon_id = p_coupon_id AND prior.game_user_id = p_app_user_id AND prior.status = 'SUCCESS' THEN
      RETURN; -- Idempotent success
    END IF;
    RAISE EXCEPTION 'Transaction ID already belongs to another redemption';
  END IF;

  -- Lock coupon row for the transaction.
  SELECT * INTO c FROM public.coupons WHERE id=p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;

  -- 1. Destination restriction: unclassified coupons are blocked everywhere.
  IF c.redemption_destination IS NULL THEN
    RAISE EXCEPTION 'Coupon has no redemption destination assigned. Contact support.';
  END IF;

  -- 2. Destination must match calling application exactly.
  IF c.redemption_destination IS DISTINCT FROM p_calling_app THEN
    RAISE EXCEPTION 'Coupon destination mismatch: this coupon is for ''%'' and cannot be redeemed by ''%''',
      c.redemption_destination, p_calling_app;
  END IF;

  -- 3. Owner account must be active.
  SELECT p.country_code INTO owner_country FROM public.profiles p WHERE id=c.issued_to FOR SHARE;
  PERFORM public.assert_account_access(c.issued_to);

  -- 4. Coupon must be active and unexpired.
  IF c.is_used OR lower(c.status) IS DISTINCT FROM 'active' OR
     (c.expiry_date IS NOT NULL AND c.expiry_date <= now()) THEN
    RAISE EXCEPTION 'Coupon is not active';
  END IF;

  -- 5. Country must match coupon, owner profile, and calling user.
  IF c.country_code IS NULL OR public.currency_for_country(c.country_code) IS NULL OR
     c.country_code IS DISTINCT FROM owner_country OR
     c.country_code IS DISTINCT FROM public.normalize_country_code(p_user_country) THEN
    RAISE EXCEPTION 'Country mismatch';
  END IF;

  -- 6. Balance must be valid.
  IF c.remaining_balance IS NULL OR NOT(c.remaining_balance>0 AND c.remaining_balance<=1000000) THEN
    RAISE EXCEPTION 'Invalid coupon balance';
  END IF;

  -- 7. Execute redemption atomically.
  UPDATE public.coupons SET remaining_balance=0, is_used=true, status='redeemed', redeemed_at=now()
    WHERE id=c.id;
  INSERT INTO public.redemptions(coupon_id, amount, remaining_balance_after)
    VALUES(c.id, c.remaining_balance, 0);
  -- Reuse coupon_redemptions table; game_id stores the calling app for audit.
  INSERT INTO public.coupon_redemptions(coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status)
    VALUES(c.id, p_app_user_id, p_calling_app, p_app_transaction_id, p_ip_address, p_device, 'SUCCESS');
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_application_coupon(uuid,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_application_coupon(uuid,text,text,text,text,text,text) TO service_role;

-- 8. CouponVault-specific redemption RPC (for ScanPage / merchant flow).
--    Called with an authenticated user JWT (not service_role).
--    p_request_id provides idempotency for network retries.
CREATE OR REPLACE FUNCTION public.redeem_coupon_cv(
  p_coupon_id  uuid,
  p_request_id uuid    -- client-generated UUID for idempotency
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  c     public.coupons%ROWTYPE;
  prior public.redemptions%ROWTYPE;
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  IF auth.uid() IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated account and request ID required';
  END IF;

  -- Serialize concurrent retries.
  PERFORM pg_advisory_xact_lock(hashtextextended('cv:'||p_request_id::text, 0));

  -- Idempotency: if this request_id was already processed return the prior result.
  -- We use a comment field on redemptions to store cv request_ids (no schema change needed).
  -- Actually use coupon_redemptions with game_id='couponvault' and wallet_transaction_id=request_id.
  IF EXISTS (
    SELECT 1 FROM public.coupon_redemptions
    WHERE wallet_transaction_id = p_request_id::text AND coupon_id = p_coupon_id AND status='SUCCESS'
  ) THEN
    SELECT remaining_balance INTO c.remaining_balance FROM public.coupons WHERE id=p_coupon_id;
    RETURN jsonb_build_object('idempotent', true, 'remaining_balance', 0);
  END IF;

  -- Lock coupon.
  SELECT * INTO c FROM public.coupons WHERE id=p_coupon_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Coupon not found'; END IF;

  -- 1. Coupon must be owned by the authenticated user.
  IF c.issued_to IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'This coupon does not belong to your account';
  END IF;

  -- 2. Destination restriction: unclassified coupons are blocked.
  IF c.redemption_destination IS NULL THEN
    RAISE EXCEPTION 'Coupon has no redemption destination assigned. Contact support.';
  END IF;

  -- 3. Must be a CouponVault destination coupon.
  IF c.redemption_destination IS DISTINCT FROM 'couponvault' THEN
    RAISE EXCEPTION 'Coupon destination mismatch: this coupon is for ''%'' and cannot be redeemed here',
      c.redemption_destination;
  END IF;

  -- 4. Coupon must be active and unexpired.
  IF c.is_used OR lower(c.status) IS DISTINCT FROM 'active' OR
     (c.expiry_date IS NOT NULL AND c.expiry_date <= now()) THEN
    RAISE EXCEPTION 'Coupon is not active';
  END IF;

  -- 5. Balance must be valid.
  IF c.remaining_balance IS NULL OR NOT(c.remaining_balance>0 AND c.remaining_balance<=1000000) THEN
    RAISE EXCEPTION 'Invalid coupon balance';
  END IF;

  -- 6. Execute redemption atomically.
  UPDATE public.coupons SET remaining_balance=0, is_used=true, status='redeemed', redeemed_at=now()
    WHERE id=c.id;
  INSERT INTO public.redemptions(coupon_id, amount, remaining_balance_after)
    VALUES(c.id, c.remaining_balance, 0);
  -- Record in coupon_redemptions for audit trail; game_id='couponvault'.
  INSERT INTO public.coupon_redemptions(coupon_id, game_user_id, game_id, wallet_transaction_id, ip_address, device, status)
    VALUES(c.id, auth.uid()::text, 'couponvault', p_request_id::text, '0.0.0.0', 'web', 'SUCCESS');

  RETURN jsonb_build_object('idempotent', false, 'remaining_balance', 0, 'redeemed_amount', c.remaining_balance);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_coupon_cv(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.redeem_coupon_cv(uuid,uuid) TO authenticated;

-- 9. Update validate_coupon_by_id and validate_coupon to also return redemption_destination.
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
  country_code      TEXT,
  redemption_destination TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    co.name::text,
    c.code::text,
    c.is_used,
    c.created_at,
    c.remaining_balance,
    c.expiry_date,
    c.status,
    c.country_code::text,
    c.redemption_destination
  FROM public.coupons c
  JOIN public.companies co ON co.id = c.company_id
  WHERE c.id = p_coupon_id;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_coupon_by_id(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon_by_id(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.validate_coupon(p_code text)
RETURNS TABLE (
  coupon_id         UUID,
  company_name      TEXT,
  coupon_code       TEXT,
  is_used           BOOLEAN,
  issued_at         TIMESTAMPTZ,
  remaining_balance NUMERIC,
  expiry_date       TIMESTAMPTZ,
  status            TEXT,
  country_code      TEXT,
  redemption_destination TEXT
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    co.name::text,
    c.code::text,
    c.is_used,
    c.created_at,
    c.remaining_balance,
    c.expiry_date,
    c.status,
    c.country_code::text,
    c.redemption_destination
  FROM public.coupons c
  JOIN public.companies co ON co.id = c.company_id
  WHERE upper(trim(c.code)) = upper(trim(p_code));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid coupon code';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_coupon(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.validate_coupon(text) TO authenticated,service_role;

-- 9b. Update get_gift_cards_with_counts to return redemption_destination
CREATE OR REPLACE FUNCTION public.get_gift_cards_with_counts()
 RETURNS TABLE(
   id uuid,
   title text,
   description text,
   price numeric,
   value numeric,
   company_id uuid,
   banner_image text,
   terms text,
   issue_limit integer,
   expiry_date timestamp with time zone,
   created_at timestamp with time zone,
   company_name text,
   issued_count bigint,
   is_active boolean,
   country_code text,
   currency text,
   redemption_destination text
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT 
   g.id,
   g.title,
   g.description,
   g.price,
   g.value,
   g.company_id,
   g.banner_image,
   g.terms,
   g.issue_limit,
   g.expiry_date,
   g.created_at,
   c.name,
   (SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),
   g.is_active,
   g.country_code,
   g.currency,
   COALESCE(g.redemption_destination, c.redemption_destination)
 FROM public.gift_cards g 
 JOIN public.companies c ON c.id=g.company_id
 WHERE public.is_account_active(auth.uid()) AND (public.is_admin() OR c.owner_id=auth.uid()
 OR (c.status='approved' AND g.is_active AND (g.expiry_date IS NULL OR g.expiry_date>now())));
$function$;
REVOKE ALL ON FUNCTION public.get_gift_cards_with_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gift_cards_with_counts() TO authenticated;

-- 10. get_coupon_offer_details now exposes destination so marketplace can show badges.
CREATE OR REPLACE FUNCTION public.get_coupon_offer_details(p_gift_card_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  SELECT jsonb_build_object('coupon', to_jsonb(g) || jsonb_build_object(
    'company_name',c.name,
    'issued_count',(SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),
    'available_count',greatest(0,least(coalesce(g.issue_limit,2147483647)-(SELECT count(*) FROM public.coupons cp WHERE cp.gift_card_id=g.id),
      c.coupon_limit-(SELECT count(*) FROM public.coupons cp WHERE cp.company_id=c.id))),
    'redemption_destination', g.redemption_destination),
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

-- 11. Admin function to get companies with their destination (for admin dashboard).
CREATE OR REPLACE FUNCTION public.admin_get_company_destinations()
RETURNS TABLE (
  id                    uuid,
  name                  text,
  prefix                text,
  status                text,
  redemption_destination text,
  issued_count          bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
    SELECT c.id, c.name, c.prefix, c.status, c.redemption_destination,
           (SELECT count(*) FROM public.coupons cp WHERE cp.company_id=c.id)::bigint
    FROM public.companies c
    ORDER BY c.name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_company_destinations() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_company_destinations() TO authenticated;

-- 12. Admin RPC to suspend a company
CREATE OR REPLACE FUNCTION public.admin_suspend_company(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE co public.companies%ROWTYPE;
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized: admin role required'; END IF;
  UPDATE public.companies
    SET status = 'suspended'
    WHERE id = p_company_id
    RETURNING * INTO co;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
  RETURN to_jsonb(co);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_suspend_company(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_suspend_company(uuid) TO authenticated;

-- 13. Admin RPC to unsuspend a company
CREATE OR REPLACE FUNCTION public.admin_unsuspend_company(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE co public.companies%ROWTYPE;
BEGIN
  PERFORM public.assert_account_access(auth.uid());
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Unauthorized: admin role required'; END IF;
  UPDATE public.companies
    SET status = 'approved'
    WHERE id = p_company_id
    RETURNING * INTO co;
  IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
  RETURN to_jsonb(co);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_unsuspend_company(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unsuspend_company(uuid) TO authenticated;

-- 14. Update validate_merchant_document to allow admins and unsuspending
CREATE OR REPLACE FUNCTION public.validate_merchant_document()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE present boolean;
BEGIN
 -- Administrators un-suspending or updating companies are not blocked
 IF current_user IN ('postgres','supabase_admin','service_role') OR public.is_admin() THEN
   RETURN NEW;
 END IF;
 -- Preserve existing records, but never approve a filename placeholder or accept a new fake reference.
 IF NEW.owner_id IS NOT NULL AND (
  (TG_OP='INSERT' AND current_user NOT IN ('postgres','supabase_admin','service_role')) OR
  (TG_OP='UPDATE' AND (NEW.document_url IS DISTINCT FROM OLD.document_url OR (NEW.status='approved' AND OLD.status NOT IN ('approved', 'suspended'))))
 ) THEN
  IF NEW.document_url IS NULL OR split_part(NEW.document_url,'/',1) IS DISTINCT FROM NEW.owner_id::text OR to_regclass('storage.objects') IS NULL THEN
   RAISE EXCEPTION 'A private uploaded KYC document is required';
  END IF;
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id=$1 AND name=$2)' INTO present USING 'merchant-documents',NEW.document_url;
  IF NOT present THEN RAISE EXCEPTION 'Uploaded KYC document was not found or is inaccessible'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
