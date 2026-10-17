# Brand coupon availability — 17 October 2026

The 15 brand cards now show coupon face value, expiry, remaining quantity and selling price from existing published inventory. Each card selects the lowest-priced eligible offer from an exact matching issuer name. Country, currency, launch, expiry, active status and stock checks use the existing published-offer filter. Available offers link directly to their purchase detail page, whose action is explicitly labelled “Pay with wallet.”

Demo badges and illustrative data are removed from the marketplace cards. Brands without published inventory show Unavailable, Not listed and 0 listed. Failed inventory reads show Check availability rather than presenting invented stock. Unknown stock limits remain Not specified. The previous standalone demo detail routes remain separated from real checkout; marketplace cards now bypass those routes.

No branded inventory is created, no money is charged and no payment or fulfillment backend is altered. The user identified the same 15 brands but has not supplied a supplier integration or redeemable branded inventory. Direct external-payment coupon fulfillment remains pending that information; existing provider payments currently credit the wallet, and wallet purchase remains a separate atomic operation. The new cards do not pretend external payment automatically delivers coupons.

Validation: 18 workflow tests, build and lint pass. An isolated local browser fixture checks value/expiry/stock rendering, available-offer navigation and opening/cancelling wallet confirmation; mobile layout has no horizontal overflow and light/dark themes were inspected. Production browser is currently signed out, so authenticated live inventory and payment verification require sign-in. No SQL migration required.
