# Audit remediation — 15 October 2026

The audit's code-level findings have been addressed in this checkout. Database and Storage protections were also applied to Supabase project `mrextbryyayaojorstml` (`coupon Project`, Mani connection), and four Edge Functions were deployed. Frontend and Express API code have not been deployed by this run. Live provider payments and authenticated end-to-end journeys remain unverified.

## Changes

| Audit issue | Result |
|---|---|
| Game quote used face value and INR for every country | Server quotes remaining balance, derives the local currency, and rejects expired, inactive, locked-owner or mismatched-country coupons. Exact code matching also avoids wildcard lookup. |
| Game consumption bypassed lifecycle/accounting | Database rechecks expiry, owner access and country; consumes remaining balance; writes the ordinary redemption ledger and game log atomically. Matching transaction retries are idempotent; reuse against another coupon is rejected. |
| Refunded withdrawals could become completed | Database enforces pending→completed/rejected terminal transitions and immutable financial details. Client updates also require pending state and report stale requests. Client withdrawal deletion is revoked. |
| Regeneration missed later redemptions | Unpaid settlement totals refresh when inputs change. Paid totals are preserved and changed paid-period totals raise an explicit adjustment error. Generation serializes with redemption inserts. |
| Demo checkout used real vouchers and promised fulfillment | Store accepts only the local DEMO100 sample and never calls the real coupon API. Checkout and completion clearly state that no payment, redemption or shipment occurs. |
| Missing Edge Function deployment | create-paypal-order, verify-paypal-payment, issue-coupon and redeem-coupon deployed ACTIVE with JWT verification enabled. All four reject unauthenticated requests with HTTP 401. |
| Stripe redirect/verification recovery | Intent identity is saved before confirmation; browser return restores recovery and removes sensitive return parameters from the URL. Owner-checked server recovery credits paid orders, resumes the same unfinished intent, and keeps processing payments pending. Recovery creates no new charge. Intent initialization is debounced. |
| Unsupported cashback promise | Removed the advertised cashback from the purchase summary. No cashback product policy or financial credit was invented. |
| Simulated KYC intake | Merchant uploads private PDF/JPG/PNG files up to 5 MB. Only owner/admin reads are allowed. Review uses a 60-second download link. Database validates uploaded references and blocks approval of placeholder documents. Existing rows are preserved. |
| Cached deposit rows could masquerade as verified history | Configured history uses database records only and propagates failures. Dashboard displays refresh failures, with retry. |
| Fixed security incident samples | Removed fabricated events and threat count; interface explicitly says monitoring is not connected. This does not establish a new telemetry pipeline. |
| Minor lifecycle/currency UI defects | Fixed Stripe currency formatting and scan lifecycle states; hidden inactive/expired marketplace offers; server catalogue checks merchant approval. Distinct same-title offers are retained. |
| Mutable database function search paths | Pinned the reported function search paths and removed unnecessary execution grants on trigger functions. |

Additional live finding: legacy `kyc` and `uploads` buckets had public insert/update policies; `kyc` was public. Both buckets contained zero objects at inspection. The KYC bucket is now private and the five known unsafe legacy policies were removed. Public branding reads for `uploads` remain available. New document uploads use `merchant-documents`, which is private.

## Database artifacts

- `supabase/migrations/20261015063107_audit_financial_workflows.sql`
- `supabase/migrations/20261015063346_private_merchant_documents.sql`
- Both updates are included in **both** routes of `supabase/ALL_IN_ONE_NEW_DATABASE.sql`: fresh install and compatible existing database.

The live project recorded both migrations successfully. Post-deployment inspection confirmed game RPC is not executable by anonymous callers, the withdrawal and settlement guards are installed, both KYC buckets are private, and the legacy public-write policies are absent. No production wallet balances, purchases, redemptions, payouts or historical financial records were changed by this run. No country was guessed for legacy profiles/campaigns.

## Validation

- Frontend production build and ESLint passed.
- Server TypeScript check and **11 server tests** passed, including game quote/lifecycle failures and Stripe ownership, paid, unfinished, processing and cancelled recovery states.
- All four Edge Functions passed Deno checks.
- Existing isolated security/payment/KYC/account-lock, country/wallet and separated-currency settlement regression suites passed.
- New isolated financial workflow regression passed: expired/locked/wrong-country game rejection; correct remaining-balance ledger; same-transaction retry and cross-coupon replay; refunded withdrawal transition and amount immutability; later-redemption settlement refresh; paid-period mismatch handling; anonymous RPC denial.
- New private document regression passed with a local Storage schema fixture: owner upload, foreign-folder denial, fake-reference rejection, stranger isolation and administrator review. The fixture tests SQL access control, not the hosted Storage upload service.
- Updated all-in-one fresh setup passed. Its rerun preserved every row across **16 application tables**, including balances and pending payments.
- Public browser check completed DEMO100 checkout and displayed “Demo complete” with explicit no-payment/no-redemption/no-shipping text. Screenshot: `/tmp/couponvault-remediation-demo.png`.
- Live read-back and unauthenticated HTTP checks passed. No real provider charge or real customer transaction was attempted.

## Remaining release work and limits

1. Deploy this checkout's frontend and Express API together. The API includes a new authenticated `/api/v1/payments/stripe/recover` endpoint; the updated frontend needs it.
2. Confirm server-only PayPal credentials, correct sandbox/live mode and allowed website origins in Supabase Edge Function settings. Confirm Stripe/Razorpay server credentials, webhook signing secrets, and registered webhook destinations on the API deployment. The connector did not expose secret/configuration management, and no credentials were requested in chat or printed.
3. Exercise authenticated customer/merchant/admin journeys, actual hosted document upload/download, redirect recovery and provider sandbox charges/webhooks before release. Game-platform funding must use the server's remaining amount and local currency; downstream funding and two-service reconciliation were not exercised.
4. Two legacy profiles lack country, and two campaigns lack country/currency. Users/merchants must select the correct country using the existing completion/assignment flows. Balances must remain nominal; do not infer a country or convert old amounts.
5. Supabase advisor still reports leaked-password protection disabled. Enable it in the project's Auth settings if supported by the project plan. [Supabase password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
6. Remaining advisor notices include intentionally callable, guarded authenticated RPCs, the masked public companies RPC, and service-only payment_credits RLS without client policies. These were not removed merely to suppress warnings. [Supabase function-permission guidance](https://supabase.com/docs/guides/database/functions).

Storage policy design follows [Supabase Storage access controls](https://supabase.com/docs/guides/storage/security/access-control). This report distinguishes tested local fixes and inspected live configuration from production user-experience or provider-payment guarantees.
