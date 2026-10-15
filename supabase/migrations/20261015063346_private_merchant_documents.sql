-- Private, immutable KYC uploads. Plain Postgres test fixtures may omit Storage.
BEGIN;
DO $storage_setup$
BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
  -- Legacy KYC is private; the old unowned upload endpoints are no longer client-writable.
  UPDATE storage.buckets SET public=false WHERE id='kyc';
  EXECUTE 'DROP POLICY IF EXISTS "Public Insert kyc" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Public Update kyc" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Public View kyc" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Public Insert uploads" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Public Update uploads" ON storage.objects';
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('merchant-documents','merchant-documents',false,5242880,ARRAY['application/pdf','image/jpeg','image/png'])
  ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
  EXECUTE 'DROP POLICY IF EXISTS merchant_document_insert ON storage.objects';
  EXECUTE $p$CREATE POLICY merchant_document_insert ON storage.objects FOR INSERT TO authenticated
   WITH CHECK(bucket_id='merchant-documents' AND (storage.foldername(name))[1]=auth.uid()::text AND public.is_account_active(auth.uid()))$p$;
  EXECUTE 'DROP POLICY IF EXISTS merchant_document_read ON storage.objects';
  EXECUTE $p$CREATE POLICY merchant_document_read ON storage.objects FOR SELECT TO authenticated
   USING(bucket_id='merchant-documents' AND public.is_account_active(auth.uid()) AND ((storage.foldername(name))[1]=auth.uid()::text OR public.is_admin()))$p$;
 END IF;
END;
$storage_setup$;
CREATE OR REPLACE FUNCTION public.validate_merchant_document()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE present boolean;
BEGIN
 -- Preserve existing records, but never approve a filename placeholder or accept a new fake reference.
 IF NEW.owner_id IS NOT NULL AND (
  (TG_OP='INSERT' AND current_user NOT IN ('postgres','supabase_admin','service_role')) OR
  (TG_OP='UPDATE' AND (NEW.document_url IS DISTINCT FROM OLD.document_url OR (NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved')))
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
REVOKE ALL ON FUNCTION public.validate_merchant_document() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS validate_merchant_document ON public.companies;
CREATE TRIGGER validate_merchant_document BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.validate_merchant_document();
NOTIFY pgrst,'reload schema';
COMMIT;
