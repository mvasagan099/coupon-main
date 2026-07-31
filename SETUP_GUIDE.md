# CouponVault - Setup & Deployment Guide

## Issue Summary
Your app shows two main errors:
1. **`profiles` table not found** - Supabase database missing the required table
2. **Razorpay functions not reachable** - Edge functions or Netlify functions not accessible

---

## Fix 1: Create the `profiles` Table

### Option A: Using Supabase Dashboard (Easiest)
1. Go to https://supabase.com/dashboard
2. Select project `ghoiannrniscrxedyzws`
3. Navigate to **SQL Editor**
4. Click **New Query**
5. Copy and paste the SQL from `supabase/schema.sql` (lines 233-296 for profiles table)
6. Click **Run**

**Minimal SQL to run:**
```sql
CREATE TABLE IF NOT EXISTS profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_balance NUMERIC NOT NULL DEFAULT 0.00 CHECK (wallet_balance >= 0)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_profiles"    ON profiles FOR ALL    USING (is_admin());
CREATE POLICY "user_view_profile"     ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "user_update_profile"   ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "user_insert_profile"   ON profiles FOR INSERT WITH CHECK (id = auth.uid());
```

### Option B: Using Supabase CLI
```bash
cd d:\work\coupon
supabase db push --project-ref ghoiannrniscrxedyzws
```

---

## Fix 2: Deploy Razorpay Functions

### Issue
- Netlify function `/.netlify/functions/create-razorpay-order` returns 404
- Supabase function not deployed or CORS-blocked

### Solution: Deploy Netlify Functions

**Step 1: Add Razorpay secrets to Netlify**
1. Go to https://app.netlify.com
2. Select your site (thunderous-paprenjak-6294db)
3. Navigate to **Site settings** → **Build & deploy** → **Environment**
4. Add environment variables:
   ```
   RAZORPAY_KEY_ID=rzp_test_5pB86mUoQ9t0p1
   RAZORPAY_KEY_SECRET=your_razorpay_key_secret_here
   ```

**Step 2: Deploy the functions**
Netlify automatically deploys functions from `netlify/functions/` directory during build.

```bash
cd d:\work\coupon
npm run build
# This creates production build with Netlify functions ready
```

Then push to Git and Netlify will deploy automatically:
```bash
git add .
git commit -m "Setup: Add profiles table and Razorpay secrets"
git push
```

### Alternative: Test Locally (without Netlify)

For local testing, you need to configure Netlify CLI:
```bash
npm install -g netlify-cli
netlify dev
```

This will run the Netlify functions locally on a temporary URL.

---

## Fix 3: Ensure `is_admin()` Function Exists

The `profiles` table policies depend on `is_admin()` function. Run this SQL:

```sql
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT raw_user_meta_data->>'role' = 'admin'
     FROM auth.users WHERE id = auth.uid()),
    false
  );
$$;
```

---

## Verification Checklist

After applying fixes:

- [ ] `profiles` table shows in Supabase SQL Editor
- [ ] No 404 errors for `/rest/v1/profiles` 
- [ ] `/.netlify/functions/create-razorpay-order` responds with 200 (or available in preview)
- [ ] Razorpay checkout loads without CORS errors
- [ ] `getUserWalletBalance()` no longer shows in console errors

---

## Quick Test

1. Run locally: `npm run dev`
2. Navigate to UserDashboard
3. Try to add money
4. Check browser console for errors

Expected behavior: Razorpay checkout modal should open without errors.
