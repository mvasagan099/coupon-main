// server/services/PaymentService.ts
// Abstract interface — all gateway implementations must conform to this shape.

export type PaymentGateway = 'paypal' | 'razorpay' | 'stripe';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

/** Returned by createPayment — enough info for the frontend to open the checkout UI */
export interface CreatePaymentResult {
  /** Internal idempotency / tracking key */
  internalId: string;
  /** Gateway-assigned order/session/payment-intent id */
  gatewayOrderId: string;
  /**
   * Gateway-specific client credential:
   * - Razorpay: same as gatewayOrderId (order_id)
   * - Stripe:   client_secret of the PaymentIntent
   * - PayPal:   not used (order id is sufficient)
   */
  clientSecret?: string;
  /** Amount in the smallest unit (paise for INR, cents for USD) */
  amountMinorUnit: number;
  currency: string;
  gateway: PaymentGateway;
}

export interface VerifyPaymentInput {
  gateway: PaymentGateway;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  /** HMAC / signature provided by the gateway after payment */
  signature?: string;
}

export interface VerifyPaymentResult {
  verified: boolean;
  /** Amount captured in major unit (dollars / rupees) */
  amount: number;
  currency: string;
  gatewayPaymentId: string;
}

export interface PaymentServiceI {
  /**
   * Create a new payment order/session with the gateway.
   * @param amountMajor  amount in major units (e.g. 500 = $500 or ₹500)
   * @param currency     ISO currency code ('USD', 'INR', …)
   * @param receiptId    unique receipt / idempotency key
   */
  createPayment(
    amountMajor: number,
    currency: string,
    receiptId: string,
  ): Promise<CreatePaymentResult>;

  /** Cryptographically verify that the payment is genuine */
  verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;

  /** Capture an authorised payment (PayPal needs an explicit capture step) */
  capturePayment(gatewayOrderId: string): Promise<{ amount: number; currency: string }>;

  /** Fetch current status from the gateway */
  getPaymentStatus(gatewayOrderId: string): Promise<PaymentStatus>;

  /** Initiate a refund for a captured payment */
  refundPayment(gatewayPaymentId: string, amountMajor?: number): Promise<void>;
}
