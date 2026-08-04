-- ============================================================
-- Migration: Seed exchange rates for all country currencies
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

INSERT INTO public.exchange_rates (base_currency, target_currency, rate, updated_at)
VALUES
  ('USD', 'USD', 1.0, NOW()),
  ('USD', 'INR', 83.50, NOW()),
  ('USD', 'EUR', 0.92, NOW()),
  ('USD', 'GBP', 0.78, NOW()),
  ('USD', 'AUD', 1.52, NOW()),
  ('USD', 'CAD', 1.36, NOW()),
  ('USD', 'JPY', 155.00, NOW()),
  ('USD', 'CNY', 7.23, NOW()),
  ('USD', 'SGD', 1.35, NOW()),
  ('USD', 'HKD', 7.81, NOW()),
  ('USD', 'NZD', 1.63, NOW()),
  ('USD', 'MXN', 18.20, NOW()),
  ('USD', 'BRL', 5.40, NOW()),
  ('USD', 'ARS', 920.00, NOW()),
  ('USD', 'AED', 3.67, NOW()),
  ('USD', 'SAR', 3.75, NOW()),
  ('USD', 'QAR', 3.64, NOW()),
  ('USD', 'KWD', 0.31, NOW()),
  ('USD', 'BHD', 0.38, NOW()),
  ('USD', 'OMR', 0.38, NOW()),
  ('USD', 'EGP', 48.50, NOW()),
  ('USD', 'PKR', 278.00, NOW()),
  ('USD', 'BDT', 117.00, NOW()),
  ('USD', 'LKR', 305.00, NOW()),
  ('USD', 'PHP', 58.50, NOW()),
  ('USD', 'MYR', 4.70, NOW()),
  ('USD', 'THB', 36.50, NOW()),
  ('USD', 'IDR', 16300.00, NOW()),
  ('USD', 'VND', 25400.00, NOW()),
  ('USD', 'NGN', 1500.00, NOW()),
  ('USD', 'KES', 129.00, NOW()),
  ('USD', 'KRW', 1380.00, NOW()),
  ('USD', 'ZAR', 18.20, NOW()),
  ('USD', 'TRY', 32.80, NOW()),
  ('USD', 'CHF', 0.89, NOW()),
  ('USD', 'SEK', 10.60, NOW()),
  ('USD', 'NOK', 10.70, NOW()),
  ('USD', 'DKK', 6.90, NOW()),
  ('USD', 'PLN', 3.95, NOW()),
  ('USD', 'CZK', 23.20, NOW()),
  ('USD', 'HUF', 365.00, NOW()),
  ('USD', 'ILS', 3.70, NOW()),
  ('USD', 'UAH', 40.50, NOW()),
  ('USD', 'COP', 3950.00, NOW()),
  ('USD', 'CLP', 920.00, NOW()),
  ('USD', 'NPR', 135.50, NOW()),
  ('USD', 'GHS', 15.20, NOW())
ON CONFLICT (base_currency, target_currency)
DO UPDATE SET
  rate = EXCLUDED.rate,
  updated_at = NOW();
