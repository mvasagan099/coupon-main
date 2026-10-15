// src/lib/paymentGateway.ts
// Client-side helpers for Razorpay and Stripe.
// PayPal is handled by @paypal/react-paypal-js directly.

import { loadStripe, type Stripe } from '@stripe/stripe-js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type PaymentGateway = 'paypal' | 'razorpay' | 'stripe';

export interface GatewayCreateResponse {
  success: boolean;
  gateway: PaymentGateway;
  orderId: string;
  clientSecret?: string;
  amount: number;     // minor unit (paise / cents)
  currency: string;
  receiptId: string;
}

export interface GatewayVerifyResponse {
  success: boolean;
  verified: boolean;
  amount: number;
  currency: string;
  amountLocal?: number;
  exchangeRate?: number;
}

export interface RazorpayPaymentResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

// ── API helpers ────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/** Gets the current Supabase user JWT for authenticating payment API calls */
async function getAuthToken(): Promise<string> {
  // Lazy import to avoid circular deps
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('You must be signed in to make a payment.');
  }
  return session.access_token;
}

async function serverPost<T>(path: string, body: object): Promise<T> {
  const token = await getAuthToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Cannot reach the payment server. Make sure the server is running on port 4000.',
    );
  }

  // Guard against HTML error pages (e.g. 404 from old server, proxy errors)
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    void res.text().catch(() => ''); // drain body to avoid resource leak
    throw new Error(
      res.status === 404
        ? 'Payment API route not found. Please restart the server (npm run dev in /server).'
        : `Payment server returned an unexpected response (HTTP ${res.status}). Try restarting the server.`,
    );
  }

  const json = await res.json() as T & { message?: string };
  if (!res.ok) {
    throw new Error((json as any).message ?? `Server error ${res.status}`);
  }
  return json;
}


// ── Create payment (calls our Express backend) ─────────────────────────────────

export async function createPayment(
  gateway: PaymentGateway,
  amountMajor: number,
  currency?: string,
): Promise<GatewayCreateResponse> {
  return serverPost<GatewayCreateResponse>('/api/v1/payments/create', {
    gateway,
    amount: amountMajor,
    currency: currency ?? (gateway === 'razorpay' ? 'INR' : 'USD'),
  });
}

// ── Verify payment (calls our Express backend) ─────────────────────────────────

export async function verifyPayment(
  gateway: PaymentGateway,
  gatewayOrderId: string,
  gatewayPaymentId: string,
  signature?: string,
): Promise<GatewayVerifyResponse> {
  return serverPost<GatewayVerifyResponse>('/api/v1/payments/verify', {
    gateway,
    gatewayOrderId,
    gatewayPaymentId,
    signature,
  });
}

// ── Razorpay ───────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => {
      open(): void;
      on(event: string, handler: (response: any) => void): void;
    };
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

/** Lazily loads the Razorpay checkout.js script */
export function loadRazorpayScript(): Promise<void> {
  if (razorpayScriptPromise) return razorpayScriptPromise;
  razorpayScriptPromise = new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Razorpay SDK.'));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
}

/**
 * Opens the Razorpay payment popup and resolves with the payment result.
 * Throws on failure or dismissal.
 */
export function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amountMinorUnit: number;
  currency: string;
  name?: string;
  description?: string;
  prefillEmail?: string;
  prefillContact?: string;
  theme?: string;
}): Promise<RazorpayPaymentResult> {
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key:         options.keyId,
      amount:      options.amountMinorUnit,
      currency:    options.currency,
      order_id:    options.orderId,
      name:        options.name        ?? 'Gift Hub',
      description: options.description ?? 'Wallet top-up',
      theme:       { color: options.theme ?? '#6c63ff' },
      prefill: {
        email:   options.prefillEmail   ?? '',
        contact: options.prefillContact ?? '',
      },
      handler: (response: RazorpayPaymentResult) => {
        resolve(response);
      },
      modal: {
        ondismiss: () => reject(new Error('Payment cancelled by user.')),
      },
    });
    rzp.open();
  });
}

// ── Stripe ─────────────────────────────────────────────────────────────────────

let stripePromise: Promise<Stripe | null> | null = null;

/** Lazily loads the Stripe.js SDK */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    stripePromise = loadStripe(publishableKey ?? '');
  }
  return stripePromise;
}

/**
 * Uses Stripe Payment Element (embedded) with a PaymentIntent client_secret.
 * Returns the paymentIntentId after confirmation.
 *
 * NOTE: The caller is responsible for mounting the Stripe Elements UI.
 * This helper only confirms the payment given an already-mounted Elements instance.
 */
export async function confirmStripePayment(
  clientSecret: string,
  returnUrl: string,
): Promise<{ paymentIntentId: string }> {
  const stripe = await getStripe();
  if (!stripe) throw new Error('Stripe SDK could not be loaded.');

  const { error, paymentIntent } = await stripe.confirmPayment({
    clientSecret,
    confirmParams: { return_url: returnUrl },
    redirect: 'if_required', // Stay on page if redirect not required
  });

  if (error) {
    throw new Error(error.message ?? 'Stripe payment failed.');
  }

  if (!paymentIntent || paymentIntent.status !== 'succeeded') {
    throw new Error(`Stripe payment not succeeded (status: ${paymentIntent?.status ?? 'unknown'}).`);
  }

  return { paymentIntentId: paymentIntent.id };
}

export interface StripeRecoveryResult {
  state: 'paid' | 'resume' | 'cancelled' | 'processing';
  amount?: number;
  currency?: string;
  orderId?: string;
  clientSecret?: string;
}
export async function recoverStripePayment(intentId: string): Promise<StripeRecoveryResult> {
  return serverPost('/api/v1/payments/stripe/recover', {intentId});
}
