import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverStripePayment } from '../stripeRecovery';
function fixtures(status:string, owner='owner') {
 let captures=0,credits=0,reads=0;
 const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'tx',user_id:owner,currency:'GBP',amount_major:12},error:null})};
 return {
  client:{from:()=>q,rpc:async()=>{credits++;return {data:{alreadyCredited:false},error:null};}} as any,
  service:{retrieveIntent:async()=>{reads++;return {id:'pi_saved',amount:1200,currency:'gbp',status,client_secret:'existing-secret'};},verifyPayment:async()=>({verified:true,amount:12,currency:'GBP',gatewayPaymentId:'pi_saved'}),createPayment:()=>{captures++;throw new Error('Recovery must not create another payment');}} as any,
  counts:()=>({captures,credits,reads})
 };
}
test('only saved-order owners can recover Stripe payments',async()=>{
 const f=fixtures('succeeded');await assert.rejects(recoverStripePayment(f.client,f.service,'stranger','pi_saved'),/belong/);assert.equal(f.counts().reads,0);
});
test('Stripe recovery credits succeeded payments through settlement without a new charge',async()=>{
 const f=fixtures('succeeded');const result=await recoverStripePayment(f.client,f.service,'owner','pi_saved');
 assert.equal(result.state,'paid');assert.equal(f.counts().credits,1);assert.equal(f.counts().captures,0);
});
test('unfinished Stripe payments resume the same intent; processing and cancellation never credit',async()=>{
 for(const status of ['requires_payment_method','requires_confirmation','requires_action']) {
  const f=fixtures(status);const r=await recoverStripePayment(f.client,f.service,'owner','pi_saved');
  assert.equal(r.state,'resume');assert.equal((r as any).orderId,'pi_saved');assert.equal(f.counts().credits,0);assert.equal(f.counts().captures,0);
 }
 for(const [status,state] of [['processing','processing'],['canceled','cancelled']]) {
  const f=fixtures(status);assert.equal((await recoverStripePayment(f.client,f.service,'owner','pi_saved')).state,state);assert.equal(f.counts().credits,0);
 }
});
