# Coupon details and checkout

Built on `codex/continue-324696b`, retaining the historical application and the 15 background presets.

## Behavior

- Marketplace cards are keyboard-accessible links with expiry and a View details action.
- `/dashboard/marketplace/coupon/:id` shows public company name, business address, approval status and joining date; coupon description, terms, launch/expiry, country, price, value and remaining inventory.
- Buy coupon opens wallet and direct-payment choices. Wallet purchases use a persistent request UUID and an atomic, idempotent database RPC.
- Direct checkout supports configured Razorpay (INR) and Stripe methods, reusing existing provider integrations. PayPal wallet top-ups remain unchanged.
- The API quotes persisted inventory and binds price, value, country, currency, company, title, description, expiry and terms to each direct payment. Client-supplied amounts cannot set the charge.
- Verified capture and issuance run in one database transaction. Payment-row locks, unique capture records and saved checkout results prevent duplicate credit/issuance from webhook/client retries.
- Stock is checked again during fulfillment. It is not reserved before payment. If terms or availability change, the full captured amount is retained in the customer's wallet, with a terminal saved result and an explicit customer message. No replacement coupon is purchased automatically.
- Direct-checkout cancellation is serialized against settlement. A capture arriving after cancellation credits the wallet without issuing a coupon. Provider authorization/capture cannot be cancelled by this application control; the UI explains the delayed-payment outcome.
- Saved direct orders can resume or verify without creating a second order. A failed wallet response retains its request ID so retries cannot debit twice.
- The purchased ticket shows the coupon face value separately from the amount paid, with country currency and expiry.
- Public-company fields are allowlisted; banking, tax, owner identity and KYC documents are excluded.

## Database

Applied migration: `supabase/migrations/20261021054447_coupon_details_direct_checkout.sql`. Additive payment/ordering columns, no balances or existing orders rewritten. The same final definitions are included in `supabase/ALL_IN_ONE_NEW_DATABASE.sql`.

Production grants verified: customers cannot insert/update payment records, invoke settlement, or call the service-only cancellation RPC; anonymous users cannot invoke coupon details. New customer RPCs deliberately use SECURITY DEFINER with account, ownership and country checks. The advisor flags these two intentionally exposed functions; isolated role tests cover access boundaries. Existing advisor warnings (including leaked-password protection and the older `get_companies` grant) are outside this feature.

## Validation

- `npm run lint`, `npm run build`.
- `npm run test:workflows`: 18 tests.
- `npm run test:checkout-db`: 9 isolated PostgreSQL tests: exactly-once issuance, capture/amount/currency mismatch, sold-out/expired/disabled/changed offers, cancellation interleavings, wallet retries, public-field filtering, country/account restrictions, top-up compatibility, equivalent timestamp formats and migration reapplication. These exercise both serialized race outcomes; they do not simulate provider-network concurrency.
- `cd server && npm run typecheck && npm test`: 15 API/security tests.
- Production dependencies: no reported advisories from `npm audit --omit=dev`.
- Browser fixture checks: card expiry and navigation, both choices, direct cancellation/resume, wallet success navigation and mobile fit (390px, no horizontal overflow).

## Live verification boundary

Frontend/API deployment and authenticated production screen checks are recorded after deployment. No real charge, wallet debit, new redeemable coupon, recovery email or support ticket was used for verification. Provider signing-secret presence gates direct checkout; it does not prove provider-side webhook registration or actual payment delivery. A supervised sandbox end-to-end payment remains required before declaring live payment fulfillment fully verified.

## Configuration and deployment verification

- Initial frontend/API commit `a68ea565b98f9f09b176409ca11196cc8e8bdbda` was deployed successfully. Authenticated marketplace expiry/details navigation was verified against the live Supabase data.
- Live checkout inspection found the frontend had no `VITE_STRIPE_PUBLISHABLE_KEY` and the API used a different Stripe sandbox. The user explicitly approved aligning the services with the New business test account `acct_1U0HjGQ822LbuEij`.
- Matching public/test API/webhook credentials are stored in Render settings only. The existing approved-account endpoint `we_1UQjETQ822LbuEijm2L5sPqr` is reused: enabled, subscribed to `payment_intent.succeeded`, API version `2026-07-29.dahlia`, destination `/api/v1/payments/webhook/stripe`. No duplicate endpoint or new charge was created.
- Razorpay remains gated off until its webhook signing secret is configured. Existing wallet top-up support is unchanged. Full audit has one pre-existing development-only Vite advisory; production-only dependency audit reports none.
- Deployment configuration is managed through Render settings; adding the public key there preserves the continuation branch and does not put credentials in the Blueprint or repository. Both services retain manual deployment after deploying a specific commit.
