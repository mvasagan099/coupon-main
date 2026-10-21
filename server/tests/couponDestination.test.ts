import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationAuthentication } from '../security';
import { verifyGameCoupon } from '../couponVerification';

function mockClient(coupon: Record<string, unknown> = {}, owner: Record<string, unknown> = {}) {
  const rows: Record<string, unknown> = {
    coupons: {
      id: 'coupon-uuid',
      amount: 100,
      remaining_balance: 75,
      status: 'active',
      is_used: false,
      country_code: 'IN',
      issued_to: 'owner-uuid',
      redemption_destination: 'gaming',
      ...coupon,
    },
    profiles: {
      country_code: 'IN',
      is_locked: false,
      ...owner,
    },
  };
  return {
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
      };
      return q;
    },
  } as any;
}

// ------------------------------------------------------------
// 1. Application Authentication & Forgery Prevention
// ------------------------------------------------------------
test('application authentication rejects missing, malformed or forged credentials', async () => {
  process.env.GAMING_API_KEY = 'gaming-secret-key-12345';
  process.env.LOTTERY_API_KEY = 'lottery-secret-key-67890';

  const middleware = applicationAuthentication();

  async function callAuth(headers: Record<string, string>, body: Record<string, unknown> = {}) {
    let statusCode = 200;
    let jsonBody: any = null;
    let nextCalled = false;
    const res: any = {
      locals: {},
      status: (code: number) => {
        statusCode = code;
        return res;
      },
      json: (data: any) => {
        jsonBody = data;
        return res;
      },
    };
    const req: any = { headers, body };
    await new Promise<void>((resolve) => {
      middleware(req, res, () => {
        nextCalled = true;
        resolve();
      });
      if (statusCode !== 200) resolve();
    });
    return { statusCode, jsonBody, nextCalled, callingApp: res.locals.callingApp };
  }

  // Missing header
  const r1 = await callAuth({});
  assert.equal(r1.statusCode, 401);
  assert.equal(r1.nextCalled, false);

  // Invalid key
  const r2 = await callAuth({ authorization: 'Bearer invalid-secret' });
  assert.equal(r2.statusCode, 401);
  assert.equal(r2.nextCalled, false);

  // Forged application in body with no or wrong key
  const r3 = await callAuth({ authorization: 'Bearer attacker-key' }, { callingApp: 'gaming', application: 'gaming' });
  assert.equal(r3.statusCode, 401);
  assert.equal(r3.nextCalled, false);

  // Valid GAMING_API_KEY -> verified as 'gaming'
  const r4 = await callAuth({ authorization: 'Bearer gaming-secret-key-12345' });
  assert.equal(r4.statusCode, 200);
  assert.equal(r4.nextCalled, true);
  assert.equal(r4.callingApp, 'gaming');

  // Valid LOTTERY_API_KEY -> verified as 'lottery'
  const r5 = await callAuth({ authorization: 'Bearer lottery-secret-key-67890' });
  assert.equal(r5.statusCode, 200);
  assert.equal(r5.nextCalled, true);
  assert.equal(r5.callingApp, 'lottery');

  // Forged body attempting to claim 'gaming' while using LOTTERY_API_KEY
  // MUST strictly resolve to 'lottery' based on the verified secret, ignoring the body.
  const r6 = await callAuth({ authorization: 'Bearer lottery-secret-key-67890' }, { callingApp: 'gaming', application: 'gaming' });
  assert.equal(r6.statusCode, 200);
  assert.equal(r6.nextCalled, true);
  assert.equal(r6.callingApp, 'lottery');

  // Fallback API_KEY authentication
  process.env.API_KEY = 'fallback-api-key-master-32charslong';
  const r7 = await callAuth({ authorization: 'Bearer fallback-api-key-master-32charslong' }, { gameId: 'gaming-hub' });
  assert.equal(r7.statusCode, 200);
  assert.equal(r7.nextCalled, true);
  assert.equal(r7.callingApp, 'gaming');

  const r8 = await callAuth({ authorization: 'Bearer fallback-api-key-master-32charslong' }, { gameId: 'lottery-platform' });
  assert.equal(r8.statusCode, 200);
  assert.equal(r8.nextCalled, true);
  assert.equal(r8.callingApp, 'lottery');
});

// ------------------------------------------------------------
// 2. Application Destination Restriction & Cross-App Enforcement
// ------------------------------------------------------------
test('allowed and rejected application destination combinations', async () => {
  // 1. Gaming app verifying a gaming coupon -> SUCCESS
  const gamingQuote = await verifyGameCoupon(
    mockClient({ redemption_destination: 'gaming' }),
    'CODE-123',
    'IN',
    'gaming'
  );
  assert.equal(gamingQuote.amount, 75);
  assert.equal(gamingQuote.currency, 'INR');

  // 2. Lottery app verifying a lottery coupon -> SUCCESS
  const lotteryQuote = await verifyGameCoupon(
    mockClient({ redemption_destination: 'lottery' }),
    'CODE-123',
    'IN',
    'lottery'
  );
  assert.equal(lotteryQuote.amount, 75);
  assert.equal(lotteryQuote.currency, 'INR');

  // 3. Gaming app verifying a lottery coupon -> REJECTED (DESTINATION_MISMATCH)
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: 'lottery' }), 'CODE-123', 'IN', 'gaming'),
    (err: any) => err.code === 'DESTINATION_MISMATCH' && /lottery/.test(err.message)
  );

  // 4. Lottery app verifying a gaming coupon -> REJECTED (DESTINATION_MISMATCH)
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: 'gaming' }), 'CODE-123', 'IN', 'lottery'),
    (err: any) => err.code === 'DESTINATION_MISMATCH' && /gaming/.test(err.message)
  );

  // 5. Gaming app verifying a couponvault coupon -> REJECTED (DESTINATION_MISMATCH)
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: 'couponvault' }), 'CODE-123', 'IN', 'gaming'),
    (err: any) => err.code === 'DESTINATION_MISMATCH' && /couponvault/.test(err.message)
  );

  // 6. Lottery app verifying a couponvault coupon -> REJECTED (DESTINATION_MISMATCH)
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: 'couponvault' }), 'CODE-123', 'IN', 'lottery'),
    (err: any) => err.code === 'DESTINATION_MISMATCH' && /couponvault/.test(err.message)
  );
});

// ------------------------------------------------------------
// 3. Unclassified Coupons Fail Closed
// ------------------------------------------------------------
test('unclassified coupons fail closed for all external application callers', async () => {
  // Gaming caller with null/unclassified destination -> REJECTED
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: null }), 'CODE-123', 'IN', 'gaming'),
    (err: any) => err.code === 'UNCLASSIFIED_DESTINATION' && /no redemption destination/i.test(err.message)
  );

  // Lottery caller with null/unclassified destination -> REJECTED
  await assert.rejects(
    verifyGameCoupon(mockClient({ redemption_destination: null }), 'CODE-123', 'IN', 'lottery'),
    (err: any) => err.code === 'UNCLASSIFIED_DESTINATION' && /no redemption destination/i.test(err.message)
  );
});

// ------------------------------------------------------------
// 4. Country Restrictions, Expiry, Insufficient Balance
// ------------------------------------------------------------
test('application verification enforces account country, expiry, locks and spendable balance', async () => {
  // Expiry
  await assert.rejects(
    verifyGameCoupon(
      mockClient({ redemption_destination: 'gaming', expiry_date: '2020-01-01T00:00:00Z' }),
      'CODE-123',
      'IN',
      'gaming'
    ),
    /expired/
  );

  // Locked account
  await assert.rejects(
    verifyGameCoupon(
      mockClient({ redemption_destination: 'gaming' }, { is_locked: true }),
      'CODE-123',
      'IN',
      'gaming'
    ),
    /locked/
  );

  // Country mismatch
  await assert.rejects(
    verifyGameCoupon(
      mockClient({ redemption_destination: 'gaming', country_code: 'IN' }, { country_code: 'IN' }),
      'CODE-123',
      'US',
      'gaming'
    ),
    /country/
  );

  // Insufficient / 0 balance
  await assert.rejects(
    verifyGameCoupon(
      mockClient({ redemption_destination: 'gaming', remaining_balance: 0 }),
      'CODE-123',
      'IN',
      'gaming'
    ),
    /spendable/
  );

  // Disabled / inactive coupon
  await assert.rejects(
    verifyGameCoupon(
      mockClient({ redemption_destination: 'gaming', status: 'disabled' }),
      'CODE-123',
      'IN',
      'gaming'
    ),
    /unavailable/
  );
});

// ------------------------------------------------------------
// 5. Checkout Offer Snapshot Binds Redemption Destination
// ------------------------------------------------------------
test('direct checkout offer snapshot binds destination and rejects destination tampering', async () => {
  const { quoteCoupon } = await import('../couponCheckout');
  const validCardId = '00000000-0000-0000-0000-000000000005';

  function checkoutFixture(cardOverrides: Record<string, unknown> = {}) {
    const card = {
      id: validCardId,
      price: 100,
      value: 100,
      currency: 'INR',
      country_code: 'IN',
      expiry_date: '2099-01-01',
      terms: 'Sample terms',
      title: 'Gaming Pass',
      description: 'Game pass description',
      company_id: 'company-uuid',
      issue_limit: 50,
      is_active: true,
      redemption_destination: 'gaming',
      ...cardOverrides,
    };
    return {
      from: (table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          single: async () => ({
            data:
              table === 'gift_cards'
                ? card
                : table === 'profiles'
                ? { country_code: 'IN', currency: 'INR' }
                : { status: 'approved', coupon_limit: 100 },
            error: null,
          }),
          then: (resolve: any) => Promise.resolve({ count: 5, error: null }).then(resolve),
        };
        return q;
      },
    } as any;
  }

  // 1. Snapshot correctly stamps redemption_destination
  const quote = await quoteCoupon(checkoutFixture({ redemption_destination: 'gaming' }), 'user-id', validCardId, 100);
  assert.equal(quote.snapshot.redemption_destination, 'gaming');

  // 2. Expected destination matches -> succeeds
  const quoteWithExpected = await quoteCoupon(
    checkoutFixture({ redemption_destination: 'lottery' }),
    'user-id',
    validCardId,
    100,
    'lottery'
  );
  assert.equal(quoteWithExpected.snapshot.redemption_destination, 'lottery');

  // 3. Expected destination changed while in checkout -> fails closed
  await assert.rejects(
    quoteCoupon(
      checkoutFixture({ redemption_destination: 'gaming' }),
      'user-id',
      validCardId,
      100,
      'lottery' // user thought they were buying a lottery card
    ),
    /destination changed/i
  );
});

