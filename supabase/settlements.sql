-- Create Settlements table
CREATE TABLE IF NOT EXISTS settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_month        TEXT NOT NULL, -- Format: YYYY-MM
  total_redemptions   INTEGER NOT NULL DEFAULT 0,
  amount_due          NUMERIC NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ,
  UNIQUE(company_id, period_month)
);

-- Enable RLS
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- Policies for Settlements
-- Admins can do everything
CREATE POLICY "admin_all_settlements" ON settlements FOR ALL USING (is_admin());

-- Merchants can read their own settlements
CREATE POLICY "merchant_read_own_settlements" ON settlements FOR SELECT
USING (
  company_id IN (
    SELECT id FROM companies WHERE owner_id = auth.uid()
  )
);

-- Function to generate monthly settlements
CREATE OR REPLACE FUNCTION generate_monthly_settlements(p_year INT, p_month INT, p_company_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
  v_period_str TEXT;
  v_inserted_count INTEGER := 0;
BEGIN
  -- Construct dates
  v_start_date := make_date(p_year, p_month, 1)::timestamptz;
  v_end_date := (v_start_date + interval '1 month');
  v_period_str := to_char(v_start_date, 'YYYY-MM');

  -- Insert settlements for companies that had redemptions in this period
  -- and haven't been settled yet.
  WITH monthly_data AS (
    SELECT 
      c.company_id,
      COUNT(r.id) as redemption_count,
      SUM(r.amount) as total_amount
    FROM redemptions r
    JOIN coupons c ON c.id = r.coupon_id
    WHERE r.created_at >= v_start_date 
      AND r.created_at < v_end_date
      AND (p_company_id IS NULL OR c.company_id = p_company_id)
    GROUP BY c.company_id
  )
  INSERT INTO settlements (company_id, period_month, total_redemptions, amount_due, status)
  SELECT 
    md.company_id, 
    v_period_str, 
    md.redemption_count, 
    md.total_amount, 
    'pending'
  FROM monthly_data md
  WHERE NOT EXISTS (
    SELECT 1 FROM settlements s 
    WHERE s.company_id = md.company_id AND s.period_month = v_period_str
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  
  RETURN v_inserted_count;
END;
$$;
