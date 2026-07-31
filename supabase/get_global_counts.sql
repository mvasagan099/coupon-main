-- This RPC allows the frontend to fetch gift cards along with their true global issued_count,
-- bypassing Row Level Security (RLS) so the UI can accurately display "Sold Out" or "Only X left"
-- even if the coupons were purchased by other users.

CREATE OR REPLACE FUNCTION get_gift_cards_with_counts()
RETURNS TABLE (
  id UUID,
  title TEXT,
  description TEXT,
  price NUMERIC,
  value NUMERIC,
  company_id UUID,
  banner_image TEXT,
  terms TEXT,
  issue_limit INTEGER,
  expiry_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  company_name TEXT,
  issued_count BIGINT
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT 
    g.id,
    g.title,
    g.description,
    g.price,
    g.value,
    g.company_id,
    g.banner_image,
    g.terms,
    g.issue_limit,
    g.expiry_date,
    g.created_at,
    c.name AS company_name,
    (SELECT COUNT(*) FROM coupons cp WHERE cp.gift_card_id = g.id) AS issued_count
  FROM gift_cards g
  LEFT JOIN companies c ON c.id = g.company_id;
$$;
