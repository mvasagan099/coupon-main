-- Create test coupons for India (IN) and United States (US)
-- Execute this script in your Supabase Dashboard -> SQL Editor

INSERT INTO public.coupons (
  code, amount, remaining_balance, country_code, status, is_used, created_at
) VALUES 
  ('SVE-INDIA-100', 100.00, 100.00, 'IN', 'ACTIVE', false, NOW()),
  ('SVE-USA-100', 100.00, 100.00, 'US', 'ACTIVE', false, NOW())
ON CONFLICT (code) DO UPDATE 
SET amount = 100.00, remaining_balance = 100.00, country_code = EXCLUDED.country_code, status = 'ACTIVE', is_used = false;

-- Verify inserted coupons
SELECT id, code, amount, country_code, status, is_used FROM public.coupons WHERE code IN ('SVE-INDIA-100', 'SVE-USA-100');
