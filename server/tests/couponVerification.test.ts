import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyGameCoupon } from '../couponVerification';
function client(coupon: Record<string,unknown>={}, owner: Record<string,unknown>={}) {
 const rows: Record<string,unknown>={coupons:{id:'coupon',amount:100,remaining_balance:75,status:'active',is_used:false,country_code:'IN',issued_to:'owner',...coupon},profiles:{country_code:'IN',is_locked:false,...owner}};
 return {from:(table:string)=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:rows[table],error:null})};return q;}} as any;
}
test('game quote uses remaining balance and the coupon local currency',async()=>{
 const quote=await verifyGameCoupon(client(),'CODE','IN'); assert.equal(quote.amount,75); assert.equal(quote.currency,'INR');
 const foreign=await verifyGameCoupon(client({country_code:'US'},{country_code:'US'}),'CODE','US'); assert.equal(foreign.currency,'USD');
});
test('expired, locked, wrong-country and empty game coupons fail closed',async()=>{
 await assert.rejects(verifyGameCoupon(client({expiry_date:'2000-01-01'}),'CODE','IN'),/expired/);
 await assert.rejects(verifyGameCoupon(client({}, {is_locked:true}),'CODE','IN'),/locked/);
 await assert.rejects(verifyGameCoupon(client(),'CODE','US'),/country/);
 await assert.rejects(verifyGameCoupon(client({remaining_balance:0}),'CODE','IN'),/spendable/);
 await assert.rejects(verifyGameCoupon(client({status:'disabled'}),'CODE','IN'),/unavailable/);
});
