import test from 'node:test';
import assert from 'node:assert/strict';
import { userAuthentication } from '../security';
import { findPayment, settlePayment } from '../paymentSettlement';

async function authenticate(token: string | undefined, user: unknown, active: boolean, authError: unknown = null) {
 const client = { auth: { getUser: async () => ({data:{user},error:authError}) }, rpc: async () => ({data:active,error:null}) };
 const res = { code:0, locals:{}, status(code:number){ this.code=code; return this; }, json() { return this; } };
 let next=false;
 await (userAuthentication(client as any) as any)({headers:{authorization:token}},res,()=>{next=true;});
 return {code:res.code,next,locals:res.locals};
}
test('unsigned, expired and missing sessions never reach handlers',async()=>{
 assert.equal((await authenticate(undefined,null,true)).code,401);
 assert.equal((await authenticate('Bearer forged.jwt',null,true,new Error('invalid'))).code,401);
 assert.equal((await authenticate('Bearer anon',{id:'u',is_anonymous:true},true)).code,401);
});
test('persisted locks reject otherwise valid sessions',async()=>{
 assert.equal((await authenticate('Bearer valid',{id:'u'},false)).code,403);
 assert.equal((await authenticate('Bearer valid',{id:'u'},true)).next,true);
});
function paymentClient(owner='owner') {
 let settlements=0;
 const row={id:'transaction',user_id:owner,currency:'USD',amount_major:10,amount_usd:10,exchange_rate:1};
 const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:row,error:null})};
 return {client:{from:()=>query,rpc:async()=>{settlements++;return {data:{alreadyCredited:false},error:null};}},count:()=>settlements};
}
test('an order belonging to another user cannot be read or credited',async()=>{
 const mock=paymentClient();
 await assert.rejects(findPayment(mock.client as any,'paypal','order','stranger'),/belong/);
 assert.equal(mock.count(),0);
});
test('unverified capture, wrong amount and wrong currency never credit a wallet',async()=>{
 const mock=paymentClient();
 const valid={verified:true,amount:10,currency:'USD',gatewayPaymentId:'capture'};
 for(const payment of [{...valid,verified:false},{...valid,amount:11},{...valid,currency:'INR'},{...valid,gatewayPaymentId:''}]) {
  await assert.rejects(settlePayment(mock.client as any,'paypal','order','owner',payment),/match/);
 }
 assert.equal(mock.count(),0);
 await settlePayment(mock.client as any,'paypal','order','owner',valid);
 assert.equal(mock.count(),1);
});
test('failed atomic settlement never reports a completed credit',async()=>{
 const mock=paymentClient(); mock.client.rpc=async()=>({data:null,error:new Error('DB unavailable')}) as any;
 await assert.rejects(settlePayment(mock.client as any,'paypal','order','owner',{verified:true,amount:10,currency:'USD',gatewayPaymentId:'capture'}),/pending/);
});
