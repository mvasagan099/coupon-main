# PayPal Setup - Supabase Edge Functions

All payment processing now goes through Supabase Edge Functions to ensure client-side credentials are never exposed.

## Setup Steps

### 1. Configure local environment variables

In your root `.env` file, ensure you have set:
```env
VITE_PAYPAL_CLIENT_ID=ATg5qMu7ZZ-qnI8atDKgN...
```
*(Replace `ATg5qMu7ZZ-qnI8atDKgN...` with your actual sandbox/live PayPal Client ID)*

### 2. Deploy Supabase Edge Functions & Set Secrets

Run the following commands in your shell to upload your credentials securely to Supabase and deploy the new functions:

```bash
# Set your PayPal credentials in Supabase secrets
supabase secrets set PAYPAL_CLIENT_ID="ATg5qMu7ZZ-qnI8atDKgN..."
supabase secrets set PAYPAL_SECRET="EIJFiBsYvBfmhbatJZlXiMilyi1BKfhuBZNwtDHlBYi5yDMwYu3rOc3-hqtkWf_HesEuzdkZ5RJktvex"
supabase secrets set PAYPAL_MODE="sandbox"  # Use "live" for production environment

# Deploy the edge functions
supabase functions deploy create-paypal-order
supabase functions deploy verify-paypal-payment
```

### 3. Verify Functions are Deployed

Go to your [Supabase Dashboard](https://supabase.com/dashboard) → Edge Functions.

You should see:
- ✅ `create-paypal-order`
- ✅ `verify-paypal-payment`

Both should show a green status of "deployed".

### 4. Test Locally

Run the development server:
```bash
npm run dev
```

Then:
1. Open http://localhost:5173
2. Log in (or create a test account)
3. Go to your User Dashboard
4. Click "Add Money" or "Buy gift card"
5. The PayPal Smart Buttons container should render inside the modal
6. Clicking on it opens the official secure PayPal Sandbox window
7. Finish checkout with a PayPal sandbox customer account, and verify the checkout finishes successfully and updates the wallet/issues the voucher code.

## Architecture

```
Browser (PayPal Buttons) ──> Supabase Edge Function (Create/Verify) ──> PayPal REST API
```

## Troubleshooting

### Error: "Missing PayPal server credentials"
- Go to your Supabase Dashboard → Edge Functions → `create-paypal-order` → Settings.
- Verify environment variables `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` are correctly configured.
- Try re-running the `supabase secrets set` command and redeploying the function.

### Error: CORS blocked
- The Edge Functions have standard CORS configuration enabled. If you see CORS errors on localhost, try clearing your browser cache or run the browser in Private/Incognito mode to clear any cached negative responses.
