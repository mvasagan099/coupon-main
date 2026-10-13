import { clients, failure, json, paypal } from '../_shared/payment.ts';
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(req, {});
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  try {
    const { user, admin } = await clients(req);
    const { amount, currency = 'USD' } = await req.json();
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
        amount !== Math.round(amount * 100) / 100 || currency !== 'USD') {
      throw new Error('Enter a valid USD amount with at most two decimal places.');
    }
    const receipt = crypto.randomUUID();
    const order = await paypal('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE', purchase_units: [{ reference_id: receipt, custom_id: user.id,
        amount: { currency_code: 'USD', value: amount.toFixed(2) } }],
    }, receipt);
    if (typeof order.id !== 'string') throw new Error('PayPal returned an incomplete order.');
    const { error } = await admin.from('payment_transactions').insert({ user_id: user.id, gateway: 'paypal',
      gateway_order_id: order.id, amount_major: amount, currency: 'USD', status: 'pending',
      idempotency_key: receipt, amount_usd: amount, amount_local: amount, exchange_rate: 1 });
    if (error) throw new Error('Could not save the payment order. No payment has been charged.');
    return json(req, { id: order.id });
  } catch (error) { return failure(req, error); }
});
