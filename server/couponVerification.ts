import type { SupabaseClient } from '@supabase/supabase-js';

const currencies: Record<string,string> = { IN:'INR', US:'USD', GB:'GBP', AE:'AED', AU:'AUD' };
export class CouponError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export async function verifyGameCoupon(client: SupabaseClient, code: string, userCountry: string | null) {
  const { data: coupon, error } = await client.from('coupons')
    .select('id,is_used,remaining_balance,status,country_code,issued_to,expiry_date')
    .eq('code', code.trim()).maybeSingle();
  if (error) throw new CouponError('UNAVAILABLE','Unable to verify coupon. Retry later.',503);
  if (!coupon) throw new CouponError('INVALID_COUPON','Coupon not found.',404);
  if (coupon.is_used || coupon.status?.toLowerCase() === 'redeemed') throw new CouponError('REDEEMED','Coupon already redeemed.');
  if (coupon.status?.toLowerCase() !== 'active' || (coupon.expiry_date && new Date(coupon.expiry_date).getTime() <= Date.now())) {
    throw new CouponError('INACTIVE','Coupon is expired or unavailable.');
  }
  const { data: owner, error: ownerError } = await client.from('profiles').select('country_code,is_locked').eq('id',coupon.issued_to).maybeSingle();
  if (ownerError) throw new CouponError('UNAVAILABLE','Unable to verify coupon owner.',503);
  if (!owner || owner.is_locked) throw new CouponError('ACCOUNT_LOCKED','Coupon owner is locked or unavailable.');
  const country = coupon.country_code;
  if (!country || !currencies[country] || owner.country_code !== country || country !== userCountry) {
    throw new CouponError('COUNTRY_MISMATCH','Coupon country must match the owner and the game account.');
  }
  const amount = Number(coupon.remaining_balance);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) throw new CouponError('INVALID_BALANCE','Coupon has no spendable balance.');
  return { success:true, couponId:coupon.id, amount, currency:currencies[country], status:coupon.status, countryCode:country };
}
