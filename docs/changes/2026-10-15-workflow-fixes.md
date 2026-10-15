# Workflow fixes — 15 October 2026

This change addresses the ten findings from the latest read-only workflow review. No currency conversion, automatic withdrawal approval, customer payment, or wallet credit is introduced.

| Finding | Result |
|---|---|
| Resumed Stripe payment amount could change visually | Amount input, quick amount buttons and provider selection remain disabled while resuming the saved intent. |
| Token refresh unmounted dashboards and discarded forms | A verified session refresh for the same account revalidates in the background. Initial sessions, account changes, invalid sessions and locked accounts retain blocking verification. Merchant metadata failure no longer rejects otherwise valid customer authentication. |
| Browser cache appeared in financial lists | Configured orders, vouchers, redemptions and both settlement lists use database results only, including empty results. Database errors propagate rather than becoming fabricated history. |
| Mark paid reported success for missing or stale settlements | Admin-only database function atomically changes pending rows and uses the server timestamp. Missing/already-paid rows fail. Paid settlements cannot be reopened, changed or deleted. |
| Ticket creation left orphan tickets and retry duplicates | One authenticated database function creates the ticket and first message in one transaction. An account-scoped request ID serializes retries; changed payload replays fail. Email and sender derive from the authenticated account. The widget retains the request ID across failed attempts while the form remains mounted. |
| Multiple companies broke merchant-owner lookup | Select one company deterministically, preferring approved status, then newest creation time and ID. Existing company records remain intact. |
| Expired/inactive vouchers counted as active | Active eligibility requires active status, positive balance, unused state and future valid expiry. Unavailable vouchers have a separate tab; used/depleted vouchers remain visible. Merchant active campaign totals also exclude expired/disabled offers. |
| Legacy country completion retained wrong provider | Both initial profile loading and country completion select the same supported provider for the account's nominal local currency. Profile refresh depends on account identity, avoiding token-refresh provider resets. |
| Missing password recovery | Added forgot-password navigation, reset-link requests and password confirmation/update after the Supabase PASSWORD_RECOVERY event. Invalid/expired links show a new-link request form. Reset-link responses use a generic account-existence message. |
| Failed support reads showed stale conversations | Thread switches clear previous messages, reject late responses, and show reload errors. Ticket-list and reply errors are visible. An acknowledged reply whose refresh fails is not offered as unsent text. |

The KYC wizard also retains the selected document when navigating back, and wallet refresh failures display a warning about a potentially stale balance.

## Validation

- `npm run test:workflows`: 10 passing regression tests, exercising financial-cache exclusion, error propagation, support retry arguments/thread races, saved Stripe controls, session refresh/identity/revocation, voucher lifecycle, password recovery, country provider selection and merchant selection.
- `npm run build` and `npm run lint`: passed.
- API: `npm run typecheck` and all 12 tests passed.
- Disposable PostgreSQL: fresh all-in-one installation plus seven SQL regression suites passed: security, country wallets, country settlements, financial workflows, private merchant documents, reliable support/settlements and all-in-one rerun preservation.
- The rerun compared all rows across 16 application tables, preserving balances and pending payments.
- Support SQL checks verified one ticket/message on retry, rollback of a failed first-message write, changed-payload rejection, account-derived email and locked-account rejection. Settlement checks verified customer rejection, server timestamps, stale/missing rejection and paid-record immutability.
- Browser inspection verified sign-in → password recovery navigation and the new request form. No reset email was sent and no actual account password was changed.

## Database and release

Applied `20261015092548_reliable_support_and_settlements.sql` to Supabase project `mrextbryyayaojorstml` through the Mani connection. Read-back confirmed both functions exist, anonymous ticket creation is denied and authenticated execution is granted. The all-in-one SQL includes identical definitions in both the existing-database and fresh-install branches. Users of this connected project do not need to rerun the entire setup file for these fixes.

The frontend release target is `https://coupon-frontend-e8b3.onrender.com`, using Render's existing automatic deployment from main. The code and this report travel in the same release commit; Render deployment metadata is the authoritative release status.

The Supabase dashboard already permits `https://coupon-frontend-e8b3.onrender.com/**`, covering `/reset-password`. No redirect/security settings were changed.

## Remaining verification boundaries

These checks do not establish authenticated, end-to-end production success for a customer purchase, redemption, withdrawal, support exchange or emailed password recovery. No live money movement, provider charge, balance credit or production test ticket was created. Existing provider-configuration and Supabase plan limitations are recorded in `2026-10-15-deployment-verification.md`; they are not resolved by this workflow patch. In particular, Razorpay webhook configuration and leaked-password protection remain external follow-ups.
