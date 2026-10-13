import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentGateway, VerifyPaymentResult } from './services/PaymentService';

export async function findPayment(client: SupabaseClient, gateway: PaymentGateway, orderId: string, userId?: string) {
  const { data, error } = await client.from('payment_transactions').select('*')
    .eq('gateway', gateway).eq('gateway_order_id', orderId).maybeSingle();
  if (error) throw new Error('Payment records are unavailable. Please retry.');
  if (!data || (userId && data.user_id !== userId)) throw new Error('Payment does not belong to this account.');
  return data;
}

/** Provider result is validated here; only the atomic RPC can credit the wallet. */
export async function settlePayment(client: SupabaseClient, gateway: PaymentGateway, orderId: string,
  userId: string, payment: VerifyPaymentResult) {
  const transaction = await findPayment(client, gateway, orderId, userId);
  if (!payment.verified || !Number.isFinite(payment.amount) || payment.amount <= 0 ||
      payment.currency.toUpperCase() !== transaction.currency.toUpperCase() ||
      Math.abs(payment.amount - Number(transaction.amount_major)) > 0.000001 || !payment.gatewayPaymentId) {
    throw new Error('Captured payment does not match the stored order.');
  }
  const { data, error } = await client.rpc('settle_verified_payment', {
    p_transaction_id: transaction.id,
    p_capture_id: payment.gatewayPaymentId,
    p_amount: payment.amount,
    p_currency: payment.currency.toUpperCase(),
  });
  if (error || !data) throw new Error('Payment received; wallet credit is pending. Retry verification with the same order.');
  return { amount: Number(transaction.amount_usd), amountLocal: payment.amount,
    currency: payment.currency, exchangeRate: Number(transaction.exchange_rate), ...data };
}
