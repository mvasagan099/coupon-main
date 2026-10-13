import { clients, failure, json } from '../_shared/payment.ts';
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(req, {});
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  try {
    const { userClient } = await clients(req);
    const { coupon_code, amount } = await req.json();
    if (typeof coupon_code !== 'string' || !coupon_code.trim()) throw new Error('Coupon code is required.');
    const { data: rows, error: lookupError } = await userClient.rpc('validate_coupon', { p_code: coupon_code.trim() });
    if (lookupError || !rows?.[0]) throw new Error('Coupon not found or unauthorized.');
    const coupon = rows[0];
    const redeemAmount = amount ?? Number(coupon.remaining_balance);
    if (typeof redeemAmount !== 'number' || !Number.isFinite(redeemAmount) || redeemAmount <= 0) throw new Error('Invalid amount.');
    const { data, error } = await userClient.rpc('redeem_coupon_amount', { p_coupon_id: coupon.coupon_id, p_amount: redeemAmount });
    if (error || !data?.[0]) throw new Error(error?.message ?? 'Redemption was not confirmed.');
    return json(req, { success: true, redeemed_amount: redeemAmount, ...data[0] });
  } catch (error) { return failure(req, error); }
});
