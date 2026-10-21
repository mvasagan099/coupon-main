import test from 'node:test';
import assert from 'node:assert/strict';
import { couponGateways, quoteCoupon } from '../couponCheckout';
const id='00000000-0000-0000-0000-000000000004';
function fixture(overrides: Record<string,unknown>={}) {
 const card={id,price:450,value:500,currency:'INR',country_code:'IN',expiry_date:'2099-01-01',terms:'Terms',title:'Offer',description:'Description',company_id:'company',issue_limit:10,is_active:true,...overrides};
 const client={from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,single:async()=>({data:table==='gift_cards'?card:table==='profiles'?{country_code:'IN',currency:'INR'}:{status:'approved',coupon_limit:20},error:null}),then:(resolve:any)=>Promise.resolve({count:0,error:null}).then(resolve)};return q;
 }} as any;return client;
}
test('a direct checkout quotes persisted amount/currency and binds every material offer field',async()=>{
 const quote=await quoteCoupon(fixture(),'owner',id,450);assert.equal(quote.amount,450);assert.equal(quote.currency,'INR');assert.equal(quote.snapshot.value,500);assert.equal(quote.snapshot.terms,'Terms');
});
test('tampered prices, expired, disabled, wrong-country and invalid offers cannot create payments',async()=>{
 for(const [change,price] of [[{},1],[{expiry_date:'2020-01-01'},450],[{is_active:false},450],[{country_code:'US'},450],[{price:NaN},450],[{price:100001},100001]] as const) await assert.rejects(quoteCoupon(fixture(change),'owner',id,price));
 await assert.rejects(quoteCoupon(fixture(),'owner','invalid',450));
});
test('direct gateways require signing secrets; Razorpay only accepts INR checkout',()=>{
 const env={RAZORPAY_KEY_ID:'public',RAZORPAY_KEY_SECRET:'fixture',STRIPE_SECRET_KEY:'fixture'};
 assert.deepEqual(couponGateways('INR',env),[]);
 assert.deepEqual(couponGateways('INR',{...env,RAZORPAY_WEBHOOK_SECRET:'fixture'}),['razorpay']);
 assert.deepEqual(couponGateways('USD',{...env,RAZORPAY_WEBHOOK_SECRET:'fixture',STRIPE_WEBHOOK_SECRET:'fixture'}),['stripe']);
});
