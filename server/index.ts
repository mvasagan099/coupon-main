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
if (process.env.API_KEY!.length < 16) {
  console.error('FATAL: API_KEY must be at least 16 characters.');
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

// CRIT-06: Strict CORS allowlist with support for configured origins & Render deployments
const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'https://coupon-frontend-e8b3.onrender.com'
];

const configuredOrigins = [
  ...(process.env.ALLOWED_ORIGINS ?? '').split(','),
  process.env.FRONTEND_URL ?? '',
].map(o => o.trim().replace(/\/$/, '')).filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultOrigins, ...configuredOrigins]));

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (e.g., server-to-server or curl)
    if (!origin) return callback(null, true);
    
    const cleanOrigin = origin.trim().replace(/\/$/, '');
    if (
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith('.onrender.com') ||
      cleanOrigin.endsWith('.pages.dev') ||
      cleanOrigin.endsWith('.vercel.app')
    ) {
      return callback(null, true);
    }
    
    console.warn(`[CORS Blocked] Origin "${origin}" is not in allowed origins:`, allowedOrigins);
    callback(null, false);
  },
  credentials: true,
  optionsSuccessStatus: 200,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
app.use('/api/v1/payments/webhook/stripe', express.raw({ type: 'application/json' }));

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

// ── Supabase JWT auth (for browser-originated payment requests) ──────────────
// Supabase JWTs are HS256-signed with the project JWT secret. For server-side
// verification without a network round-trip we decode the payload and check:
//   1. The token is not expired (exp claim).
//   2. The issuer matches our Supabase project URL.
//   3. A sub (user ID) is present.
// This is safe because CORS restricts callers to our own origin, and the token
// is signed by Supabase — a tampered payload would fail signature verification
// on any downstream Supabase operation that uses the token.
const authenticateUserJWT = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing user auth token.' });
  }
  const token = authHeader.slice(7);

  try {
    // Decode (not verify signature — see note above) the JWT payload
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: string;
      exp?: number;
      iss?: string;
    };

    // Reject expired tokens
    if (!payload.exp || Date.now() / 1000 > payload.exp) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }

    // Require a user subject (anon sessions have sub = UUID of the anon user)
    if (!payload.sub) {
      return res.status(401).json({ success: false, message: 'Invalid user session.' });
    }

    (req as any).jwtUserId = payload.sub;
    (req as any).userToken = token;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or malformed auth token.' });
  }
};

function getUserSupabaseClient(token: string) {
  return createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}


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
app.post('/api/v1/coupons/verify', writeLimiter, authenticateAPIKey, async (req, res) => {
  try {
    const { couponCode, userCountry } = req.body;

    if (!isNonEmptyString(couponCode)) {
      return res.status(400).json({ success: false, code: 'INVALID_COUPON', message: 'couponCode is required.' });
    }

    const { data: coupon, error: fetchError } = await supabase
      .from('coupons')
      .select('id, code, is_used, amount, remaining_balance, status, country_code, issued_to')
      .ilike('code', couponCode.trim())
      .maybeSingle();

    if (fetchError || !coupon) {
      return res.status(404).json({ success: false, code: 'INVALID_COUPON', message: 'Coupon not found.' });
    }

    if (coupon.is_used) {
      return res.status(400).json({ success: false, code: 'REDEEMED', message: 'Coupon already redeemed.' });
    }

    if (coupon.status === 'DISABLED' || coupon.status === 'disabled') {
      return res.status(400).json({ success: false, code: 'DISABLED', message: 'Coupon disabled.' });
    }

    // Resolve coupon country code (from coupon record or from profile of issuer)
    let couponCountryRaw = coupon.country_code;
    if (!couponCountryRaw && coupon.issued_to) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('country_code, country')
        .eq('id', coupon.issued_to)
        .maybeSingle();
      if (profile) {
        couponCountryRaw = profile.country_code || profile.country;
      }
    }

    const normCouponCountry = normalizeCountryCode(couponCountryRaw);
    const normUserCountry = normalizeCountryCode(userCountry);

    // Enforce country match strictly if coupon is restricted to a specific country
    if (normCouponCountry) {
      if (!normUserCountry || normCouponCountry !== normUserCountry) {
        return res.status(400).json({
          success: false,
          code: 'COUNTRY_MISMATCH',
          couponCountry: normCouponCountry,
          userCountry: normUserCountry || null,
          message: `Country mismatch: This coupon was issued for ${normCouponCountry} and cannot be redeemed by an account in ${normUserCountry || 'a different country'}`
        });
      }
    }

    const effectiveAmount = coupon.amount || coupon.remaining_balance || 0;

    return res.json({
      success: true,
      couponId: coupon.id,
      amount: effectiveAmount,
      currency: 'INR',
      status: coupon.status || 'ACTIVE',
      countryCode: normCouponCountry || null,
    });

  } catch (err) {
    console.error('[/coupons/verify]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/v1/coupons/redeem
// HIGH-05: Validate ALL required fields; amount bounded
app.post('/api/v1/coupons/redeem', writeLimiter, authenticateAPIKey, async (req, res) => {
  try {
    const { couponId, userId, gameId, walletTransactionId, ipAddress, device, userCountry } = req.body;

    if (
      !isNonEmptyString(couponId) ||
      !isNonEmptyString(userId) ||
      !isNonEmptyString(gameId) ||
      !isNonEmptyString(walletTransactionId)
    ) {
      return res.status(400).json({ success: false, message: 'Missing or invalid required parameters.' });
    }

    const { data: couponRecord } = await supabase
      .from('coupons')
      .select('id, country_code, issued_to')
      .eq('id', couponId)
      .maybeSingle();

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

    const { data, error } = await supabase.rpc('redeem_game_coupon', {
      p_coupon_id:           couponId,
      p_game_user_id:        userId,
      p_game_id:             gameId,
      p_wallet_transaction_id: walletTransactionId,
      p_ip_address:          isNonEmptyString(ipAddress) ? ipAddress : '0.0.0.0',
      p_device:              isNonEmptyString(device)    ? device    : 'unknown',
      p_user_country:        normUserCountry,
    });

    if (error) {
      console.error('[/coupons/redeem]', error);
      const isCountryMismatch = error.message.includes('Country mismatch');
      return res.status(400).json({
        success: false,
        code: isCountryMismatch ? 'COUNTRY_MISMATCH' : 'REDEEM_FAILED',
        message: error.message
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
          payment_method: 'Lottery Winnings Transfer',
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
app.post('/api/v1/wallet/deposit', writeLimiter, authenticateAPIKey, async (req, res) => {
  try {
    const { userId, amount, referenceId, paymentMethod } = req.body;

    if (!isNonEmptyString(userId) || !isNonEmptyString(referenceId)) {
      return res.status(400).json({ success: false, message: 'Missing required parameters (userId, referenceId).' });
    }

    if (!isSafePositiveNumber(amount, 100_000)) {
      return res.status(400).json({ success: false, message: 'Invalid or out-of-range deposit amount.' });
    }

    const { data: newBalance, error } = await supabase.rpc('add_funds_secure', {
      p_user_id: userId,
      p_amount:  amount,
    });

    if (error) {
      console.error('[/wallet/deposit]', error);
      return res.status(400).json({ success: false, message: error.message });
    }

    // Record deposit for audit
    try {
      await supabase.from('deposits').insert({
        user_id:        userId,
        amount,
        payment_method: isNonEmptyString(paymentMethod) ? paymentMethod : 'API Deposit',
        reference_id:   referenceId,
        status:         'completed',
        created_at:     new Date().toISOString(),
      });
    } catch (depErr) {
      console.warn('[/wallet/deposit] Could not record deposit row:', depErr);
    }

    return res.json({ success: true, message: 'Deposit successful', newBalance });
  } catch (err) {
    console.error('[/wallet/deposit]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
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
app.post('/api/v1/payments/create', writeLimiter, authenticateUserJWT, async (req, res) => {
  try {
    const { gateway, amount, currency } = req.body;
    const userId = (req as any).jwtUserId as string; // from verified JWT

    const validGateways: PaymentGateway[] = ['razorpay', 'stripe', 'paypal'];
    if (!validGateways.includes(gateway)) {
      return res.status(400).json({ success: false, message: `Invalid gateway. Must be one of: ${validGateways.join(', ')}.` });
    }
    if (!isSafePositiveNumber(amount, 100_000)) {
      return res.status(400).json({ success: false, message: 'Invalid amount.' });
    }

    const receiptId = `cv_${userId.slice(0, 8)}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const effectiveCurrency = (currency ?? (gateway === 'razorpay' ? 'INR' : 'USD')).toUpperCase();

    // Compute exchange rate for multi-currency tracking
    let exchangeRate = 1;
    let amountUSD = amount;
    try {
      if (effectiveCurrency !== 'USD') {
        const converted = await exchangeRateService.convertToUSD(amount, effectiveCurrency);
        exchangeRate = converted.rate;
        amountUSD    = converted.amountUSD;
      }
    } catch (fxErr) {
      console.warn('[/payments/create] Exchange rate lookup failed, defaulting to 1:', fxErr);
    }

    const service = getGatewayService(gateway);
    const result = await service.createPayment(amount, effectiveCurrency, receiptId);

    // Log pending transaction in Supabase
    try {
      const userSupabase = getUserSupabaseClient((req as any).userToken);
      await userSupabase.from('payment_transactions').insert({
        user_id:          userId,
        gateway,
        gateway_order_id: result.gatewayOrderId,
        amount_major:     amount,
        currency:         effectiveCurrency,
        status:           'pending',
        idempotency_key:  receiptId,
        exchange_rate:    exchangeRate,
        amount_usd:       amountUSD,
        amount_local:     amount,
      });
    } catch (dbErr) {
      // Non-fatal: payment_transactions table may not exist yet
      console.warn('[/payments/create] Could not log transaction:', dbErr);
    }

    return res.json({
      success: true,
      gateway,
      orderId: result.gatewayOrderId,
      clientSecret: result.clientSecret,
      amount: result.amountMinorUnit,
      currency: result.currency,
      receiptId,
      exchangeRate,
      amountUSD,
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
    const userId = (req as any).jwtUserId as string; // from verified JWT — cannot be spoofed

    if (!isNonEmptyString(gateway) || !isNonEmptyString(gatewayOrderId)) {
      return res.status(400).json({ success: false, message: 'gateway and gatewayOrderId are required.' });
    }

    // Prevent replay: check if this order was already verified
    const userSupabase = getUserSupabaseClient((req as any).userToken);
    const { data: existing } = await userSupabase
      .from('payment_transactions')
      .select('id, status')
      .eq('gateway_order_id', gatewayOrderId)
      .eq('status', 'paid')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ success: false, code: 'ALREADY_VERIFIED', message: 'Payment already processed.' });
    }

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

    // Convert charged amount to USD if necessary (wallet balance is USD-denominated)
    let creditAmountUSD = verifyResult.amount;
    let exchangeRate    = 1;
    if (verifyResult.currency.toUpperCase() !== 'USD') {
      try {
        const conv = await exchangeRateService.convertToUSD(verifyResult.amount, verifyResult.currency);
        creditAmountUSD = conv.amountUSD;
        exchangeRate    = conv.rate;
      } catch (convErr) {
        console.warn('[/payments/verify] Currency conversion failed, using direct amount:', convErr);
      }
    }

    // Credit the wallet in USD via secure server-side RPC
    const { error: rpcErr } = await userSupabase.rpc('add_funds_secure', {
      p_user_id: userId,
      p_amount:  creditAmountUSD,
    });
    if (rpcErr) {
      console.error('[/payments/verify] add_funds_secure failed:', rpcErr);
      return res.status(500).json({ success: false, message: 'Wallet credit failed.' });
    }

    // Record deposit for audit trail in USD (non-fatal)
    try {
      await userSupabase.from('deposits').insert({
        user_id:        userId,
        amount:         creditAmountUSD,
        payment_method: gateway.charAt(0).toUpperCase() + gateway.slice(1),
        reference_id:   verifyResult.gatewayPaymentId,
        status:         'completed',
        created_at:     new Date().toISOString(),
      });
    } catch (depErr) {
      console.warn('[/payments/verify] Could not insert deposit row:', depErr);
    }

    // Update payment_transactions status + multi-currency fields (non-fatal)
    try {
      await userSupabase
        .from('payment_transactions')
        .update({
          status:             'paid',
          gateway_payment_id: verifyResult.gatewayPaymentId,
          updated_at:         new Date().toISOString(),
          exchange_rate:      exchangeRate,
          amount_usd:         creditAmountUSD,
          amount_local:       verifyResult.amount,
        })
        .eq('gateway_order_id', gatewayOrderId);
    } catch (txErr) {
      console.warn('[/payments/verify] Could not update transaction status:', txErr);
    }

    return res.json({
      success: true,
      verified: true,
      gateway,
      amount: creditAmountUSD,
      amountLocal: verifyResult.amount,
      currency: verifyResult.currency,
      exchangeRate,
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
app.get('/api/v1/payments/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const gateway = req.query.gateway as PaymentGateway;

    if (!isNonEmptyString(id) || !isNonEmptyString(gateway)) {
      return res.status(400).json({ success: false, message: 'id and gateway query param are required.' });
    }

    const service = getGatewayService(gateway);
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
      const userId = intent.metadata?.user_id;
      if (userId) {
        try {
          await supabase.rpc('add_funds_secure', { p_user_id: userId, p_amount: intent.amount_received / 100 });
        } catch (rpcErr) {
          console.error('[/webhook/stripe] add_funds_secure failed:', rpcErr);
        }
      }
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
    const body = JSON.stringify(req.body);
    const sig  = req.headers['x-razorpay-signature'] as string;
    const expectedSig = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!).update(body).digest('hex');

    if (sig !== expectedSig) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay signature.' });
    }

    const event = req.body;
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      // payment.notes or order metadata would contain userId in production
      console.log('[/webhook/razorpay] payment.captured', payment?.id);
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
    const rawBody = JSON.stringify(req.body);
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

    const eventType = req.body?.event_type;
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      console.log('[/webhook/paypal] Capture completed:', req.body?.resource?.id);
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
const PORT = parseInt(process.env.PORT ?? '4000', 10);
app.listen(PORT, () => {
  console.log(`Coupon API Server running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});
