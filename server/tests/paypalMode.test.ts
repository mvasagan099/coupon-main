import test from 'node:test';
import assert from 'node:assert/strict';
import { PayPalService } from '../services/PayPalService';

test('PayPal honors explicit sandbox mode in production and rejects invalid modes', async (t) => {
 const keys=['NODE_ENV','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_MODE'];
 const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const key of keys) { if(original[key]===undefined) delete process.env[key]; else process.env[key]=original[key]; }});
 process.env.NODE_ENV='production';
 process.env.PAYPAL_CLIENT_ID='sandbox-fixture';
 process.env.PAYPAL_CLIENT_SECRET='sandbox-fixture';
 process.env.PAYPAL_MODE='sandbox';
 const urls: string[]=[];
 t.mock.method(globalThis,'fetch',async (input: string | URL | Request) => {
  urls.push(String(input));
  return new Response(JSON.stringify(String(input).endsWith('/token') ? {access_token:'fixture-token'} : {id:'fixture-order'}),{status:200});
 });
 await new PayPalService().createPayment(10,'USD','fixture-receipt');
 assert.equal(urls.length,2);
 assert.ok(urls.every(url=>url.startsWith('https://api-m.sandbox.paypal.com/')));
 process.env.PAYPAL_MODE='invalid';
 assert.throws(()=>new PayPalService(),/PAYPAL_MODE/);
});
