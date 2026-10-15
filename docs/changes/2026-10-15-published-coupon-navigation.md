# Published coupon navigation — 15 October 2026

Every brand detail page now links to a separate page of published offers from that issuer. The page uses the existing authenticated inventory and profile readers, filters by the account country, currency, active status, launch, expiry and remaining quantity, and links each offer to the existing wallet checkout details page. Brand matching uses the published issuer name, never coupon title text. No matching inventory produces an explicit empty state and a link to browse all published offers.

Published cards show stored prices, values, launch dates (the existing creation timestamp), expiry dates, country and availability. No invented coupon data is used in this list. Checkout continues through the existing authenticated purchase function and confirmation dialog; no changes to financial logic, database schema or inventory are included.

Removed displayed “Sample” and “Sample brand preview” wording from all 15 fictional brand cards and details. They retain a clear “Demo — not valid for redemption” disclosure and disabled purchasing. Existing bundled brand logos remain unchanged. This supersedes the display wording documented in the earlier brand sample change note.

Validation: 17 workflow tests, frontend build and lint pass. Browser checks using isolated local inventory verify matching issuer listings, no-inventory states, browse-all navigation, stored dates and opening/cancelling the purchase dialog. Mobile width 390px has no horizontal overflow; light and dark layouts inspected. No purchase, wallet debit, redemption or live inventory mutation is submitted during verification.

No SQL script needs to be run. Release uses the existing Render automatic deployment from main; live deployment and navigation are checked after publishing.
