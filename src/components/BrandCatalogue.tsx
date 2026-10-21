import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { getPublishedOffers } from '../lib/brandCatalog';
import type { CatalogueBrand } from '../lib/brandCatalog';
import type { GiftCard } from '../lib/supabase';
import { formatCurrency } from '../lib/exchangeRate';
import { useNow } from '../hooks/useNow';
import '../styles/marketplace.css';

export default function BrandCatalogue({ search, visible = true, offers = [], countryCode = null, currency = 'INR', inventoryError = false, brands: campaigns }: { brands: CatalogueBrand[]; search: string; visible?: boolean; offers?: GiftCard[]; countryCode?: string | null; currency?: string; inventoryError?: boolean }) {
  const now = useNow();
  const query = search.trim().toLowerCase();
  const brands = campaigns.filter(brand => `${brand.name} ${brand.category}`.toLowerCase().includes(query));
  if (!visible || brands.length === 0) return null;
  return <section className="brand-catalogue" aria-labelledby="brand-catalogue-title">
    <div className="catalogue-section-heading">
      <div><span className="section-label">THE BRAND COLLECTION</span><h2 id="brand-catalogue-title">A little something for everyone.</h2><p>Explore our brand campaigns. Check coupon value, expiry and availability. Open an available offer to buy with your wallet.</p></div>
      <span className="catalogue-count">{brands.length} {brands.length === 1 ? 'brand' : 'brands'}</span>
    </div>
    <div className="brand-catalogue-grid">
      {brands.map(brand => {
        const eligible = inventoryError ? [] : getPublishedOffers(offers, countryCode, currency, now, brand);
        const offer = [...eligible].sort((a, b) => Number(a.price) - Number(b.price) || a.id.localeCompare(b.id))[0];
        const count = offer?.issue_limit == null ? null : Math.max(0, Number(offer.issue_limit) - Number(offer.issued_count ?? 0));
        const expiry = offer?.expiry_date && Number.isFinite(Date.parse(offer.expiry_date)) ? new Date(offer.expiry_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not listed';
        return <Link key={brand.slug} className="brand-catalogue-card" to={offer ? `/dashboard/marketplace/coupon/${offer.id}` : `/dashboard/marketplace/brand/${brand.slug}/offers`} aria-label={`View ${brand.name} coupon details`}>
          <div className="brand-catalogue-art" style={{ background: brand.color }}><div className="brand-art-top"><BrandLogo brand={brand} /><span className="brand-preview-pill">{inventoryError ? 'Check availability' : offer ? 'Available' : 'Unavailable'}</span></div><span className="brand-catalogue-wordmark">{brand.name}</span></div>
          <div className="brand-catalogue-copy"><div><h3>{brand.name}</h3><p>{brand.category}</p></div><ArrowUpRight size={20} aria-hidden="true" /></div>
          <dl className="brand-coupon-facts">
            <div><dt>Coupon value</dt><dd>{offer ? formatCurrency(Number(offer.value), currency) : 'Not listed'}</dd></div>
            <div><dt>Expiry</dt><dd>{expiry}</dd></div>
            <div><dt>Available count</dt><dd>{inventoryError ? 'Not available' : offer ? count == null ? 'Not specified' : count : '0 listed'}</dd></div>
          </dl>
          <div className="brand-coupon-action">{offer ? <><span>{formatCurrency(Number(offer.price), currency)}</span><span>View &amp; buy</span></> : <span>{inventoryError ? 'Inventory could not be loaded' : 'No published coupons yet'}</span>}</div>
        </Link>;
      })}
    </div>
    <p className="catalogue-disclosure">Details are shown only for published offers available in your account country. When a brand has several offers, the card shows its lowest-priced available coupon. No brand partnership is implied.</p>
  </section>;
}
