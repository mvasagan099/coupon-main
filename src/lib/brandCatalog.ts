import type { GiftCard } from './supabase';

export interface SampleBrandCoupon {
  isSample: true;
  title: string;
  value: number;
  price: number;
  launchDate: string;
  expiryDate: string;
  countryCode: string;
  quantity: number;
  description: string;
  terms: string;
}

export interface CatalogueBrand {
  slug: string;
  name: string;
  category: string;
  color: string;
  description: string;
  logoPath: string;
  sample?: SampleBrandCoupon;
  issuerCompanyId?: string | null;
}

// Fixed illustrative data: values do not change on refresh and never represent purchasable inventory.
const SAMPLE_VALUES = [2000, 1500, 1000, 3000, 750, 5000, 1200, 600, 900, 2500, 1800, 800, 1000, 1500, 500];
export const CATALOGUE_BRANDS: CatalogueBrand[] = [
  { slug: 'amazon', name: 'Amazon', category: 'Shopping', color: '#a34d00', description: 'Explore shopping coupon listings for Amazon. Review the issuer, eligible purchases and redemption terms before choosing an offer.' },
  { slug: 'flipkart', name: 'Flipkart', category: 'Shopping', color: '#175fc0', description: 'Explore Flipkart shopping offers and review their product restrictions, value and validity when inventory becomes available.' },
  { slug: 'meesho', name: 'Meesho', category: 'Shopping', color: '#a51c78', description: 'Discover Meesho coupon listings and check the eligible shopping categories and redemption instructions for each published offer.' },
  { slug: 'facebook', name: 'Facebook', category: 'Social & business', color: '#1664d9', description: 'Explore Facebook-related promotional listings. Any future offer must specify its eligible service, issuer and terms; this preview is not an advertising credit.' },
  { slug: 'google-play', name: 'Google Play', category: 'Apps & entertainment', color: '#087b66', description: 'Explore Google Play listings and check the country, eligible account and content restrictions before purchasing a published offer.' },
  { slug: 'apple', name: 'Apple', category: 'Technology', color: '#455269', description: 'Explore Apple-related coupon listings. Each published offer will explain the eligible products or services and account-region requirements.' },
  { slug: 'netflix', name: 'Netflix', category: 'Entertainment', color: '#c42132', description: 'Browse Netflix-related listings and review membership eligibility, account restrictions and redemption instructions when an offer is published.' },
  { slug: 'spotify', name: 'Spotify', category: 'Music', color: '#137b42', description: 'Explore Spotify-related offers and check membership, account and country eligibility in the terms of each published coupon.' },
  { slug: 'youtube', name: 'YouTube', category: 'Entertainment', color: '#c82222', description: 'Explore YouTube-related promotional listings. Future offers will identify the eligible service and any account or subscription restrictions.' },
  { slug: 'myntra', name: 'Myntra', category: 'Fashion', color: '#b02b66', description: 'Explore fashion coupon listings for Myntra and review category exclusions, minimum-spend requirements and validity before purchasing.' },
  { slug: 'ajio', name: 'AJIO', category: 'Fashion', color: '#765424', description: 'Discover AJIO-related shopping listings and check the eligible collections, exclusions and redemption terms for each published offer.' },
  { slug: 'swiggy', name: 'Swiggy', category: 'Food & delivery', color: '#a64908', description: 'Explore Swiggy-related listings and review the eligible service, delivery locations, minimum order and offer restrictions before purchase.' },
  { slug: 'zomato', name: 'Zomato', category: 'Food & dining', color: '#c02c46', description: 'Explore Zomato-related coupons and check location, restaurant, order and account eligibility in each published offer.' },
  { slug: 'uber', name: 'Uber', category: 'Travel', color: '#354052', description: 'Explore Uber-related listings and review eligible services, locations, account requirements and redemption terms when offers become available.' },
  { slug: 'starbucks', name: 'Starbucks', category: 'Coffee & dining', color: '#006b4b', description: 'Browse Starbucks-related coupon listings and review participating locations, eligible purchases and validity for each published offer.' },
].map((brand, index) => ({
  ...brand,
  logoPath: `/brands/${brand.slug}.svg`,
  sample: {
    isSample: true as const,
    title: `${brand.name} coupon`,
    value: SAMPLE_VALUES[index],
    price: Math.round(SAMPLE_VALUES[index] * (0.8 + (index % 4) * 0.05)),
    launchDate: `2026-10-${String(1 + (index * 3) % 14).padStart(2, '0')}T00:00:00Z`,
    expiryDate: `2027-${String(1 + index % 3).padStart(2, '0')}-${String(10 + index % 18).padStart(2, '0')}T23:59:59Z`,
    countryCode: 'IN',
    quantity: 75 + (index * 37) % 300,
    description: `An illustrative ${brand.category.toLowerCase()} coupon with a face value of ₹${SAMPLE_VALUES[index].toLocaleString('en-IN')}. This is demo content for the ${brand.name} preview, not a real company offer.`,
    terms: 'Demo terms only: single-use coupon; India accounts; valid within the displayed dates; cannot be exchanged for cash or combined with another offer. These examples are not issued or approved by the brand. Buying, payment and redemption are disabled.',
  },
}));

export function getCatalogueBrand(slug?: string): CatalogueBrand | undefined {
  return CATALOGUE_BRANDS.find(brand => brand.slug === slug);
}

export function getOfferUnavailableReason(offer: GiftCard, countryCode: string | null, now = Date.now()): string | null {
  if (!countryCode) return 'Complete your account country in Wallet before purchasing.';
  if (offer.country_code !== countryCode) return 'This coupon is available only to users registered in its selected country.';
  if (offer.is_active === false) return 'This coupon is currently unavailable.';
  if (!Number.isFinite(Number(offer.price)) || Number(offer.price) < 0 || !Number.isFinite(Number(offer.value)) || Number(offer.value) <= 0) return 'This coupon does not have a valid published price or value.';
  if (offer.expiry_date && (!Number.isFinite(Date.parse(offer.expiry_date)) || Date.parse(offer.expiry_date) <= now)) return 'This coupon has expired or its validity could not be verified.';
  if (offer.created_at && Date.parse(offer.created_at) > now) return 'This coupon has not launched yet.';
  if (offer.issue_limit != null && Number(offer.issued_count ?? 0) >= Number(offer.issue_limit)) return 'This coupon is sold out.';
  return null;
}

// Match the published issuer name, never a title or description mentioning a famous brand.
export function getPublishedOffers(offers: GiftCard[], countryCode: string | null, currency: string, now: number, brand?: CatalogueBrand): GiftCard[] {
  return offers.filter(offer => !getOfferUnavailableReason(offer, countryCode, now)
    && (!offer.currency || offer.currency === currency)
    && (!brand || (brand.issuerCompanyId !== undefined ? !!brand.issuerCompanyId && offer.company_id === brand.issuerCompanyId : offer.company_name?.trim().toLowerCase() === brand.name.toLowerCase())));
}
