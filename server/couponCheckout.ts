import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentGateway } from './services/PaymentService';

export function couponGateways(currency: string, env = process.env): PaymentGateway[] {
  const gateways: PaymentGateway[] = [];
  const isSet = (val?: string) => typeof val === 'string' && val.trim().length > 0;

  // Razorpay is the primary gateway for India (INR)
  const hasRazorpay = isSet(env.RAZORPAY_KEY_ID) && (isSet(env.RAZORPAY_KEY_SECRET) || isSet(env.RAZORPAY_WEBHOOK_SECRET));
  if (currency === 'INR' && hasRazorpay) {
    gateways.push('razorpay');
  }

  // Stripe supports cards & global payments
  const hasStripe = isSet(env.STRIPE_SECRET_KEY) || isSet(env.STRIPE_WEBHOOK_SECRET);
  if (hasStripe) {
    gateways.push('stripe');
  }

  // PayPal supports global payments for non-INR currencies
  const hasPaypal = isSet(env.PAYPAL_CLIENT_ID) && (isSet(env.PAYPAL_CLIENT_SECRET) || isSet(env.PAYPAL_SECRET));
  if (hasPaypal && currency !== 'INR') {
    gateways.push('paypal');
  }

  return gateways;
}

// Quote only persisted, eligible inventory. Client amounts and company fields are never authoritative.
export async function quoteCoupon(client: SupabaseClient, userId: string, giftCardId: unknown, expectedPrice: unknown) {
  if (typeof giftCardId !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(giftCardId)) throw new Error('Invalid coupon.');
  const [{ data: card, error }, { data: profile, error: profileError }] = await Promise.all([
    client.from('gift_cards').select('id,price,value,currency,country_code,expiry_date,terms,title,description,company_id,issue_limit,is_active').eq('id', giftCardId).single(),
    client.from('profiles').select('country_code,currency').eq('id', userId).single(),
  ]);
  if (error || !card || profileError || !profile) throw new Error('Coupon details are unavailable.');
  if (!card.is_active || (card.expiry_date && Date.parse(card.expiry_date) <= Date.now())) throw new Error('This coupon is no longer available.');
  if (!profile.country_code || card.country_code !== profile.country_code || card.currency !== profile.currency) throw new Error('This coupon is not available for your account country.');
  const price = Number(card.price);
  if (!Number.isFinite(Number(card.value)) || Number(card.value) <= 0 || Number(card.value) > 1_000_000) throw new Error('This coupon has no valid face value.');
  if (!Number.isFinite(price) || price <= 0 || price > 100_000 || Math.round(price * 100) / 100 !== price || typeof expectedPrice !== 'number' || expectedPrice !== price) throw new Error('Coupon price changed. Refresh and review the offer.');
  const [{ data: company, error: companyError }, stock, total] = await Promise.all([
    client.from('companies').select('status,coupon_limit').eq('id', card.company_id).single(),
    client.from('coupons').select('id', { count: 'exact', head: true }).eq('gift_card_id', card.id),
    client.from('coupons').select('id', { count: 'exact', head: true }).eq('company_id', card.company_id),
  ]);
  if (companyError || company?.status !== 'approved' || stock.error || total.error || stock.count === null || total.count === null) throw new Error('Coupon availability could not be confirmed.');
  if ((card.issue_limit !== null && stock.count >= card.issue_limit) || total.count >= company.coupon_limit) throw new Error('This coupon is sold out.');
  const { price: _price, value, currency, country_code, expiry_date, terms, title, description, company_id } = card;
  return { giftCardId: card.id as string, amount: price, currency: currency as string,
    snapshot: { price, value: Number(value), currency, country_code, expiry_date, terms, title, description, company_id } };
}
