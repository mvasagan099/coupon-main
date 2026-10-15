# Country-specific accounts, wallets and coupons

Implemented on 15 October 2026. Supabase target: `coupon Project`, reference `mrextbryyayaojorstml`, accessed through the Mani connection.

## Behavior

- Signup requires one of the five supported countries (India, United States, United Kingdom, UAE, Australia). The database derives the currency from the country, including when a caller submits inconsistent signup metadata. New accounts without a supported country are rejected.
- Wallet amounts retain their numeric value in the account's local currency. India uses INR (₹), and the app does not convert balances, prices, deposits or withdrawals to/from USD. Country cannot be changed after assignment; currency tampering is rejected. Older accounts without a country must complete their existing country-selection flow before financial operations.
- Company campaign creation requires an eligible country. A company can assign/change the country from the overview or **Campaigns → Manage coupon countries**. Customers see matching campaigns; the purchase RPC independently rejects mismatched countries.
- An issued coupon keeps its country snapshot. Redemption verifies the coupon owner's country, including merchant-side redemption. Changing a campaign's country affects future purchases, not already-issued coupons.
- Deposits must use the account's currency. Verification credits the captured nominal amount exactly once. New ledger entries store wallet amounts and currency explicitly, and do not record INR amounts as USD. PayPal is offered for USD/GBP/AUD; INR and AED wallets require compatible local gateways. A provider may still impose its own account/currency limitations.
- Withdrawals deduct the entered local amount directly, and the admin payout screen displays that amount without applying exchange rates.
- Company redemption totals, liabilities and settlements keep currencies separate. Settlement generation produces distinct rows for INR and USD, never their sum in one currency; repeat generation does not duplicate rows.

## Live database changes

Both incremental migrations were applied successfully and their definitions were read back:

1. `supabase/migrations/20261015045528_country_scoped_local_wallets.sql`
2. `supabase/migrations/20261015051144_country_currency_settlements.sql`

The first attempt returned an expired request-state error. Read-back confirmed no schema changes; the retry succeeded. The second migration succeeded on its first attempt.

Verified before/after: 5 profiles, 3 campaigns, 15 issued coupons. Total stored wallet balances stayed 115500; total remaining coupon balances stayed 30000. No real payments, purchases, withdrawals, or customer-account creations were performed. Existing numeric balances were not converted, rewritten, or retroactively revalued.

**The three existing campaigns have no country assigned. They are deliberately blocked for new purchases until their company selects a country.** Existing coupon country snapshots were left intact. Do not guess or mass-assign a campaign country from a customer's country.

The updated `ALL_IN_ONE_NEW_DATABASE.sql` now handles both cases automatically: it installs the complete schema into an empty application database, or applies only the country/wallet/settlement updates to an existing compatible secured schema. It preserves existing records and balances and rejects incomplete schemas atomically. The incremental migrations remain available for migration-managed releases.

## Verification

- Frontend build: passed (existing informational dynamic-import warning remains).
- ESLint: passed with no findings.
- Server TypeScript: passed.
- Server regression tests: 6 passed, including nominal INR verification independent of historical USD quotes.
- Four Edge Functions: Deno type checks passed.
- Isolated PostgreSQL: country signup/purchase/redemption/currency-lock/local-withdrawal/payment-idempotency suite passed; existing security suite passed; separate-currency settlement/repeat-generation suite passed. All three suites also passed against the complete fresh-database setup.
- Browser: customer signup shows required Country; selecting India displays INR, +91 and Asia/Kolkata. No real account was created. Screenshot: `/tmp/country-signup-india.png`.
- Authenticated customer/company visual workflows and payment-provider sandbox flows were not tested because this checkout has no live Supabase frontend environment configuration.
- Supabase advisors were checked. Existing advisories remain for unrelated older trigger functions with mutable search paths/public execute access; the intentionally service-only payment-credit ledger has no client RLS policy. The country-lock trigger's search path is fixed by the second migration. These results are not an application-wide security certification. [Supabase advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)

## Release state

Database rules are LIVE. Frontend, Express API and revised Edge Function source are LOCAL and have not been pushed or deployed. Deploy the UI and API together with these schema versions; the current production UI cannot create/assign country-specific campaigns until updated. No Edge Functions were listed in this target during inspection, so PayPal function deployment and provider secrets/configuration remain necessary before those functions can be used.

After UI deployment, companies must select the country for each existing campaign. Verify an India account sees INR-only amounts, can buy/redeem an India campaign, and cannot buy/redeem a US campaign. Verify mixed-currency settlements remain separate. Actual provider captures, payment retries and admin payouts require deployment/sandbox validation.

Database trigger implementation follows [Supabase trigger guidance](https://supabase.com/docs/guides/database/postgres/triggers).

## One-file SQL Editor usage

Run the entire `supabase/ALL_IN_ONE_NEW_DATABASE.sql` file. It detects whether application tables already exist:

- Empty application database: install the full application schema and current rules.
- Existing compatible secured CouponVault database: execute only the country/wallet/settlement updates, preserving records and balances. Historical installation sections and seed data are not rerun.
- Incomplete existing application schema: reject the update atomically with the missing prerequisite identified.

`supabase/UPDATE_COUNTRY_WALLETS_EXISTING_DATABASE.sql` remains an optional update-only alternative; users do not need both files. The live country changes were already installed, and this combined-file revision has been tested locally rather than rerun on production.

Verification: a fresh install and subsequent existing-schema rerun passed, followed by the country/wallet, security and separate-currency settlement suites. `supabase/tests/all_in_one_rerun.sql` additionally populated test records and compared complete row snapshots across 16 application tables before and after rerunning the all-in-one file; every row, wallet balance, coupon balance, assigned country and pending payment stayed unchanged. This psql test is for disposable databases only. An incomplete-schema check verified that rejection left its original row intact and created no partial application objects.
