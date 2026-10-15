# Brand catalogue and coupon details — 15 October 2026

The customer marketplace now features 15 brand previews: Amazon, Flipkart, Meesho, Facebook, Google Play, Apple, Netflix, Spotify, YouTube, Myntra, AJIO, Swiggy, Zomato, Uber and Starbucks. The user explicitly selected catalogue previews until real inventory is available. No branded coupon inventory, affiliations, prices or dates are invented, and no database records were seeded.

Clicking a brand opens `/dashboard/marketplace/brand/:brandSlug`, with company information, coupon details, launch/expiry fields, country, availability and a disabled Buy button when no real offer exists. Preview dates display “Not announced.” Published offers for an exact matching issuer and the customer's country can appear on the same details page.

Existing marketplace offers are clickable links to `/dashboard/marketplace/coupon/:offerId`. Their details page shows the actual issuer, description, creation/launch timestamp, expiry, value, price, country, availability and terms. Buy appears only on the details page and opens a native confirmation dialog before calling the existing server-authorized wallet purchase function. It retains nominal local currency and rejects unavailable, expired, unlaunched, wrong-country, sold-out and invalid-price offers. Insufficient wallet funds disable purchasing and provide a wallet link. An in-flight guard prevents double submission; an uncertain error directs the customer to inspect My Cards before retrying.

The marketplace grid has no Buy button or inline checkout. Entire offer cards open details, including sold-out cards so customers can inspect their status. Marketplace navigation stays active on nested detail routes. Search includes the brand catalogue; price filters apply to published-price offers rather than unpriced previews.

## Validation

- Frontend build and lint passed.
- All 15 workflow tests passed, including the previous 10 and five new catalogue/purchase-flow tests.
- Isolated browser preview used dummy account data and a purchase function that cannot charge or issue a coupon. Checked catalogue/search, Amazon preview and disabled Buy, real-offer date/price/country fields, wallet confirmation and cancel, and light/dark presentation.
- Mobile catalogue and details were inspected at 390px width. Both had document width equal to available viewport width, with no horizontal overflow. Temporary viewport settings were reset.
- No real purchase, debit, coupon issuance or redemption was performed during UI testing.

No SQL migration or manual Supabase setup is required. Deployment uses the existing Render frontend automatic deployment from main. Runtime release status is verified through Render deployment metadata rather than inferred from local tests.
