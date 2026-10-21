// server/services/RazorpayService.ts
import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  PaymentServiceI,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  PaymentStatus,
} from './PaymentService';

export class RazorpayService implements PaymentServiceI {
  private client: Razorpay;

  constructor() {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set in environment variables.');
    }

    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async createPayment(
    amountMajor: number,
    currency = 'INR',
    receiptId: string,
  ): Promise<CreatePaymentResult> {
    // Razorpay works in paise (smallest unit): ₹500 → 50000 paise
    const amountMinorUnit = Math.round(amountMajor * 100);

    const order = await this.client.orders.create({
      amount: amountMinorUnit,
      currency,
      receipt: receiptId.slice(0, 40), // Razorpay max receipt length = 40
      payment_capture: true, // auto-capture on payment
    });

    return {
      internalId: receiptId,
      gatewayOrderId: order.id,
      clientSecret: order.id, // Razorpay uses order_id as the client token
      amountMinorUnit,
      currency: order.currency,
      gateway: 'razorpay',
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const { gatewayOrderId, gatewayPaymentId, signature } = input;

    if (!signature) {
      throw new Error('Razorpay signature is required for verification.');
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const body = `${gatewayOrderId}|${gatewayPaymentId}`;
    const expectedSignature = createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');
    const signaturesMatch =
      sigBuf.length === expectedBuf.length &&
      timingSafeEqual(sigBuf, expectedBuf);

    if (!signaturesMatch) {
      throw new Error('Razorpay signature verification failed — possible tampering detected.');
    }

    // Fetch payment details to get the captured amount
    const payment = await this.client.payments.fetch(gatewayPaymentId);

    if (payment.order_id !== gatewayOrderId) throw new Error('Payment belongs to a different order.');
    if (payment.status !== 'captured') {
      throw new Error(`Razorpay payment ${gatewayPaymentId} is not captured (status: ${payment.status}).`);
    }

    const amount = (payment.amount as number) / 100; // paise → rupees

    return {
      verified: true,
      amount,
      currency: payment.currency,
      gatewayPaymentId,
    };
  }

  // Recovery uses authenticated provider data, never a browser claim or an unsigned callback.
  async findCapturedOrderPayment(orderId: string): Promise<VerifyPaymentResult | null> {
    const payments = await this.client.orders.fetchPayments(orderId);
    const payment = payments.items.find(item => item.order_id === orderId && item.status === 'captured');
    if (!payment) return null;
    return { verified:true, amount:Number(payment.amount)/100, currency:payment.currency, gatewayPaymentId:payment.id };
  }

  async capturePayment(gatewayPaymentId: string): Promise<{ amount: number; currency: string }> {
    // Razorpay auto-captures when payment_capture: true in order creation.
    // This method is provided for manual-capture flows if needed.
    const payment = await this.client.payments.fetch(gatewayPaymentId);
    const amount = (payment.amount as number) / 100;
    return { amount, currency: payment.currency };
  }

  async getPaymentStatus(gatewayOrderId: string): Promise<PaymentStatus> {
    const order = await this.client.orders.fetch(gatewayOrderId);
    switch (order.status) {
      case 'paid':       return 'paid';
      case 'attempted':  return 'processing';
      case 'created':    return 'pending';
      default:           return 'pending';
    }
  }

  async refundPayment(gatewayPaymentId: string, amountMajor?: number): Promise<void> {
    const params: Record<string, unknown> = {};
    if (amountMajor) {
      params.amount = Math.round(amountMajor * 100);
    }
    await this.client.payments.refund(gatewayPaymentId, params as any);
  }
}
