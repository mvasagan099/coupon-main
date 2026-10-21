// server/services/PayPalService.ts
// Wraps PayPal REST API v2 using direct fetch calls (no extra SDK dependency).

import type {
  PaymentServiceI,
  CreatePaymentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  PaymentStatus,
} from './PaymentService';

interface PayPalTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class PayPalService implements PaymentServiceI {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId: string;

  constructor() {
    this.clientId     = process.env.PAYPAL_CLIENT_ID     ?? '';
    this.clientSecret = process.env.PAYPAL_CLIENT_SECRET ?? '';
    this.webhookId    = process.env.PAYPAL_WEBHOOK_ID    ?? '';

    const mode = process.env.PAYPAL_MODE ?? (process.env.NODE_ENV === 'production' ? 'live' : 'sandbox');
    if (mode !== 'sandbox' && mode !== 'live') throw new Error('PAYPAL_MODE must be sandbox or live.');
    const isSandbox = mode === 'sandbox';
    this.baseUrl = isSandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';

    if (!this.clientId || !this.clientSecret) {
      throw new Error('PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in environment variables.');
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as PayPalTokenResponse;
    return json.access_token;
  }

  private async paypalFetch<T = unknown>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    const json = await res.json() as T;
    if (!res.ok) {
      throw new Error(`PayPal API error ${res.status}: ${JSON.stringify(json)}`);
    }
    return json;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async createPayment(
    amountMajor: number,
    currency = 'USD',
    receiptId: string,
  ): Promise<CreatePaymentResult> {
    const order = await this.paypalFetch<any>('/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': receiptId }, // idempotency
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: receiptId,
            amount: { currency_code: currency, value: amountMajor.toFixed(2) },
          },
        ],
      }),
    });

    return {
      internalId: receiptId,
      gatewayOrderId: order.id,
      amountMinorUnit: Math.round(amountMajor * 100),
      currency,
      gateway: 'paypal',
    };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const { gatewayOrderId } = input;
    let order = await this.paypalFetch<any>(`/v2/checkout/orders/${gatewayOrderId}`);

    // Customer has approved checkout; capture the payment to finalize it
    if (order.status === 'APPROVED') {
      await this.capturePayment(gatewayOrderId);
      order = await this.paypalFetch<any>(`/v2/checkout/orders/${gatewayOrderId}`);
    }

    if (order.status !== 'COMPLETED') {
      throw new Error(`PayPal order ${gatewayOrderId} is not COMPLETED (status: ${order.status}).`);
    }

    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (order.purchase_units?.length !== 1 || order.purchase_units?.[0]?.payments?.captures?.length !== 1 || capture?.status !== 'COMPLETED') {
      throw new Error('No capture record found in PayPal order.');
    }

    const amount = parseFloat(capture.amount.value);
    const currency = capture.amount.currency_code;

    return { verified: true, amount, currency, gatewayPaymentId: capture.id };
  }

  async capturePayment(gatewayOrderId: string): Promise<{ amount: number; currency: string }> {
    const result = await this.paypalFetch<any>(
      `/v2/checkout/orders/${gatewayOrderId}/capture`,
      { method: 'POST', body: JSON.stringify({}) },
    );

    const capture = result.purchase_units?.[0]?.payments?.captures?.[0];
    const amount = parseFloat(capture?.amount?.value ?? '0');
    const currency = capture?.amount?.currency_code ?? 'USD';
    return { amount, currency };
  }

  async getPaymentStatus(gatewayOrderId: string): Promise<PaymentStatus> {
    const order = await this.paypalFetch<any>(`/v2/checkout/orders/${gatewayOrderId}`);
    switch (order.status) {
      case 'COMPLETED':    return 'paid';
      case 'APPROVED':     return 'processing';
      case 'CREATED':      return 'pending';
      case 'VOIDED':       return 'cancelled';
      default:             return 'pending';
    }
  }

  async refundPayment(gatewayPaymentId: string, amountMajor?: number): Promise<void> {
    const body: Record<string, unknown> = {};
    if (amountMajor) {
      body.amount = { value: amountMajor.toFixed(2), currency_code: 'USD' };
    }
    await this.paypalFetch(`/v2/payments/captures/${gatewayPaymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** Verify a PayPal webhook event signature (prevents replay attacks) */
  async verifyWebhookSignature(
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): Promise<boolean> {
    if (!this.webhookId) return false; // Skip if not configured

    try {
      const result = await this.paypalFetch<{ verification_status: string }>(
        '/v1/notifications/verify-webhook-signature',
        {
          method: 'POST',
          body: JSON.stringify({
            auth_algo:             headers['paypal-auth-algo'],
            cert_url:              headers['paypal-cert-url'],
            transmission_id:       headers['paypal-transmission-id'],
            transmission_sig:      headers['paypal-transmission-sig'],
            transmission_time:     headers['paypal-transmission-time'],
            webhook_id:            this.webhookId,
            webhook_event:         JSON.parse(rawBody),
          }),
        },
      );
      return result.verification_status === 'SUCCESS';
    } catch {
      return false;
    }
  }
}
