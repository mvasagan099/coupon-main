import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import BrandLogo from './BrandLogo';
import { CATALOGUE_BRANDS } from '../lib/brandCatalog';
import '../styles/marketplace.css';

export default function BrandCatalogue({ search, visible = true }: { search: string; visible?: boolean }) {
  const query = search.trim().toLowerCase();
  const brands = CATALOGUE_BRANDS.filter(brand => `${brand.name} ${brand.category}`.toLowerCase().includes(query));
  if (!visible || brands.length === 0) return null;
  return <section className="brand-catalogue" aria-labelledby="brand-catalogue-title">
    <div className="catalogue-section-heading">
      <div><span className="section-label">THE BRAND COLLECTION</span><h2 id="brand-catalogue-title">A little something for everyone.</h2><p>Explore 15 popular brands. Open a card for company and coupon details.</p></div>
      <span className="catalogue-count">{brands.length} {brands.length === 1 ? 'brand' : 'brands'}</span>
    </div>
    <div className="brand-catalogue-grid">
      {brands.map(brand => <Link key={brand.slug} className="brand-catalogue-card" to={`/dashboard/marketplace/brand/${brand.slug}`} aria-label={`View ${brand.name} coupon details`}>
        <div className="brand-catalogue-art" style={{ background: brand.color }}><div className="brand-art-top"><BrandLogo brand={brand} /><span className="brand-preview-pill">Sample</span></div><span className="brand-catalogue-wordmark">{brand.name}</span></div>
        <div className="brand-catalogue-copy"><div><h3>{brand.name}</h3><p>{brand.category}</p></div><ArrowUpRight size={20} aria-hidden="true" /></div>
      </Link>)}
    </div>
    <p className="catalogue-disclosure">Brand logos identify each catalogue preview. Coupon prices, dates and quantities are sample data only. Purchases and redemption are disabled for these 15 previews; no brand partnership is implied.</p>
  </section>;
}
