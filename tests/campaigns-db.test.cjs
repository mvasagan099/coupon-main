const {PGlite}=require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.admin',true),'false')='true' $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,country_code text,is_locked boolean DEFAULT false);
CREATE TABLE public.companies(id uuid PRIMARY KEY);
INSERT INTO public.profiles VALUES('00000000-0000-0000-0000-000000000001','IN',false);
GRANT USAGE ON SCHEMA auth TO authenticated; GRANT SELECT ON public.profiles TO authenticated;
CREATE FUNCTION public.is_account_active(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=$1 AND NOT p.is_locked) $$;`);
const sql=fs.readFileSync('supabase/migrations/20261017084634_admin_brand_campaigns.sql','utf8');await db.exec(sql);
async function role(name,admin=false){await db.exec(`RESET ROLE; SELECT set_config('test.uid','00000000-0000-0000-0000-000000000001',false); SELECT set_config('test.admin','${admin}',false); SET ROLE ${name};`);}
async function count(n){assert.equal((await db.query('SELECT count(*)::int AS n FROM public.brand_campaigns')).rows[0].n,n);}
async function denied(query){await assert.rejects(db.exec(query),e=>e.code==='42501');}
await role('anon');await denied('SELECT * FROM public.brand_campaigns');
await role('authenticated');await count(15);assert.equal((await db.query("UPDATE public.brand_campaigns SET name='tampered' WHERE slug='amazon' RETURNING id")).rows.length,0);
await denied("INSERT INTO public.brand_campaigns(slug,name,category,color,logo_path) VALUES('fake','Fake','Fake','#123456','/brands/amazon.svg')");await denied("DELETE FROM public.brand_campaigns");
await role('authenticated',true);await count(15);const old=(await db.query("SELECT updated_at FROM public.brand_campaigns WHERE slug='amazon'")).rows[0].updated_at;
await db.exec("UPDATE public.brand_campaigns SET is_published=false,name='Admin edited Amazon' WHERE slug='amazon'; UPDATE public.brand_campaigns SET country_code='US' WHERE slug='flipkart';");
assert.notEqual((await db.query("SELECT updated_at FROM public.brand_campaigns WHERE slug='amazon'")).rows[0].updated_at,old);
await role('authenticated');await count(13);
await db.exec('RESET ROLE');await db.exec(sql);assert.equal((await db.query("SELECT name FROM public.brand_campaigns WHERE slug='amazon'")).rows[0].name,'Admin edited Amazon');
await db.exec("UPDATE public.profiles SET is_locked=true");await role('authenticated',true);await count(0);await denied("INSERT INTO public.brand_campaigns(slug,name,category,color,logo_path) VALUES('fake','Fake','Fake','#123456','/brands/amazon.svg')");
await db.close();console.log('PASS: 15 seeds, idempotency, anon denied, customer read-only, admin edits, country visibility, account lock and updated timestamps');})().catch(e=>{console.error(e);process.exit(1)});
