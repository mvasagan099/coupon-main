-- Admin-managed catalogue campaigns; this does not create redeemable coupon stock.
CREATE TABLE IF NOT EXISTS public.brand_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug)<=80),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
 category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK (length(description)<=3000),
 color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
 logo_path text NOT NULL CHECK (logo_path ~ '^/brands/[a-z0-9-]+[.]svg$'),
 is_published boolean NOT NULL DEFAULT false,
 sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
 country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
 issuer_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.brand_campaigns TO authenticated;
GRANT ALL ON public.brand_campaigns TO service_role;
DROP POLICY IF EXISTS campaigns_read ON public.brand_campaigns;
CREATE POLICY campaigns_read ON public.brand_campaigns FOR SELECT TO authenticated
 USING (public.is_account_active((SELECT auth.uid())) AND (public.is_admin() OR (is_published AND (country_code IS NULL OR country_code=(SELECT p.country_code FROM public.profiles p WHERE p.id=(SELECT auth.uid()))))));
DROP POLICY IF EXISTS campaigns_insert ON public.brand_campaigns;
CREATE POLICY campaigns_insert ON public.brand_campaigns FOR INSERT TO authenticated
 WITH CHECK (public.is_account_active((SELECT auth.uid())) AND public.is_admin());
DROP POLICY IF EXISTS campaigns_update ON public.brand_campaigns;
CREATE POLICY campaigns_update ON public.brand_campaigns FOR UPDATE TO authenticated
 USING (public.is_account_active((SELECT auth.uid())) AND public.is_admin())
 WITH CHECK (public.is_account_active((SELECT auth.uid())) AND public.is_admin());
CREATE OR REPLACE FUNCTION public.touch_brand_campaign() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.touch_brand_campaign() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS brand_campaign_updated ON public.brand_campaigns;
CREATE TRIGGER brand_campaign_updated BEFORE UPDATE ON public.brand_campaigns FOR EACH ROW EXECUTE FUNCTION public.touch_brand_campaign();
CREATE INDEX IF NOT EXISTS brand_campaign_published_order ON public.brand_campaigns(sort_order,slug) WHERE is_published;
CREATE INDEX IF NOT EXISTS brand_campaign_issuer ON public.brand_campaigns(issuer_company_id) WHERE issuer_company_id IS NOT NULL;
INSERT INTO public.brand_campaigns(slug,name,category,description,color,logo_path,is_published,sort_order) VALUES
('amazon','Amazon','Shopping','Explore shopping coupon listings for Amazon. Review the issuer, eligible purchases and redemption terms before choosing an offer.','#a34d00','/brands/amazon.svg',true,1),
('flipkart','Flipkart','Shopping','Explore Flipkart shopping offers and review their product restrictions, value and validity when inventory becomes available.','#175fc0','/brands/flipkart.svg',true,2),
('meesho','Meesho','Shopping','Discover Meesho coupon listings and check the eligible shopping categories and redemption instructions for each published offer.','#a51c78','/brands/meesho.svg',true,3),
('facebook','Facebook','Social & business','Explore Facebook-related promotional listings. Any future offer must specify its eligible service, issuer and terms; this preview is not an advertising credit.','#1664d9','/brands/facebook.svg',true,4),
('google-play','Google Play','Apps & entertainment','Explore Google Play listings and check the country, eligible account and content restrictions before purchasing a published offer.','#087b66','/brands/google-play.svg',true,5),
('apple','Apple','Technology','Explore Apple-related coupon listings. Each published offer will explain the eligible products or services and account-region requirements.','#455269','/brands/apple.svg',true,6),
('netflix','Netflix','Entertainment','Browse Netflix-related listings and review membership eligibility, account restrictions and redemption instructions when an offer is published.','#c42132','/brands/netflix.svg',true,7),
('spotify','Spotify','Music','Explore Spotify-related offers and check membership, account and country eligibility in the terms of each published coupon.','#137b42','/brands/spotify.svg',true,8),
('youtube','YouTube','Entertainment','Explore YouTube-related promotional listings. Future offers will identify the eligible service and any account or subscription restrictions.','#c82222','/brands/youtube.svg',true,9),
('myntra','Myntra','Fashion','Explore fashion coupon listings for Myntra and review category exclusions, minimum-spend requirements and validity before purchasing.','#b02b66','/brands/myntra.svg',true,10),
('ajio','AJIO','Fashion','Discover AJIO-related shopping listings and check the eligible collections, exclusions and redemption terms for each published offer.','#765424','/brands/ajio.svg',true,11),
('swiggy','Swiggy','Food & delivery','Explore Swiggy-related listings and review the eligible service, delivery locations, minimum order and offer restrictions before purchase.','#a64908','/brands/swiggy.svg',true,12),
('zomato','Zomato','Food & dining','Explore Zomato-related coupons and check location, restaurant, order and account eligibility in each published offer.','#c02c46','/brands/zomato.svg',true,13),
('uber','Uber','Travel','Explore Uber-related listings and review eligible services, locations, account requirements and redemption terms when offers become available.','#354052','/brands/uber.svg',true,14),
('starbucks','Starbucks','Coffee & dining','Browse Starbucks-related coupon listings and review participating locations, eligible purchases and validity for each published offer.','#006b4b','/brands/starbucks.svg',true,15)
ON CONFLICT(slug) DO NOTHING;
