# Coupon card backgrounds

Continues from commit `324696b` on `codex/continue-324696b`. No later catalogue, demo campaign or admin campaign screens are restored.

Merchant → Campaigns → Step 3 now contains 15 predefined backgrounds (Amazon, Flipkart, Meesho, Facebook, Google Play, Apple, Netflix, Spotify, YouTube, Myntra, AJIO, Swiggy, Zomato, Uber and Starbucks), an HTTPS custom image URL field and a default-image reset. Selecting a preset changes only artwork and the live preview. The branded backgrounds are bundled SVG layouts using the existing licensed logo assets; source and licence files accompany the assets.

Manage published coupons → Change background provides the same picker and an explicit Save background action for existing coupons. The save updates only `gift_cards.banner_image`, filters by coupon and company, checks the previously loaded image to avoid silently replacing a concurrent edit, requires a returned database row, and never reports a local fallback as success. Existing database RLS restricts updates to owners of approved merchant companies. No migration, coupon creation, price change, stock change or financial operation is included.

Image values accept bundled preset paths or HTTPS URLs without embedded credentials; invalid schemes, unknown local paths and loopback hosts are rejected. CSS image URLs are quoted safely. Existing missing/invalid images retain the default fallback.

Fixed a wizard transition where a Next button changing into the submit button could trigger publication during the same click: Next now cancels its default action before changing steps. Also constrained navigation to its container so the new editor works without horizontal page overflow on mobile.

Validation: frontend build/lint and 14 workflow tests, including preset assets, URL validation, optimistic persistence filters, denied/stale saves and Next-step submission prevention. Browser checks in an isolated merchant fixture select all 15 presets, verify loaded SVG images and live preview changes, save an existing coupon’s image, and inspect mobile light/dark layouts. No live coupon was published or edited during QA. Live database readback confirms the existing text banner column and merchant-owned UPDATE policy. Deployment is manual from the continuation branch because frontend automatic deploys remain disabled after the historical rollback.
