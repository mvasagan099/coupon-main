import { clients, failure, json, paypal } from '../_shared/payment.ts';
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(req, {});
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  try {
    const { user, admin } = await clients(req);
    const { order_id: orderId } = await req.json();
    if (typeof orderId !== 'string' || !/^[A-Z0-9]{5,64}$/.test(orderId)) throw new Error('Invalid order ID.');
    const { data: stored, error } = await admin.from('payment_transactions').select('*')
      .eq('gateway', 'paypal').eq('gateway_order_id', orderId).eq('user_id', user.id).maybeSingle();
    if (error) throw new Error('Payment records are unavailable. Retry verification.');
    if (!stored) throw new Error('Order does not belong to this account.');
    if (stored.status === 'paid') return json(req, { verified: true, amount: Number(stored.amount_major), alreadyCredited: true });
    let order = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    const unit = order.purchase_units?.[0];
    if (order.purchase_units?.length !== 1 || Number(unit?.amount?.value) !== Number(stored.amount_major) ||
      unit?.amount?.currency_code !== stored.currency || unit?.custom_id !== user.id) throw new Error('Order details do not match the stored payment.');
    if (order.status === 'APPROVED') {
      order = await paypal(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, 'POST', {}, stored.idempotency_key);
    }
    if (order.status !== 'COMPLETED') throw new Error('Payment has not been captured.');
    const captures = order.purchase_units?.[0]?.payments?.captures;
    const capture = captures?.[0];
    if (captures?.length !== 1 || capture?.status !== 'COMPLETED' || Number(capture.amount?.value) !== Number(stored.amount_major) ||
      capture.amount?.currency_code !== stored.currency || !capture.id) throw new Error('Captured payment does not match the order.');
    const { data: settlement, error: creditError } = await admin.rpc('settle_verified_payment', {
      p_transaction_id: stored.id, p_capture_id: capture.id, p_amount: Number(capture.amount.value), p_currency: capture.amount.currency_code,
    });
    if (creditError || !settlement) throw new Error('Payment received; wallet credit is pending. Retry verification with the same order.');
    return json(req, { verified: true, amount: Number(stored.amount_major), ...settlement });
  } catch (error) { return failure(req, error); }
});
