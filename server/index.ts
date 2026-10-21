import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual, randomUUID } from 'crypto'; // H-1: constant-time comparison
import { RazorpayService } from './services/RazorpayService';
import { StripeService } from './services/StripeService';
import { PayPalService } from './services/PayPalService';
import type { PaymentGateway } from './services/PaymentService';
import { userAuthentication, applicationAuthentication } from './security';
import { verifyGameCoupon, CouponError } from './couponVerification';
import { findPayment, settlePayment } from './paymentSettlement';
import { recoverStripePayment } from './stripeRecovery';
import { couponGateways, quoteCoupon } from './couponCheckout';
import { countryService } from './services/CountryService';
import { exchangeRateService } from './services/ExchangeRateService';

dotenv.config();

// ── Startup validation ───────────────────────────────────────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

// M-5 FIX: Enforce minimum entropy on the API key.
// A short or guessable key passes the presence check above but is still
// trivially brute-forced — reject at startup before any traffic arrives.
if (process.env.API_KEY!.length < 32) {
  console.error('FATAL: API_KEY must be at least 32 characters of high-entropy random data.');
  process.exit(1);
}

const SUPABASE_URL        = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── App setup ────────────────────────────────────────────────────────────────
const app = express();

// HIGH-05 / HIGH-08: Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"],
    },
  },
}) as express.RequestHandler);

// CRIT-06: Strict CORS allowlist — no wildcard in production
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS ?? '').split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// HIGH-05: Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

// Tighter limit for sensitive write operations
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

app.use(globalLimiter);

// Raw body parser for Stripe webhook signature verification (must come BEFORE json())
app.use(['/api/v1/payments/webhook/stripe', '/api/v1/payments/webhook/razorpay', '/api/v1/payments/webhook/paypal'], express.raw({ type: 'application/json', limit: '64kb' }));

app.use(express.json({ limit: '64kb' }));

// ── Authentication middleware ─────────────────────────────────────────────────
// HIGH-09: API key must be a strong random value (see .env.example)
// H-1 FIX: Use constant-time comparison to prevent timing side-channel attacks.
// JavaScript's !== short-circuits on the first differing byte, leaking how many
// leading characters a guessed key has in common with the real key.
const authenticateAPIKey = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const apiKey = req.headers['x-api-key'];
  const expected = process.env.API_KEY!;

  // Reject immediately if key is absent or has wrong type (avoids Buffer issues)
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const keyBuf = Buffer.from(apiKey);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual requires equal-length buffers — length mismatch is itself
  // a safe early rejection (no timing information leaks from the length check
  // because we always compare the full expected-length buffer).
  const valid =
    keyBuf.length === expectedBuf.length &&
    timingSafeEqual(keyBuf, expectedBuf);

  if (!valid) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
};

// authenticateAPIKey is applied per-route (not globally) so that the JWT-auth
// payment endpoints are not blocked by the server-to-server API key check.

const authenticateUserJWT = userAuthentication(supabase);
const authenticateApplication = applicationAuthentication();

// ── Payment gateway singletons (lazy-initialised) ────────────────────────────
// Each service is only constructed when its env vars are present, so the server
// starts cleanly even if only some gateways are configured.
let razorpayService: RazorpayService | null = null;
let stripeService: StripeService | null = null;
let paypalService: PayPalService | null = null;

function getGatewayService(gateway: PaymentGateway) {
  if (gateway === 'razorpay') {
    if (!razorpayService) razorpayService = new RazorpayService();
    return razorpayService;
  }
  if (gateway === 'stripe') {
    if (!stripeService) stripeService = new StripeService();
    return stripeService;
  }
  if (gateway === 'paypal') {
    if (!paypalService) paypalService = new PayPalService();
    return paypalService;
  }
  throw new Error(`Unknown payment gateway: ${gateway}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isSafePositiveNumber(val: unknown, max = 1_000_000): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= max;
}

function normalizeCountryCode(country: unknown): string | null {
  if (!country || typeof country !== 'string') return null;
  const cleaned = country.trim().toUpperCase();
  if (cleaned.length === 0) return null;
  if (cleaned === 'US' || cleaned === 'IN' || cleaned === 'AU' || cleaned === 'GB' || cleaned === 'AE') return cleaned;
  
  const map: Record<string, string> = {
    'UNITED STATES': 'US',
    'UNITED STATES OF AMERICA': 'US',
    'USA': 'US',
    'INDIA': 'IN',
    'IND': 'IN',
    'AUSTRALIA': 'AU',
    'AUS': 'AU',
    'UNITED KINGDOM': 'GB',
    'GREAT BRITAIN': 'GB',
    'UK': 'GB',
    'UNITED ARAB EMIRATES': 'AE',
    'UAE': 'AE',
    'ARE': 'AE',
    'CANADA': 'CA',
    'CAN': 'CA',
    'GERMANY': 'DE',
    'DEU': 'DE',
    'FRANCE': 'FR',
    'FRA': 'FR',
  };
  return map[cleaned] || cleaned.substring(0, 2);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/v1/coupons/verify
app.post('/api/v1/coupons/verify', writeLimiter, authenticateApplication, async (req, res) => {
  try {
    const { couponCode, userCountry } = req.body;

    if (!isNonEmptyString(couponCode)) {
      return res.status(400).json({ success: false, code: 'INVALID_COUPON', message: 'couponCode is required.' });
    }

    const callingApp = (res.locals.callingApp as 'gaming' | 'lottery') || 'gaming';
    const quote = await verifyGameCoupon(supabase, couponCode, normalizeCountryCode(userCountry), callingApp);
    return res.json(quote);

  } catch (err) {
    if (err instanceof CouponError) return res.status(err.status).json({ success:false, code:err.code, message:err.message });
    console.error('[/coupons/verify]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/v1/coupons/redeem
// HIGH-05: Validate ALL required fields; amount bounded
app.post('/api/v1/coupons/redeem', writeLimiter, authenticateApplication, async (req, res) => {
  try {
    const { couponId, userId, gameId, walletTransactionId, ipAddress, device, userCountry } = req.body;

    if (
      !isNonEmptyString(couponId) ||
      !isNonEmptyString(userId) ||
      !isNonEmptyString(walletTransactionId)
    ) {
      return res.status(400).json({ success: false, message: 'Missing or invalid required parameters.' });
    }

    // callingApp is strictly resolved from verified application credentials in res.locals
    const callingApp = (res.locals.callingApp as 'gaming' | 'lottery') || 'gaming';

    const { data: couponRecord } = await supabase
      .from('coupons')
      .select('id, country_code, issued_to, redemption_destination')
      .eq('id', couponId)
      .maybeSingle();

    if (!couponRecord) {
      return res.status(404).json({ success: false, code: 'INVALID_COUPON', message: 'Coupon not found.' });
    }

    // Fail closed: unclassified coupons cannot be redeemed externally
    if (couponRecord.redemption_destination === null) {
      return res.status(400).json({
        success: false,
        code: 'UNCLASSIFIED_DESTINATION',
        message: 'Coupon has no redemption destination assigned. Contact support.'
      });
    }

    // Enforce destination restriction
    if (couponRecord.redemption_destination !== undefined && couponRecord.redemption_destination !== callingApp) {
      return res.status(400).json({
        success: false,
        code: 'DESTINATION_MISMATCH',
        message: `Coupon destination mismatch: this coupon is for '${couponRecord.redemption_destination}' and cannot be redeemed in '${callingApp}'.`
      });
    }

    let couponCountryRaw = couponRecord?.country_code;
    if (!couponCountryRaw && couponRecord?.issued_to) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('country_code, country')
        .eq('id', couponRecord.issued_to)
        .maybeSingle();
      if (profile) {
        couponCountryRaw = profile.country_code || profile.country;
      }
    }

    const normCouponCountry = normalizeCountryCode(couponCountryRaw);
    const normUserCountry = normalizeCountryCode(userCountry);

    if (normCouponCountry) {
      if (!normUserCountry || normCouponCountry !== normUserCountry) {
        return res.status(400).json({
          success: false,
          code: 'COUNTRY_MISMATCH',
          message: `Country mismatch: This coupon was issued for ${normCouponCountry} and cannot be redeemed by an account in ${normUserCountry || 'a different country'}`
        });
      }
    }

    let rpcError = null;
    const { error: appError } = await supabase.rpc('redeem_application_coupon', {
      p_coupon_id:           couponId,
      p_calling_app:         callingApp,
      p_app_user_id:        userId,
      p_app_transaction_id: walletTransactionId,
      p_ip_address:          isNonEmptyString(ipAddress) ? ipAddress : '0.0.0.0',
      p_device:              isNonEmptyString(device)    ? device    : 'unknown',
      p_user_country:        normUserCountry,
    });

    if (appError) {
      if (appError.message?.includes('redeem_application_coupon') || appError.code === '42883') {
        const { error: legacyError } = await supabase.rpc('redeem_game_coupon', {
          p_coupon_id:           couponId,
          p_game_user_id:        userId,
          p_game_id:             gameId || callingApp,
          p_wallet_transaction_id: walletTransactionId,
          p_ip_address:          isNonEmptyString(ipAddress) ? ipAddress : '0.0.0.0',
          p_device:              isNonEmptyString(device)    ? device    : 'unknown',
          p_user_country:        normUserCountry,
        });
        rpcError = legacyError;
      } else {
        rpcError = appError;
      }
    }

    if (rpcError) {
      console.error('[/coupons/redeem]', rpcError);
      const isCountryMismatch = rpcError.message.includes('Country mismatch');
      const isDestMismatch = rpcError.message.includes('destination mismatch') || rpcError.message.includes('no redemption destination');
      return res.status(400).json({
        success: false,
        code: isCountryMismatch ? 'COUNTRY_MISMATCH' : isDestMismatch ? 'DESTINATION_MISMATCH' : 'REDEEM_FAILED',
        message: rpcError.message
      });
    }

    return res.json({ success: true });

  } catch (err) {
    console.error('[/coupons/redeem]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/v1/campaigns
app.get('/api/v1/campaigns', authenticateAPIKey, async (_req, res) => {
  const { data, error } = await supabase.from('campaigns').select('*').eq('is_active', true);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.json({ success: true, data });
});

// POST /api/v1/wallet/transfer
// MED-04: Amount is validated and capped; HIGH-05 applied
app.post('/api/v1/wallet/transfer', writeLimiter, authenticateAPIKey, async (req, res) => {
  try {
    const { userEmail, amount, transactionId } = req.body;

    if (!isNonEmptyString(userEmail) || !isNonEmptyString(transactionId)) {
      return res.status(400).json({ success: false, message: 'Missing required parameters.' });
    }

    // MED-01 / HIGH-05: cap maximum single transfer at ₹1,00,000
    if (!isSafePositiveNumber(amount, 100_000)) {
      return res.status(400).json({ success: false, message: 'Invalid or out-of-range transfer amount.' });
    }

    // H-2/H-3 FIX: Normalize email before any lookup or RPC call.
    // Without normalization, "User@Example.com" and "user@example.com" are
    // treated as distinct — a trailing-space or different-case variant can
    // cause the transfer to silently fail or credit the wrong account.
    const normalizedEmail = userEmail.toLowerCase().trim();

    // Basic email format sanity check (after normalization)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Invalid email address.' });
    }

    const { data, error } = await supabase.rpc('transfer_winnings_to_wallet', {
      p_user_email:     normalizedEmail,
      p_amount:         amount,
      p_transaction_id: transactionId,
    });

    if (error) {
      console.error('[/wallet/transfer]', error);
      if (error.code === '23505' || error.message.includes('unique constraint')) {
        return res.status(409).json({ success: false, code: 'DUPLICATE_TRANSACTION', message: 'Transaction already processed.' });
      }
      return res.status(400).json({ success: false, code: 'TRANSFER_FAILED', message: error.message });
    }

    // Record deposit for auditing
    try {
      const { data: userProfile } = await supabase
        .from('profiles').select('id').eq('email', normalizedEmail).maybeSingle();
      if (userProfile?.id) {
        await supabase.from('deposits').insert({
          user_id:        userProfile.id,
          amount,
          payment_method: 'Winning Transfer',
          reference_id:   transactionId,
          status:         'completed',
          created_at:     new Date().toISOString(),
        });
      }
    } catch (depErr) {
      console.warn('[/wallet/transfer] Could not record deposit row:', depErr);
    }

    return res.json({ success: true, message: 'Transfer successful', data });

  } catch (err) {
    console.error('[/wallet/transfer]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/v1/wallet/deposit
// Secure server-to-server endpoint to credit user wallet via add_funds_secure (service_role)
app.post('/api/v1/wallet/deposit', (_req, res) => {
  res.status(410).json({ success: false, message: 'Use authenticated payment verification to fund a wallet.' });
});

// GET /api/v1/coupons/:id
app.get('/api/v1/coupons/:id', authenticateAPIKey, async (req, res) => {
  const { id } = req.params;

  if (!isNonEmptyString(id) || id.length > 100) {
    return res.status(400).json({ success: false, message: 'Invalid coupon ID.' });
  }

  const { data: coupon, error } = await supabase
    .from('coupons')
    .select('*, campaigns(*)')
    .eq('id', id)
    .single();

  if (error || !coupon) {
    return res.status(404).json({ success: false, message: 'Coupon not found' });
  }

  return res.json({ success: true, data: coupon });
});

// ── Country & Exchange Rate routes (public/API-key protected) ───────────────

/**
 * GET /api/v1/countries
 * Returns the full list of supported countries with currency and gateway info.
 * Public — no auth required.
 */
app.get('/api/v1/countries', (_req, res) => {
  try {
    const countries = countryService.getAll();
    return res.json({ success: true, countries });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/exchange-rates
 * Returns cached exchange rates (USD as base). Requires API key.
 */
app.get('/api/v1/exchange-rates', authenticateAPIKey, async (_req, res) => {
  try {
    const info = exchangeRateService.getCacheInfo();
    if (!info.rates) {
      // Trigger first fetch if cache is empty
      const rates = await exchangeRateService.getRatesFromUSD();
      return res.json({ success: true, baseCurrency: 'USD', rates, source: 'fresh' });
    }
    return res.json({
      success:      true,
      baseCurrency: 'USD',
      rates:        info.rates,
      fetchedAt:    info.fetchedAt,
      ageSeconds:   info.ageSeconds,
      source:       'cache',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/exchange-rates/refresh
 * Forces a cache refresh from Frankfurter. Requires API key.
 */
app.post('/api/v1/exchange-rates/refresh', authenticateAPIKey, async (_req, res) => {
  try {
    const rates = await exchangeRateService.forceRefresh();
    return res.json({ success: true, baseCurrency: 'USD', rates, refreshedAt: new Date() });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/v1/payments/gateways?country_code=IN
 * Returns ordered gateway list for a given country.
 * Public — no auth required.
 */
app.get('/api/v1/payments/gateways', (req, res) => {
  try {
    const countryCode = (req.query.country_code as string ?? 'US').toUpperCase();
    const country = countryService.getByCode(countryCode);
    return res.json({
      success:  true,
      countryCode,
      country:  country.name,
      currency: country.currency,
      gateways: country.gatewayPriority,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ── Payment routes (authenticated by Supabase JWT, NOT the server API key) ───
// These routes are placed BEFORE the server-to-server routes so that the
// global authenticateAPIKey middleware does NOT apply to them.
// Each route verifies the caller via Supabase JWT in authenticateUserJWT.

/**
 * POST /api/v1/payments/create
 * Body: { gateway: 'razorpay'|'stripe'|'paypal', amount: number, currency?: string }
 * Authorization: Bearer <supabase_access_token>
 */
app.post('/api/v1/payments/stripe/recover', writeLimiter, authenticateUserJWT, async (req, res) => {
  try {
    const { intentId } = req.body;
    if (typeof intentId !== 'string' || !/^pi_[a-zA-Z0-9]+$/.test(intentId)) return res.status(400).json({message:'Invalid payment identity.'});
    if (!stripeService) stripeService = new StripeService();
    return res.json(await recoverStripePayment(supabase, stripeService, res.locals.userId, intentId));
  } catch (error) {
    return res.status(400).json({message:error instanceof Error ? error.message : 'Payment recovery unavailable.'});
  }
});

// Direct checkout is enabled for configured providers matching account currency.
app.post('/api/v1/payments/coupon/options', authenticateUserJWT, async (_req, res) => {
 const { data, error } = await supabase.from('profiles').select('currency').eq('id', res.locals.userId).single();
 if (error || !data?.currency) return res.status(400).json({message:'Account country is required.'});
 const currency = data.currency;
 return res.json({
   gateways: couponGateways(currency),
   config: {
     razorpay: {
       keyId: process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || '',
     },
     stripe: {
       publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
     },
     paypal: {
       clientId: process.env.PAYPAL_CLIENT_ID || process.env.VITE_PAYPAL_CLIENT_ID || '',
     },
   },
 });
});

app.post('/api/v1/payments/coupon/abandon', writeLimiter, authenticateUserJWT, async (req,res) => {
 try {
  const {gateway,orderId}=req.body;
  if (!['stripe','razorpay','paypal'].includes(gateway) || !isNonEmptyString(orderId)) return res.status(400).json({message:'Invalid checkout reference.'});
  const stored=await findPayment(supabase,gateway,orderId,res.locals.userId);
  const {data,error}=await supabase.rpc('abandon_coupon_checkout',{p_transaction_id:stored.id,p_user_id:res.locals.userId});
  if (error || !data) throw new Error('Could not cancel checkout. Verify the saved payment before trying again.');
  return res.json(data);
 } catch(error) {return res.status(400).json({message:error instanceof Error?error.message:'Checkout unavailable.'});}
});

app.post('/api/v1/payments/coupon/recover', writeLimiter, authenticateUserJWT, async (req, res) => {
 try {
  const { gateway, orderId } = req.body;
  if (!['stripe','razorpay','paypal'].includes(gateway) || !isNonEmptyString(orderId)) return res.status(400).json({message:'Invalid checkout reference.'});
  const stored = await findPayment(supabase,gateway,orderId,res.locals.userId);
  if (!stored.gift_card_id) return res.status(400).json({message:'This payment is not a coupon checkout.'});
  if (stored.status === 'paid' && stored.checkout_result) return res.json({state:'paid',...stored.checkout_result});
  if (gateway === 'stripe') {
   if (!stripeService) stripeService=new StripeService();
   return res.json(await recoverStripePayment(supabase,stripeService,res.locals.userId,orderId));
  }
  if (gateway === 'paypal') {
   if (!paypalService) paypalService = new PayPalService();
   try {
     const payment = await paypalService.verifyPayment({ gateway: 'paypal', gatewayOrderId: orderId, gatewayPaymentId: orderId });
     if (payment.verified) {
       return res.json({ state: 'paid', ...await settlePayment(supabase, 'paypal', orderId, res.locals.userId, payment) });
     }
   } catch {
     // unconfirmed / pending
   }
   return res.json({ state: 'resume', orderId, amount: Number(stored.amount_major) * 100, currency: stored.currency });
  }
  if (!razorpayService) razorpayService=new RazorpayService();
  const payment = await razorpayService.findCapturedOrderPayment(orderId);
  if (!payment) return res.json({state:'resume',orderId,amount:Number(stored.amount_major)*100,currency:stored.currency,keyId:process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID});
  return res.json({state:'paid',...await settlePayment(supabase,'razorpay',orderId,res.locals.userId,payment)});
 } catch (error) { return res.status(400).json({message:error instanceof Error?error.message:'Payment verification is pending. Retry the same order.'}); }
});

app.post('/api/v1/payments/create', writeLimiter, authenticateUserJWT, async (req, res) => {
  try {
    const { gateway, giftCardId, expectedPrice } = req.body;
    let { amount, currency } = req.body;
    let couponQuote: Awaited<ReturnType<typeof quoteCoupon>> | null = null;
    if (giftCardId !== undefined) {
      couponQuote = await quoteCoupon(supabase,res.locals.userId,giftCardId,expectedPrice);
      if (!couponGateways(couponQuote.currency).includes(gateway)) return res.status(400).json({message:'Direct payment is currently unavailable for this payment method. Please use your wallet.'});
      amount=couponQuote.amount; currency=couponQuote.currency;
    }
    const userId = res.locals.userId as string; // from verified JWT

    const validGateways: PaymentGateway[] = ['razorpay', 'stripe', 'paypal'];
    if (!validGateways.includes(gateway)) {
      return res.status(400).json({ success: false, message: `Invalid gateway. Must be one of: ${validGateways.join(', ')}.` });
    }
    if (!isSafePositiveNumber(amount, 100_000)) {
      return res.status(400).json({ success: false, message: 'Invalid amount.' });
    }

    const receiptId = `cv_${userId.slice(0, 8)}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const currencyInput = currency ?? (gateway === 'razorpay' ? 'INR' : 'USD');
    if (typeof currencyInput !== 'string') return res.status(400).json({ success: false, message: 'Invalid currency.' });
    const effectiveCurrency = currencyInput.toUpperCase();
    if (amount !== Math.round(amount * 100) / 100) return res.status(400).json({ success: false, message: 'Use at most two decimal places.' });

    if (typeof effectiveCurrency !== 'string' || !/^[A-Z]{3}$/.test(effectiveCurrency)) {
      return res.status(400).json({ success: false, message: 'Invalid currency.' });
    }
    const { data: profile, error: profileError } = await supabase.from('profiles').select('country_code,currency').eq('id', userId).single();
    if (profileError || !profile?.country_code || profile.currency !== effectiveCurrency) {
      return res.status(400).json({ success: false, message: 'Payment currency must match your account country.' });
    }

    const service = getGatewayService(gateway);
    const result = await service.createPayment(amount, effectiveCurrency, receiptId);

    const { error: orderError } = await supabase.from('payment_transactions').insert({
      user_id: userId, gateway, gateway_order_id: result.gatewayOrderId,
      ...(couponQuote ? {gift_card_id:couponQuote.giftCardId,offer_snapshot:couponQuote.snapshot} : {}),
      amount_major: amount, currency: effectiveCurrency, status: 'pending',
      idempotency_key: receiptId, exchange_rate: null, amount_usd: effectiveCurrency === 'USD' ? amount : null, amount_local: amount, wallet_amount: amount,
    });
    if (orderError) throw new Error('Could not save the payment order. No payment has been charged.');

    return res.json({
      success: true,
      gateway,
      orderId: result.gatewayOrderId,
      clientSecret: result.clientSecret,
      amount: result.amountMinorUnit,
      currency: result.currency,
      receiptId,
      walletAmount: amount,
      ...(couponQuote ? {giftCardId:couponQuote.giftCardId,keyId:gateway === 'razorpay' ? (process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID) : undefined} : {}),
    });
  } catch (err: any) {
    console.error('[/payments/create]', err);
    return res.status(500).json({ success: false, message: err.message ?? 'Failed to create payment.' });
  }
});

/**
 * POST /api/v1/payments/verify
 * Body: { gateway, gatewayOrderId, gatewayPaymentId, signature? }
 * Authorization: Bearer <supabase_access_token>
 * Verifies the payment server-side, then credits the wallet.
 */
app.post('/api/v1/payments/verify', writeLimiter, authenticateUserJWT, async (req, res) => {
  try {
    const { gateway, gatewayOrderId, gatewayPaymentId, signature } = req.body;
    const userId = res.locals.userId as string; // from verified JWT — cannot be spoofed

    if (!isNonEmptyString(gateway) || !isNonEmptyString(gatewayOrderId)) {
      return res.status(400).json({ success: false, message: 'gateway and gatewayOrderId are required.' });
    }

    await findPayment(supabase, gateway as PaymentGateway, gatewayOrderId, userId);

    const service = getGatewayService(gateway as PaymentGateway);
    const verifyResult = await service.verifyPayment({
      gateway: gateway as PaymentGateway,
      gatewayOrderId,
      gatewayPaymentId: gatewayPaymentId ?? gatewayOrderId,
      signature,
    });

    if (!verifyResult.verified) {
      return res.status(400).json({ success: false, message: 'Payment verification failed.' });
    }

    const settlement = await settlePayment(supabase, gateway as PaymentGateway, gatewayOrderId, userId, verifyResult);

    return res.json({
      success: true,
      verified: true,
      gateway,
      ...settlement,
    });
  } catch (err: any) {
    console.error('[/payments/verify]', err);
    return res.status(400).json({ success: false, message: err.message ?? 'Verification failed.' });
  }
});

/**
 * GET /api/v1/payments/:id/status
 * Returns the current status of a payment order.
 */
app.get('/api/v1/payments/:id/status', authenticateUserJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const gateway = req.query.gateway as PaymentGateway;

    if (!isNonEmptyString(id) || !isNonEmptyString(gateway)) {
      return res.status(400).json({ success: false, message: 'id and gateway query param are required.' });
    }

    const service = getGatewayService(gateway);
    await findPayment(supabase, gateway, id, res.locals.userId);
    const status = await service.getPaymentStatus(id);
    return res.json({ success: true, status });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/payments/webhook/stripe
 * Stripe sends raw JSON body — verified by signature header.
 * Requires express.raw() middleware (registered above JSON parser).
 */
app.post('/api/v1/payments/webhook/stripe', async (req, res) => {
  try {
    if (!stripeService) stripeService = new StripeService();
    const sig = req.headers['stripe-signature'] as string;
    const event = stripeService.verifyWebhookSignature(req.body as Buffer, sig);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as any;
      const stored = await findPayment(supabase, 'stripe', intent.id);
      const payment = await stripeService.verifyPayment({ gateway: 'stripe', gatewayOrderId: intent.id, gatewayPaymentId: intent.id });
      await settlePayment(supabase, 'stripe', intent.id, stored.user_id, payment);
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error('[/webhook/stripe]', err.message);
    return res.status(400).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/v1/payments/webhook/razorpay
 * Razorpay sends JSON — verified by X-Razorpay-Signature header.
 */
app.post('/api/v1/payments/webhook/razorpay', async (req, res) => {
  try {
    const { createHmac } = await import('crypto');
    const body = req.body as Buffer;
    const sig  = req.headers['x-razorpay-signature'] as string;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Error('Razorpay webhook is not configured.');
    const expectedSig = createHmac('sha256', secret).update(body).digest('hex');

    if (typeof sig !== 'string' || sig.length !== expectedSig.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay signature.' });
    }

    const event = JSON.parse(body.toString('utf8'));
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (!payment || payment.status !== 'captured') throw new Error('Invalid captured payment.');
      const stored = await findPayment(supabase, 'razorpay', payment.order_id);
      await settlePayment(supabase, 'razorpay', payment.order_id, stored.user_id, {
        verified: true, amount: Number(payment.amount) / 100, currency: payment.currency, gatewayPaymentId: payment.id,
      });
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error('[/webhook/razorpay]', err);
    return res.status(500).json({ success: false, message: 'Webhook processing error.' });
  }
});

/**
 * POST /api/v1/payments/webhook/paypal
 * PayPal webhook — verified via PayPal Notifications API.
 */
app.post('/api/v1/payments/webhook/paypal', async (req, res) => {
  try {
    if (!paypalService) paypalService = new PayPalService();
    const rawBody = (req.body as Buffer).toString('utf8');
    const headers: Record<string, string | undefined> = {
      'paypal-auth-algo':        req.headers['paypal-auth-algo'] as string,
      'paypal-cert-url':         req.headers['paypal-cert-url'] as string,
      'paypal-transmission-id':  req.headers['paypal-transmission-id'] as string,
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'] as string,
      'paypal-transmission-time':req.headers['paypal-transmission-time'] as string,
    };

    const isValid = await paypalService.verifyWebhookSignature(headers, rawBody);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid PayPal webhook signature.' });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event_type;
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const orderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (!orderId) throw new Error('Missing PayPal order reference.');
      const stored = await findPayment(supabase, 'paypal', orderId);
      const payment = await paypalService.verifyPayment({ gateway: 'paypal', gatewayOrderId: orderId, gatewayPaymentId: event.resource.id });
      await settlePayment(supabase, 'paypal', orderId, stored.user_id, payment);
    }

    return res.json({ received: true });
  } catch (err: any) {
    console.error('[/webhook/paypal]', err);
    return res.status(500).json({ success: false, message: 'Webhook processing error.' });
  }
});

// LOW-03: Global error handler — sanitise in production
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled error]', err);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const refreshRates = () => { void exchangeRateService.forceRefresh().catch(() => console.warn('Current exchange rates unavailable; currency conversion will fail closed.')); };
refreshRates();
setInterval(refreshRates, 60 * 60 * 1000).unref();
const PORT = parseInt(process.env.PORT ?? '4000', 10);
app.listen(PORT, () => {
  console.log(`Coupon API Server running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});
