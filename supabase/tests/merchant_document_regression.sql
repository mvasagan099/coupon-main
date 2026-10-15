-- Disposable database with local Storage fixture only. All test records roll back.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('d0000000-0000-0000-0000-000000000001','doc-owner@example.invalid','{"country_code":"IN"}','{}'),
 ('d0000000-0000-0000-0000-000000000002','doc-stranger@example.invalid','{"country_code":"IN"}','{}'),
 ('d0000000-0000-0000-0000-000000000003','doc-admin@example.invalid','{"country_code":"IN"}','{"role":"admin"}');
SELECT set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES('merchant-documents','d0000000-0000-0000-0000-000000000001/doc.pdf');
DO $$ BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('merchant-documents','d0000000-0000-0000-0000-000000000002/doc.pdf'); RAISE EXCEPTION 'Foreign folder upload'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.companies(name,prefix,owner_id,document_url) VALUES('Fake document','FAK',auth.uid(),'placeholder.pdf'); RAISE EXCEPTION 'Fake document accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Fake document accepted' THEN RAISE; END IF; END;
END $$;
INSERT INTO public.companies(id,name,prefix,owner_id,document_url) VALUES('d1000000-0000-0000-0000-000000000001','Document merchant','DOC',auth.uid(),'d0000000-0000-0000-0000-000000000001/doc.pdf');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='merchant-documents') THEN RAISE EXCEPTION 'Private document exposed'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"admin"}}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='d0000000-0000-0000-0000-000000000001/doc.pdf') THEN RAISE EXCEPTION 'Admin cannot read KYC'; END IF;
 UPDATE public.companies SET status='approved' WHERE id='d1000000-0000-0000-0000-000000000001';
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Private KYC upload/reference, stranger isolation and admin review checks passed' AS result;
