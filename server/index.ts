import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto'; // H-1: constant-time comparison

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
  console.error('Generate one with: node -e "console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))"');
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

app.use(authenticateAPIKey);

// ── Helpers ───────────────────────────────────────────────────────────────────
function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isSafePositiveNumber(val: unknown, max = 1_000_000): boolean {
  return typeof val === 'number' && Number.isFinite(val) && val > 0 && val <= max;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/v1/coupons/verify
app.post('/api/v1/coupons/verify', writeLimiter, async (req, res) => {
  try {
    const { couponCode } = req.body;

    if (!isNonEmptyString(couponCode)) {
      return res.status(400).json({ success: false, code: 'INVALID_COUPON', message: 'couponCode is required.' });
    }

    const { data: coupons, error } = await supabase
      .rpc('verify_game_coupon', { p_code: couponCode.trim().toUpperCase() });

    const coupon = coupons && coupons.length > 0 ? coupons[0] : null;

    if (error || !coupon) {
      return res.status(404).json({ success: false, code: 'INVALID_COUPON', message: 'Coupon not found.' });
    }

    if (coupon.is_used) {
      return res.status(400).json({ success: false, code: 'REDEEMED', message: 'Coupon already redeemed.' });
    }

    if (coupon.status === 'DISABLED') {
      return res.status(400).json({ success: false, code: 'DISABLED', message: 'Coupon disabled.' });
    }

    return res.json({
      success: true,
      couponId: coupon.id,
      amount: coupon.amount,
      currency: 'INR',
      status: coupon.status || 'ACTIVE',
    });

  } catch (err) {
    console.error('[/coupons/verify]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// POST /api/v1/coupons/redeem
// HIGH-05: Validate ALL required fields; amount bounded
app.post('/api/v1/coupons/redeem', writeLimiter, async (req, res) => {
  try {
    const { couponId, userId, gameId, walletTransactionId, ipAddress, device } = req.body;

    if (
      !isNonEmptyString(couponId) ||
      !isNonEmptyString(userId) ||
      !isNonEmptyString(gameId) ||
      !isNonEmptyString(walletTransactionId)
    ) {
      return res.status(400).json({ success: false, message: 'Missing or invalid required parameters.' });
    }

    const { data, error } = await supabase.rpc('redeem_game_coupon', {
      p_coupon_id:           couponId,
      p_game_user_id:        userId,
      p_game_id:             gameId,
      p_wallet_transaction_id: walletTransactionId,
      p_ip_address:          isNonEmptyString(ipAddress) ? ipAddress : '0.0.0.0',
      p_device:              isNonEmptyString(device)    ? device    : 'unknown',
    });

    if (error) {
      console.error('[/coupons/redeem]', error);
      return res.status(400).json({ success: false, code: 'REDEEM_FAILED', message: error.message });
    }

    return res.json({ success: true });

  } catch (err) {
    console.error('[/coupons/redeem]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/v1/campaigns
app.get('/api/v1/campaigns', async (_req, res) => {
  const { data, error } = await supabase.from('campaigns').select('*').eq('is_active', true);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.json({ success: true, data });
});

// POST /api/v1/wallet/transfer
// MED-04: Amount is validated and capped; HIGH-05 applied
app.post('/api/v1/wallet/transfer', writeLimiter, async (req, res) => {
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
app.post('/api/v1/wallet/deposit', writeLimiter, async (req, res) => {
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
app.get('/api/v1/coupons/:id', async (req, res) => {
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
