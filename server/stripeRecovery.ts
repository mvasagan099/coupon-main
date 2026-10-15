import type { SupabaseClient } from '@supabase/supabase-js';
import { findPayment, settlePayment } from './paymentSettlement';
import type { StripeService } from './services/StripeService';

export async function recoverStripePayment(client: SupabaseClient, service: StripeService, userId: string, intentId: string) {
 const stored = await findPayment(client,'stripe',intentId,userId);
 const intent = await service.retrieveIntent(intentId);
 if (intent.currency.toUpperCase() !== stored.currency || intent.amount / 100 !== Number(stored.amount_major)) throw new Error('Payment details do not match saved order.');
 if (intent.status === 'succeeded') {
  return { state:'paid', ...await settlePayment(client,'stripe',intentId,userId,await service.verifyPayment({gateway:'stripe',gatewayOrderId:intentId,gatewayPaymentId:intentId})) };
 }
 if (intent.status === 'canceled') return {state:'cancelled'};
 if (['requires_payment_method','requires_confirmation','requires_action'].includes(intent.status)) {
  return {state:'resume',orderId:intent.id,clientSecret:intent.client_secret,amount:intent.amount,currency:intent.currency.toUpperCase()};
 }
 return {state:'processing'};
}
