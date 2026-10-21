const {test,before,after,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const db=new PGlite();
const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',company='00000000-0000-0000-0000-000000000003',card='00000000-0000-0000-0000-000000000004';
const migration=fs.readFileSync('supabase/migrations/20261021054447_coupon_details_direct_checkout.sql','utf8');
const scalar=async sql=>(await db.query(sql)).rows[0];
const role=async(name,uid='')=>db.exec(`RESET ROLE; SELECT set_config('test.uid','${uid}',false),set_config('test.role','${name}',false); SET ROLE ${name};`);
before(async()=>{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE SCHEMA extensions;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('test.role',true)$$;
 CREATE FUNCTION extensions.gen_random_bytes(integer) RETURNS bytea LANGUAGE sql VOLATILE AS $$SELECT decode(replace(gen_random_uuid()::text,'-',''),'hex')$$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,wallet_balance numeric,country_code text,currency text,country text,is_locked boolean DEFAULT false);
 CREATE TABLE companies(id uuid PRIMARY KEY,name text,prefix text,status text,coupon_limit integer,address text,created_at timestamptz DEFAULT now(),account_number text,pan text,document_url text,owner_id uuid);
 CREATE TABLE gift_cards(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid REFERENCES companies(id),title text,description text,price numeric,value numeric,country_code text,currency text,expiry_date timestamptz,terms text,issue_limit integer,is_active boolean,banner_image text,created_at timestamptz DEFAULT now());
 CREATE TABLE coupons(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,code text UNIQUE,issued_to uuid,gift_card_id uuid,amount numeric,remaining_balance numeric,expiry_date timestamptz,status text,is_used boolean,country_code text);
 CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,coupon_id uuid,gift_card_id uuid,status text,amount numeric);
 CREATE TABLE payment_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,gateway text,gateway_order_id text,gateway_payment_id text,amount_major numeric,currency text,status text,updated_at timestamptz DEFAULT now());
 CREATE TABLE payment_credits(transaction_id uuid PRIMARY KEY,gateway text,capture_id text,amount_usd numeric,currency text,wallet_amount numeric,UNIQUE(gateway,capture_id));
 CREATE TABLE deposits(id uuid DEFAULT gen_random_uuid(),user_id uuid,amount numeric,payment_method text,reference_id text,status text,currency text);
 CREATE FUNCTION public.assert_account_access(id uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT 1 FROM profiles p WHERE p.id=$1 AND NOT is_locked) THEN RAISE EXCEPTION 'Account unavailable';END IF;END$$;
 CREATE FUNCTION public.currency_for_country(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT CASE $1 WHEN 'IN' THEN 'INR' WHEN 'US' THEN 'USD' END$$;
 CREATE FUNCTION public.normalize_country_code(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT $1$$;
 GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
 ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
 REVOKE ALL ON payment_transactions,payment_credits,profiles,coupons,orders FROM anon,authenticated;`);
 await db.exec(migration);
});
after(()=>db.close());
beforeEach(async()=>{
 await role('service_role');await db.exec('RESET ROLE;TRUNCATE profiles,companies,gift_cards,coupons,orders,payment_transactions,payment_credits,deposits CASCADE;');
 await db.exec(`INSERT INTO profiles(id,wallet_balance,country_code,currency) VALUES('${user}',1000,'IN','INR'),('${other}',0,'US','USD');
 INSERT INTO companies(id,name,prefix,status,coupon_limit,address,account_number,pan,document_url) VALUES('${company}','Fixture Merchant','TEST','approved',10,'Public business address','PRIVATE BANK','PRIVATE TAX','PRIVATE KYC');
 INSERT INTO gift_cards(id,company_id,title,description,price,value,country_code,currency,expiry_date,terms,issue_limit,is_active) VALUES('${card}','${company}','Fixture offer','Offer description',450,500,'IN','INR','2099-01-01T00:00:00Z','Published terms',2,true);`);
});
async function transaction({uid=user,amount=450,currency='INR',bound=true}={}){
 await db.exec('RESET ROLE');
 const row=await scalar(`INSERT INTO payment_transactions(user_id,gateway,gateway_order_id,amount_major,currency,status,gift_card_id,offer_snapshot)
 SELECT '${uid}','stripe',gen_random_uuid()::text,${amount},'${currency}','pending',${bound?`'${card}'::uuid`:'NULL'},${bound?`jsonb_build_object('price',g.price,'value',g.value,'currency',g.currency,'country_code',g.country_code,'expiry_date',g.expiry_date,'terms',g.terms,'title',g.title,'description',g.description,'company_id',g.company_id)`:'NULL'} FROM gift_cards g WHERE g.id='${card}' RETURNING id`);
 await role('service_role');return row.id;
}
const settle=async(id,capture='capture',amount=450,currency='INR')=>(await scalar(`SELECT settle_verified_payment('${id}','${capture}',${amount},'${currency}') result`)).result;
const counts=async()=>{await db.exec('RESET ROLE');return scalar(`SELECT (SELECT count(*)::int FROM coupons) coupons,(SELECT count(*)::int FROM orders) orders,(SELECT count(*)::int FROM payment_credits) credits,(SELECT wallet_balance::float FROM profiles WHERE id='${user}') balance`);};

test('verified direct checkout issues once and leaves the prior wallet balance unchanged',async()=>{
 const id=await transaction();const first=await settle(id);assert.equal(first.purchaseStatus,'issued');assert.ok(first.couponId);
 const retry=await settle(id);assert.equal(retry.couponId,first.couponId);assert.equal(retry.alreadyCredited,true);
 assert.deepEqual(await counts(),{coupons:1,orders:1,credits:1,balance:1000});
});
test('wrong amount, currency, capture replay and untrusted settlement never issue or credit',async()=>{
 const id=await transaction();await assert.rejects(settle(id,'capture',449),/mismatch/);await assert.rejects(settle(id,'capture',450,'USD'),/mismatch/);
 await role('authenticated',user);await assert.rejects(settle(id),/permission denied/);
 await role('service_role');await settle(id);await assert.rejects(settle(id,'another-capture'),/mismatch/i);
 assert.deepEqual(await counts(),{coupons:1,orders:1,credits:1,balance:1000});
});
test('sold-out, expired, disabled, changed-price and changed-terms offers retain the full payment in wallet',async()=>{
 for(const update of ["issue_limit=0","expiry_date=now()-interval '1 day'","is_active=false","price=451","terms='Changed terms'"]){
  await db.exec(`RESET ROLE;UPDATE gift_cards SET issue_limit=2,expiry_date='2099-01-01T00:00:00Z',is_active=true,price=450,terms='Published terms'`);
  const id=await transaction();await db.exec(`RESET ROLE;UPDATE gift_cards SET ${update}`);await role('service_role');
  const result=await settle(id,`capture-${update.replaceAll("'",'')}`);assert.equal(result.purchaseStatus,'wallet_credited',update);
  const repeated=await settle(id,`capture-${update.replaceAll("'",'')}`);assert.equal(repeated.purchaseStatus,'wallet_credited');
 }
 assert.deepEqual(await counts(),{coupons:0,orders:0,credits:5,balance:3250});
});
test('cancellation is serialized with settlement; a late capture credits wallet without issuing',async()=>{
 const id=await transaction();await db.exec(`SELECT abandon_coupon_checkout('${id}','${user}')`);
 assert.equal((await settle(id)).purchaseStatus,'wallet_credited');assert.deepEqual(await counts(),{coupons:0,orders:0,credits:1,balance:1450});
});
test('settlement winning a cancellation race returns the issued coupon',async()=>{
 const id=await transaction();const issued=await settle(id);const cancelled=(await scalar(`SELECT abandon_coupon_checkout('${id}','${user}') result`)).result;
 assert.equal(cancelled.state,'paid');assert.equal(cancelled.couponId,issued.couponId);
});
test('wallet retries debit once; changed quotes and depleted wallets fail without partial issuance',async()=>{
 await role('authenticated',user);const request='00000000-0000-0000-0000-000000000005';
 const sql=`SELECT purchase_coupon_once('${card}',450,'${request}') result`;
 const first=(await scalar(sql)).result;assert.deepEqual((await scalar(sql)).result,first);
 await assert.rejects(db.exec(`SELECT purchase_coupon_once('${card}',1,gen_random_uuid())`),/price changed/);
 await db.exec('RESET ROLE');await db.exec(`UPDATE profiles SET wallet_balance=1 WHERE id='${user}'`);await role('authenticated',user);
 await assert.rejects(db.exec(`SELECT purchase_coupon_once('${card}',450,gen_random_uuid())`),/Insufficient/);
 const result=await counts();assert.equal(result.coupons,1);assert.equal(result.orders,1);assert.equal(result.balance,1);
});
test('coupon details expose only public company fields and enforce account country and locks',async()=>{
 await role('authenticated',user);const result=(await scalar(`SELECT get_coupon_offer_details('${card}') result`)).result;
 assert.deepEqual(Object.keys(result.company).sort(),['address','joined_at','name','status']);assert.equal(result.coupon.available_count,2);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 await role('authenticated',other);assert.equal((await scalar(`SELECT get_coupon_offer_details('${card}') result`)).result,null);
 await db.exec('RESET ROLE');await db.exec(`UPDATE profiles SET is_locked=true WHERE id='${user}'`);await role('authenticated',user);
 await assert.rejects(db.exec(`SELECT get_coupon_offer_details('${card}')`),/Account unavailable/);
 await role('anon');await assert.rejects(db.exec(`SELECT get_coupon_offer_details('${card}')`),/permission denied/);
});
test('ordinary wallet top-ups preserve existing behavior and cross-order capture reuse is rejected',async()=>{
 const id=await transaction({bound:false});const result=await settle(id);assert.equal(result.purchaseStatus,undefined);
 assert.deepEqual(await counts(),{coupons:0,orders:0,credits:1,balance:1450});
 const another=await transaction();await assert.rejects(settle(another),/unique/);assert.equal((await counts()).balance,1450);
});
test('equivalent timestamp formats do not invalidate the offer snapshot; migration can be reapplied',async()=>{
 const id=await transaction();await db.exec(`RESET ROLE;UPDATE payment_transactions SET offer_snapshot=jsonb_set(offer_snapshot,'{expiry_date}','"2099-01-01T00:00:00.000Z"'::jsonb)`);await role('service_role');
 assert.equal((await settle(id)).purchaseStatus,'issued');await db.exec('RESET ROLE');await db.exec(migration);
 assert.deepEqual(await counts(),{coupons:1,orders:1,credits:1,balance:1000});
});
