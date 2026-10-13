# CouponVault remediation report — 10 October 2026

Application fixes, an incremental database migration, and revised Edge Functions are prepared locally. They have not been pushed or deployed. Live database state and authenticated production workflows remain unverified.

## Findings addressed

| Audit finding | Change | Verification |
|---|---|---|
| S01 forged JWT | Supabase Auth verifies bearer tokens; anonymous/expired sessions and persisted locks fail closed | Five server regression tests include rejected sessions and locks |
| S02 browser privileged funding | Removed browser API-key funding fallback; legacy deposit endpoint returns 410 | Source/build review; existing exposed credentials still need operator rotation |
| S03 replay/ownership | Stored order ownership required; locked transaction, unique capture ledger, wallet update, deposit and paid status commit in one RPC | Server mismatch/ownership/failure tests; SQL duplicate and cross-order capture tests |
| S04 coupon disclosure/redemption | Anonymous coupon reads denied; owner/admin/approved merchant access; authorization and balance checks inside redemption RPC | SQL anonymous/stranger/owner tests |
| S05 merchant self-approval | Trigger protects status, owner and coupon limits; client inserts become pending | SQL owner status/limit rejection tests |
| S06 KYC disclosure | Safe company column grants and caller-aware masked RPC | SQL stranger masked/direct-read tests |
| S07 client payment tampering | Client accounting writes denied; servers create and settle payment records | SQL client payment-insert denial |
| S08 PayPal ownership | Edge creation stores owner/order/amount; verification checks stored ownership, provider order and completed capture | Deno check and source review; provider sandbox not tested |
| S09 default administrator | Removed default credentials and browser admin provisioning | Build and local login browser check |
| S10 currency integrity | Fresh provider-backed rates; unavailable rates fail closed; withdrawal conversion occurs in database; old seed rates expire | SQL withdrawal conversion/reservation/refund tests |
| W01 false payment success | UI confirms only successful authoritative settlement; no extra client wallet credits | Server failed-settlement test and source review |
| W02 captured payment recovery | Per-account pending PayPal order retained across refresh; retries verify same completed capture without another payment | Source review; live capture/retry not tested |
| W03 ineffective locks | Persisted admin lock RPC, restrictive RLS, protected definer functions and Auth/API checks | SQL locked purchase/read tests |
| W04 scan writes | Scan helpers use authoritative redemption RPC | Build and SQL redemption test |
| W05 Edge ownership column | Edge redemption uses caller-scoped validate/redeem RPCs | Deno check |
| W06 face value | Purchase debits stored price and issues stored face value; caller amount ignored | SQL price 80/value 100 with forged caller amount |
| W07 simulated mutations | Live errors propagate; removed admin/redemption/legacy issuance mutation fallbacks | Lint/build and source review |
| W08 webhook recovery | Raw signed bodies; separate Razorpay webhook secret; all providers route through atomic settlement | Source/type checks; registered provider delivery not tested |
| U01 return destination | Protected route stores original path; login restores safe relative destination | Build/source review |
| U02 missing country | Generic customer signup requires country selection | Build/source review |
| U03 footer links | Removed dead/legal/certification placeholders; footer links point to existing sections and customer portal | Local browser inspection; real legal documents still need business content |
| U04 password control | Accessible show/hide label and pressed state | Local browser inspection |
| U05 merchant guard | Merchant access checks company association; new applicants reach onboarding | Build/source review; authenticated role routing not tested |

Also removed merchant accounting-write access and customer order fabrication, constrained support sender identity, bounded session verification waits, surfaced logout failures, and fixed dashboard effect/ref/dependency lint defects.

## Validation results

- Frontend production build: PASS. Existing informational dynamic-import warning remains; build succeeds.
- ESLint: PASS, zero errors/warnings.
- Server TypeScript: PASS.
- Server authentication/payment tests: PASS, 5 tests.
- Four Edge Functions: PASS, Deno type checks.
- PostgreSQL 16 isolated test: PASS, guarded fresh setup and incremental migration; ownership, KYC, locks, purchase price/face value, redemption, capture idempotency, client credit denial, FX withdrawal reservation and rejected-withdrawal refund.
- Dependency audits after updates: zero reported vulnerabilities for frontend and server. This is dependency-advisory coverage, not a guarantee of application security.
- Browser: local login renders with blank credentials, named password toggle and working footer destinations in the accessibility tree. Supabase is unconfigured; signed-in dashboards and actual payments were NOT TESTED.

## Deployment and remaining work

The connected Supabase plugin lists only `gaming hub` and `lottery` (organization `wboabouvjtgadzjxxzst`). A follow-up check found existing CLI metadata in `supabase/.temp/linked-project.json` identifying project `coupon`, reference `ghoiannrniscrxedyzws`, organization `adnigqcmximumenpzjzm`. Its expected URL is `https://ghoiannrniscrxedyzws.supabase.co`. This metadata is historical and does not establish current remote access or schema state. The plugin's read-only `get_project` check for that reference was denied: `You do not have permission to perform this action`. Work against that remote target stopped after the denial. No live changes were applied. Connect the Supabase account/organization with access to the linked coupon project before remote inspection and deployment.

1. Inspect the correct project's deployed schema, migration history, duplicate payment orders, company controls and advisories. Back up and reconcile legacy inconsistent accounting rows before migration if present.
2. Apply only `supabase/migrations/20261010133725_couponvault_security_and_payment_integrity.sql` to an existing compatible database. The `ALL_IN_ONE_NEW_DATABASE.sql` artifact is guarded for a NEW, EMPTY database and must not be used to reset production.
3. Deploy the four revised functions with their shared files. Supply server-only Supabase service role and PayPal credentials. Edge Functions use `PAYPAL_SECRET`; Express uses `PAYPAL_CLIENT_SECRET`. Set actual frontend origins through `ALLOWED_ORIGINS`. Authentication is enforced inside each function through Supabase `getUser`.
4. Deploy frontend and API together with the migration. Node 22.12 or newer is required and declared in both packages and `.node-version` files. Keep server-to-server API keys out of browser variables. Configure webhook signing secrets and the registered PayPal webhook ID.
5. Refresh exchange rates through the API's startup/hourly provider refresh. Non-USD rates previously seeded without provenance are expired by the migration. Unsupported currencies remain unavailable rather than using an invented quote. UI retains true USD denomination when conversion is unavailable; non-USD withdrawals require a current stored rate.
6. Rotate any API key previously shipped as `VITE_API_KEY` and any deployed default administrator password; inspect historical suspicious credits. These tasks require deployment/account evidence and have not been performed.
7. Run authenticated owner/stranger/merchant/admin workflows and provider sandbox tests: approval, purchase, partial/full/expired redemption, lock/unlock, capture with interrupted DB credit, retry after refresh, webhook retry and withdrawal rejection. Parallel payment load testing and visual inspection of signed-in/mobile dashboards remain NOT TESTED.

Historical coupon balances are preserved: the face-value fix applies to new purchases and does not retroactively adjust already issued coupons. The unique order/capture constraints fail safely on incompatible legacy data, which requires inspection before deployment. A paid legacy row is treated as already paid to avoid an extra credit; historical credits are not reconstructed automatically.

Primary references: [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Frankfurter rates](https://frankfurter.dev/).

## Latest deployment access check

The user identified `mani6217's Project` in `mani’s Org` and supplied project reference `mrextbryyayaojorstml`. The prior cached CLI project `ghoiannrniscrxedyzws` must not be assumed to be the current deployment target. After reconnection, both the connector project-list and direct project-detail calls returned `Unknown tool`; current access, schema and project identity could not be verified remotely. A browser fallback opened `https://supabase.com/dashboard/project/mrextbryyayaojorstml`, but the page displayed a loading failure message rather than the project dashboard. No migration or Edge Function deployment was attempted against either remote project. The prepared migration requires live schema compatibility inspection before application.
