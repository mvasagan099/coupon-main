import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LoadingPage } from '../components/LoadingPage';
import { getPublishedOffers } from '../lib/brandCatalog';
import { campaignBrand, getBrandCampaigns } from '../lib/campaigns';
import type { BrandCampaign } from '../lib/campaigns';
import { getGiftCards, getUserProfileData } from '../lib/supabase';
import type { GiftCard } from '../lib/supabase';
import { getCountryByCode } from '../lib/countries';
import { formatCurrency } from '../lib/exchangeRate';
import { useNow } from '../hooks/useNow';
import '../styles/marketplace.css';

type Profile = Awaited<ReturnType<typeof getUserProfileData>>;
function dateLabel(value: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not supplied by issuer';
}

export default function PublishedCouponsPage() {
  const { brandSlug } = useParams<{ brandSlug?: string }>();
  const { user } = useAuth();
  const userId = user?.id;
  const now = useNow();
  const [data, setData] = useState<{ offers: GiftCard[]; profile: Profile; campaigns: BrandCampaign[]; userId: string } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const brand = data?.campaigns.find(row => row.slug === brandSlug);
  const catalogueBrand = brand ? campaignBrand(brand) : undefined;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void Promise.all([getGiftCards(), getUserProfileData(userId), getBrandCampaigns()]).then(([offers, profile, campaigns]) => {
      if (!cancelled) { setData({ offers, profile, campaigns, userId }); setLoadError(''); }
    }).catch(() => { if (!cancelled) setLoadError('Could not load published coupons. Please try again.'); });
    return () => { cancelled = true; };
  }, [userId, revision]);

  const back = <Link className="details-back" to="/dashboard/marketplace"><ArrowLeft size={16} />Back to marketplace</Link>;
  if (data && brandSlug && (!brand || (brand.country_code && brand.country_code !== data.profile.country_code))) return <section className="marketplace-details">{back}<h1>Brand not found</h1></section>;
  if (loadError) return <section className="marketplace-details">{back}<div className="details-panel" role="alert"><p>{loadError}</p><button className="btn btn-primary" onClick={() => { setLoadError(''); setRevision(value => value + 1); }}>Try again</button></div></section>;
  if (!data || data.userId !== userId) return <LoadingPage message="Loading published coupons..." />;
  const country = data.profile.country_code ? getCountryByCode(data.profile.country_code) : null;
  const currency = country?.currency ?? data.profile.currency ?? 'USD';
  const offers = getPublishedOffers(data.offers, data.profile.country_code, currency, now, catalogueBrand);

  return <section className="marketplace-details">
    {back}
    <div className="details-hero">{catalogueBrand && <BrandLogo brand={catalogueBrand} />}<span className="brand-preview-pill">PUBLISHED OFFERS</span><h1>{brand ? `${brand.name} coupons` : 'Available coupons'}</h1>{brand?.description && <p>{brand.description}</p>}<p>{country ? `Offers available in ${country.name}. Review the issuer’s details, then buy securely with your wallet.` : 'Complete your account country in Wallet to see eligible offers.'}</p></div>
    {brand && <p className="published-browse-link"><Link className="btn btn-secondary" to="/dashboard/marketplace/offers">Browse all published coupons</Link></p>}
    {!country ? <div className="details-panel"><h2>Select your country</h2><Link className="btn btn-primary" to="/dashboard/wallet">Open wallet</Link></div> : offers.length === 0 ? <div className="details-panel" role="status"><h2>No {brand ? `${brand.name} ` : ''}coupons available yet</h2><p>No published offers are currently available for your country{brand ? ' from this issuer' : ''}. Check back when new inventory is published.</p></div> : <div className="published-offers-grid">
      {offers.map(offer => <article key={offer.id} className="details-panel">
        <span className="section-label">{offer.company_name || 'Merchant'}</span><h2>{offer.title}</h2>
        <div className="details-price">{formatCurrency(Number(offer.price), currency)}</div>
        <dl className="details-facts"><div><dt>Coupon value</dt><dd>{formatCurrency(Number(offer.value), currency)}</dd></div><div><dt>Launch date</dt><dd>{dateLabel(offer.created_at)}</dd></div><div><dt>Expiry date</dt><dd>{dateLabel(offer.expiry_date)}</dd></div><div><dt>Eligible country</dt><dd>{country.name}</dd></div><div><dt>Availability</dt><dd>{offer.issue_limit == null ? 'Available' : `${Math.max(0, Number(offer.issue_limit) - Number(offer.issued_count ?? 0))} left`}</dd></div></dl>
        <Link className="btn btn-primary" to={`/dashboard/marketplace/coupon/${offer.id}`}>View details &amp; buy</Link>
      </article>)}
    </div>}
  </section>;
}
