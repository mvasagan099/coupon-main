// server/services/StripeService.ts
import Stripe from 'stripe';
import type {
  PaymentServiceI,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  PaymentStatus,
} from './PaymentService';

export class StripeService implements PaymentServiceI {
  private stripe: Stripe;

  constructor() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY must be set in environment variables.');
    }
    this.stripe = new Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' });
  }

  async createPayment(
    amountMajor: number,
    currency = 'USD',
    receiptId: string,
  ): Promise<CreatePaymentResult> {
    // Stripe works in cents: $500 → 50000 cents
    const amountMinorUnit = Math.round(amountMajor * 100);

    const paymentIntent = await this.stripe.paymentIntents.create({
      amount: amountMinorUnit,
      currency: currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      metadata: { receipt_id: receiptId },
    }, {
      idempotencyKey: receiptId,
    });

    return {
      internalId: receiptId,
      gatewayOrderId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret ?? undefined,
      amountMinorUnit,
      currency: paymentIntent.currency.toUpperCase(),
      gateway: 'stripe',
    };
  }

  async retrieveIntent(id: string) { return this.stripe.paymentIntents.retrieve(id); }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const { gatewayOrderId } = input;

    const paymentIntent = await this.stripe.paymentIntents.retrieve(gatewayOrderId);

    if (paymentIntent.status !== 'succeeded') {
      throw new Error(
        `Stripe PaymentIntent ${gatewayOrderId} has not succeeded (status: ${paymentIntent.status}).`,
      );
    }

    const amount = paymentIntent.amount_received / 100;

    return {
      verified: true,
      amount,
      currency: paymentIntent.currency.toUpperCase(),
      gatewayPaymentId: paymentIntent.id,
    };
  }

  /** Verify a Stripe webhook event using the webhook signing secret */
  verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
    }
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async capturePayment(gatewayOrderId: string): Promise<{ amount: number; currency: string }> {
    const intent = await this.stripe.paymentIntents.capture(gatewayOrderId);
    return {
      amount: intent.amount_received / 100,
      currency: intent.currency.toUpperCase(),
    };
  }

  async getPaymentStatus(gatewayOrderId: string): Promise<PaymentStatus> {
    const intent = await this.stripe.paymentIntents.retrieve(gatewayOrderId);
    switch (intent.status) {
      case 'succeeded':                                    return 'paid';
      case 'processing':                                   return 'processing';
      case 'requires_payment_method':
      case 'requires_confirmation':
      case 'requires_action':                              return 'pending';
      case 'canceled':                                     return 'cancelled';
      default:                                             return 'failed';
    }
  }

  async refundPayment(gatewayPaymentId: string, amountMajor?: number): Promise<void> {
    const params: Stripe.RefundCreateParams = { payment_intent: gatewayPaymentId };
    if (amountMajor) {
      params.amount = Math.round(amountMajor * 100);
    }
    await this.stripe.refunds.create(params);
  }
}
