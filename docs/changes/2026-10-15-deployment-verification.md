# Deployment and payment verification — 15 October 2026

## Verified live deployment

Confirmed the existing Render workspace with the user: My Workspace (`tea-d9m3t5gae00c73bcqlb0`). Both CouponVault services use `https://github.com/mvasagan099/coupon-main`, branch `main`.

- Frontend: https://coupon-frontend-e8b3.onrender.com — live.
- API: https://coupon-api-qyer.onrender.com — live.
- Audit remediation revision `89c68ec7a5a70c12b01e52322a2fc1b37f6cdf95` was already automatically deployed before this verification.
- Fixed PayPal's API environment selection to honor explicit `PAYPAL_MODE=sandbox|live`, validate invalid modes, and preserve existing behavior when the setting is absent. Published revision `d522b89e82d7814ae9a456adc8886dc336aef1d3`; both services automatically deployed it successfully.
- API deployment after Stripe signing-secret configuration: `dep-db885vm89jmc73cjlva0`, confirmed live.
- All 12 server tests, server TypeScript checks and ESLint passed. The new PayPal regression uses mocked provider calls, not a real payment.

## Public endpoint checks

- Deployed frontend HTML returned successfully with the CouponVault title and published asset links.
- Unauthenticated Stripe recovery returned HTTP 401 with Authentication required.
- CORS preflight accepted the actual deployed frontend origin (HTTP 204).
- `/health` returned 404: this API does not implement that route. This result was not treated as proof that the running API was down.

## Stripe test webhook

The user connected and confirmed test-mode Stripe account `acct_1U0HjGQ822LbuEij` (New business). The account initially had zero webhook endpoints.

Created test endpoint `we_1UQjETQ822LbuEijm2L5sPqr`:

- Destination: https://coupon-api-qyer.onrender.com/api/v1/payments/webhook/stripe
- Event: payment_intent.succeeded
- API version: 2026-07-29.dahlia, matching the integration.
- Status: enabled; livemode=false.

Initial endpoint probes and runtime logs showed that STRIPE_WEBHOOK_SECRET and RAZORPAY_WEBHOOK_SECRET were missing. The Stripe signing secret was transferred directly to the API's server-only STRIPE_WEBHOOK_SECRET variable after the user explicitly approved this credential and destination. Existing environment variables were merged, not replaced. No secret was displayed or written to repository files.

After the resulting API deployment became live:

- Correctly signed synthetic nonfinancial event: HTTP 200, received=true.
- Invalid signature on the same synthetic payload: HTTP 400.

These initial checks verified deployed raw-body signature handling and rejection. They did not themselves prove provider-originated delivery or payment settlement. No payment was created or customer balance changed by these probes.

### Stripe-originated event delivery

After the Stripe connection was confirmed, performed a separate nonfinancial provider-delivery check with explicit user approval for a temporary event subscription:

- Created inactive, test-only product `couponvault_webhook_probe_20261015`, with no price.
- Temporarily subscribed the existing endpoint to `product.updated`, preserving `payment_intent.succeeded`.
- Updated the inactive product's test description once.
- Stripe generated event `evt_1UQjMVQ822LbuEijWnVgQYBr` with `livemode=false` and reported `pending_webhooks=0` on two reads. The registered endpoint was enabled for that event when generated. Stripe's installed SDK defines this field as the number of deliveries not yet successful (a 20x response), supporting successful provider-originated delivery. Exact per-delivery status was not available through Render request logs, which returned no records.
- Immediately restored the endpoint to `payment_intent.succeeded` only and verified its enabled state and original destination.
- The test product remains inactive and has no price. No charge, PaymentIntent, customer transaction or wallet credit was created.

Stripe's browser dashboard required a separate sign-in; it was not used to claim additional delivery details. This provider-originated nonfinancial test does not prove the payment-success handler's provider verification, wallet settlement or duplicate-credit behavior in production.

## India test-account boundary

The user selected a test account; read-only inspection confirmed country IN, currency INR, unlocked status and no stored Stripe orders. The country's regular payment path uses Razorpay. Its webhook signing secret is still absent, as confirmed by the deployed runtime log, and no Razorpay management connection was available in plugin discovery.

To complete that end-to-end test, configure the Razorpay test-mode account and keys, register payment.captured at:

https://coupon-api-qyer.onrender.com/api/v1/payments/webhook/razorpay

Set the same signing secret in Razorpay and the API's RAZORPAY_WEBHOOK_SECRET using their secure dashboards. Verify that public frontend and private API keys belong to the same test account. Never place private provider credentials in VITE_ variables or chat. A provider test payment and its single idempotent wallet credit remain unverified. Do not change the user's country to test another gateway or insert unverified wallet funds.

## Leaked-password protection: confirmed plan restriction

The user signed into the correct Supabase dashboard, project `mrextbryyayaojorstml`, coupon Project, mani's Org. Attempting to enable leaked-password protection returned:

> Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up.

The feature remains disabled. The unsaved toggle was restored to the stored off state. No billing upgrade or unrelated Auth-policy change was made. Enabling it requires a user-approved plan upgrade, then saving the setting and checking persistence. This feature is not enabled by ALL_IN_ONE_NEW_DATABASE.sql.

[Supabase password-security documentation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining work

1. Configure the Razorpay test webhook and matching secure credentials; complete the chosen India account's payment and wallet-reconciliation test.
2. Complete Stripe payment-success verification, wallet settlement and recovery testing with a suitable country/currency test account or isolated staging environment. Nonfinancial provider-originated delivery and signature handling have passed; a financial settlement has not been exercised.
3. Upgrade the Supabase plan only with explicit billing authorization, then enable leaked-password protection.

No live-money charge, refund, payout, coupon consumption or wallet credit was performed during this release verification.
