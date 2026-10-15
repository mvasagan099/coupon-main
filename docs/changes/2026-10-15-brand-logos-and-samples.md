# Brand logos and sample coupons — 15 October 2026

Added locally bundled SVG logos for all 15 catalogue brands, displayed on marketplace cards and their detail-page headers. Logo sources and included licenses are documented in `public/brands/README.md`; assets are not fetched from a third-party logo service at runtime.

Every brand now has varied but stable sample details: title, illustrative price and face value, launch date, expiry, country, quantity, description and terms. The values are explicitly labelled as samples, rather than represented as real brand offers. They stay consistent across refreshes.

All 15 brand-preview routes are permanently separated from real merchant inventory. Their Buy buttons remain disabled, no checkout dialog is mounted, and the purchase handler explicitly refuses a brand preview even if passed a matching real offer. The existing published-offer routes retain their real wallet checkout. No sample database rows, orders, debits, coupons or redemptions are created.

Validation: frontend build and lint; 15 workflow regression tests, including rendering all 15 sample details with high wallet balance and matching real inventory to verify Buy remains disabled, no checkout dialog and no wallet-purchase display. Browser checks confirm all 15 SVG images load, sample values and dates are visible, and Buy is disabled. Light/dark and mobile views are inspected before release. No payment is submitted during verification.

No SQL changes or manual Supabase setup are needed. Release uses Render's existing automatic frontend deployment from main; final live status is checked against deployment metadata and the deployed page.
