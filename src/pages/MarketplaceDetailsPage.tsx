import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { LoadingPage } from '../components/LoadingPage';
import { getCatalogueBrand, getBrandOffers, getOfferUnavailableReason } from '../lib/brandCatalog';
import { getGiftCards, getUserProfileData, purchaseGiftCard } from '../lib/supabase';
import type { GiftCard } from '../lib/supabase';
import { getCountryByCode } from '../lib/countries';
import { formatCurrency } from '../lib/exchangeRate';
import { useNow } from '../hooks/useNow';
import '../styles/marketplace.css';

type Profile = Awaited<ReturnType<typeof getUserProfileData>>;
function dateLabel(value?: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not announced';
}
function messageOf(error: unknown) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'Please try again shortly.';
}

export default function MarketplaceDetailsPage() {
  const { brandSlug, offerId } = useParams<{ brandSlug?: string; offerId?: string }>();
  const [revision, setRevision] = useState(0);
  return <DetailsContent key={`${brandSlug ?? offerId}:${revision}`} brandSlug={brandSlug} offerId={offerId} onRetry={() => setRevision(value => value + 1)} />;
}

function DetailsContent({ brandSlug, offerId, onRetry }: { brandSlug?: string; offerId?: string; onRetry: () => void }) {
  const { user } = useAuth();
  const userId = user?.id;
  const navigate = useNavigate();
  const { success } = useToast();
  const now = useNow();
  const [data, setData] = useState<{ offers: GiftCard[]; profile: Profile } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const [busy, setBusy] = useState(false);
  const purchasing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const brand = getCatalogueBrand(brandSlug);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void Promise.all([getGiftCards(), getUserProfileData(userId)]).then(([offers, profile]) => {
      if (!cancelled) setData({ offers, profile });
    }).catch(error => { if (!cancelled) setLoadError(messageOf(error)); });
    return () => { cancelled = true; };
  }, [userId]);

  const back = <Link className="details-back" to="/dashboard/marketplace"><ArrowLeft size={16} /> Back to marketplace</Link>;
  if (brandSlug && !brand) return <section className="marketplace-details">{back}<h1>Brand not found</h1><p>Choose a brand from the marketplace.</p></section>;
  if (loadError) return <section className="marketplace-details">{back}<div className="details-panel" role="alert"><h1>Could not load coupon details</h1><p>{loadError}</p><button className="btn btn-primary" onClick={onRetry}>Try again</button></div></section>;
  if (!data) return <LoadingPage message="Loading coupon details..." />;

  const { profile, offers } = data;
  const brandOffers = brand ? getBrandOffers(brand, offers).filter(offer => offer.country_code === profile.country_code) : [];
  const offer = offerId ? offers.find(item => item.id === offerId) : brandOffers.find(item => item.id === selectedId) ?? brandOffers[0];
  if (offerId && !offer) return <section className="marketplace-details">{back}<div className="details-panel"><h1>Coupon unavailable</h1><p>This coupon could not be found or is no longer available to your account.</p></div></section>;

  const country = profile.country_code ? getCountryByCode(profile.country_code) : null;
  const currency = country?.currency ?? profile.currency ?? 'USD';
  const offerCountry = offer?.country_code ? getCountryByCode(offer.country_code) : null;
  const offerCurrency = offer?.currency ?? offerCountry?.currency ?? currency;
  const title = offer?.title ?? `${brand?.name ?? 'Brand'} coupon`;
  const companyName = offer?.company_name ?? brand?.name ?? 'Merchant';
  const unavailable = offer ? getOfferUnavailableReason(offer, profile.country_code, now) ?? (offerCurrency !== currency ? 'This coupon currency does not match your wallet.' : null) : 'This is a catalogue preview. No purchasable coupon has been published for your country yet.';
  const insufficient = !!offer && Number(profile.wallet_balance) < Number(offer.price);
  const canBuy = !!offer && !unavailable && !insufficient && !purchaseError;
  const remaining = offer?.issue_limit != null ? Math.max(0, Number(offer.issue_limit) - Number(offer.issued_count ?? 0)) : null;

  async function confirmPurchase() {
    if (!offer || !user || !canBuy || purchasing.current) return;
    purchasing.current = true; setBusy(true);
    try {
      await purchaseGiftCard(offer.id, user.id, user.email ?? '', offer.price);
      dialog.current?.close();
      success('Coupon purchased', 'Your coupon is ready in My Cards.');
      navigate('/dashboard/cards');
    } catch (error) {
      dialog.current?.close();
      setPurchaseError(`${messageOf(error)} Check My Cards and your wallet before trying again.`);
    } finally { purchasing.current = false; setBusy(false); }
  }

  return <section className="marketplace-details">
    {back}
    <div className="details-hero" style={brand ? { background: `linear-gradient(125deg, ${brand.color}, #17233b)` } : undefined}>
      <span className="brand-preview-pill">{offer ? 'Coupon details' : 'Brand preview'}</span>
      <h1>{brand?.name ?? companyName}</h1>
      <p>{brand?.category ?? 'Discover your next gift. Review the details, then purchase securely with your wallet.'}</p>
    </div>
    <div className="details-grid">
      <div className="details-panel">
        <span className="section-label">ABOUT THE COMPANY</span>
        <h2 style={{ marginTop: '.65rem' }}>{companyName}</h2>
        <p>{brand?.description ?? `This coupon is listed by ${companyName}. Review the coupon's value, validity and issuer terms before purchasing.`}</p>
        <h3>Coupon details</h3>
        <p>{offer?.description || `The ${brand?.name} catalogue is ready to explore. Pricing, launch date, expiry and redemption terms will appear here when an offer is published.`}</p>
        {brandOffers.length > 1 && <label className="label" htmlFor="coupon-variant">Choose a coupon<select id="coupon-variant" className="input" value={offer?.id ?? ''} onChange={event => { setSelectedId(event.target.value); setPurchaseError(''); }}>{brandOffers.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        <h3>How it works</h3>
        <p>{offer ? 'Buy with your wallet, find the issued coupon in My Cards, and follow the issuer’s redemption instructions. Only users registered in the coupon’s country can purchase and redeem it.' : 'This preview cannot be purchased or redeemed. A published offer will include its eligible country, confirmed price and redemption instructions.'}</p>
        <h3>Terms & conditions</h3>
        <p>{offer?.terms || (offer ? 'No additional terms have been supplied by the issuer. Contact support if you need clarification before purchasing.' : 'Offer terms have not been announced. Brand names are used for discovery and do not imply a partnership or an issued gift card.')}</p>
      </div>
      <aside className="details-panel" aria-label="Coupon purchase details">
        <span className="section-label">{offer ? 'PUBLISHED OFFER' : 'CATALOGUE PREVIEW'}</span>
        <h2 style={{ marginTop: '.65rem' }}>{title}</h2>
        <div className="details-price">{offer ? formatCurrency(Number(offer.price), offerCurrency) : 'Not available yet'}</div>
        <p>{offer ? 'One coupon · Pay from your wallet' : 'Price will be announced with the offer.'}</p>
        <dl className="details-facts">
          <div><dt>Coupon value</dt><dd>{offer ? formatCurrency(Number(offer.value), offerCurrency) : 'Not announced'}</dd></div>
          <div><dt>Launch date</dt><dd>{dateLabel(offer?.created_at)}</dd></div>
          <div><dt>Expiry date</dt><dd>{dateLabel(offer?.expiry_date)}</dd></div>
          <div><dt>Eligible country</dt><dd>{offerCountry?.name ?? 'Not announced'}</dd></div>
          <div><dt>Availability</dt><dd>{offer ? unavailable ? 'Unavailable' : remaining == null ? 'Available' : `${remaining} left` : 'Preview only'}</dd></div>
        </dl>
        {unavailable && <div className="details-callout" role="status">{unavailable}</div>}
        {offer && <p>Wallet balance: <strong>{formatCurrency(profile.wallet_balance, currency)}</strong>. Amounts are never converted.</p>}
        {insufficient && !unavailable && <p>Add funds to your wallet before purchasing this coupon. <Link to="/dashboard/wallet">Open wallet</Link></p>}
        {purchaseError && <div className="details-callout" role="alert">{purchaseError} <Link to="/dashboard/cards">View My Cards</Link></div>}
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={!canBuy || busy} onClick={() => dialog.current?.showModal()}>Buy coupon{offer && !unavailable ? ` · ${formatCurrency(Number(offer.price), offerCurrency)}` : ''}</button>
        <p style={{ display: 'flex', gap: '.5rem', alignItems: 'center', fontSize: '.78rem', marginTop: '1rem' }}><ShieldCheck size={16} />{offer ? 'Secure wallet checkout. Country eligibility applies.' : 'No payment is collected for previews.'}</p>
      </aside>
    </div>
    {offer && <dialog ref={dialog} className="details-checkout" aria-labelledby="checkout-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="checkout-title">Confirm your purchase</h2><p>{title}</p>
      <dl className="details-facts"><div><dt>Coupon value</dt><dd>{formatCurrency(Number(offer.value), offerCurrency)}</dd></div><div><dt>Total to pay</dt><dd>{formatCurrency(Number(offer.price), offerCurrency)}</dd></div></dl>
      <p>This amount will be deducted from your wallet. Your coupon will appear in My Cards.</p>
      <div className="details-checkout-actions"><button className="btn btn-secondary" disabled={busy} onClick={() => dialog.current?.close()}>Cancel</button><button className="btn btn-primary" disabled={!canBuy || busy} onClick={() => void confirmPurchase()}>{busy ? 'Purchasing…' : 'Confirm and pay'}</button></div>
    </dialog>}
  </section>;
}
