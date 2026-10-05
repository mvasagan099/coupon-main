import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle, Gamepad2, Ticket, Wallet } from 'lucide-react';
import { isSupabaseConfigured, redeemCouponAmount, validateCoupon } from '../lib/supabase';
import type { CouponValidation } from '../lib/supabase';

type Experience = 'lottery' | 'gaming';
interface Offer { id: string; name: string; price: number; description: string; badge: string }

const experiences = {
  lottery: {
    title: 'Lottery', eyebrow: 'A little anticipation. A new possibility.',
    description: 'Explore lottery coupon options and try the redemption flow with your CouponVault balance.',
    Icon: Ticket, other: 'Gaming Hub', otherPath: '/gaming-hub',
    offers: [
      { id: 'single', name: 'Single Entry', price: 100, description: 'Try the coupon flow with one sample entry.', badge: 'Start here' },
      { id: 'triple', name: 'Triple Entry', price: 250, description: 'A sample bundle of three lottery entries.', badge: 'Bundle' },
      { id: 'five', name: 'Five Entry Pack', price: 400, description: 'Explore a larger sample entry bundle.', badge: 'More to explore' },
    ],
  },
  gaming: {
    title: 'Gaming Hub', eyebrow: 'Your next session starts here.',
    description: 'Explore gaming passes and use your CouponVault balance to try the redemption flow.',
    Icon: Gamepad2, other: 'Lottery', otherPath: '/lottery',
    offers: [
      { id: 'arcade', name: 'Arcade Pass', price: 100, description: 'A sample pass for a quick arcade session.', badge: 'Quick play' },
      { id: 'console', name: 'Console Session', price: 250, description: 'A sample pass for your next console session.', badge: 'Level up' },
      { id: 'group', name: 'Squad Pass', price: 500, description: 'A sample gaming bundle for playing together.', badge: 'Play together' },
    ],
  },
} satisfies Record<Experience, { title: string; eyebrow: string; description: string; Icon: typeof Ticket; other: string; otherPath: string; offers: Offer[] }>;

const money = (amount: number) => `₹${amount.toFixed(2)}`;

function checkCoupon(coupon: CouponValidation) {
  const status = coupon.status?.toLowerCase();
  if (coupon.is_used || status === 'redeemed') throw new Error('This coupon has already been fully used.');
  if (status !== 'active') throw new Error('This coupon is not active.');
  if (coupon.expiry_date && new Date(coupon.expiry_date).getTime() <= Date.now()) throw new Error('This coupon has expired.');
  if (!Number.isFinite(Number(coupon.remaining_balance)) || Number(coupon.remaining_balance) <= 0) throw new Error('This coupon has no available balance.');
}

export default function CouponExperiencePage({ experience }: { experience: Experience }) {
  const config = experiences[experience];
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${config.title} | CouponVault`;
    return () => { document.title = previousTitle; };
  }, [config.title]);
  const [selected, setSelected] = useState<Offer>(config.offers[0]);
  const [code, setCode] = useState('');
  const [coupon, setCoupon] = useState<CouponValidation | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'apply' | 'redeem' | null>(null);
  const [receipt, setReceipt] = useState<{ name: string; amount: number; remaining: number } | null>(null);
  const pending = useRef(false);
  const Icon = config.Icon;
  const canRedeem = coupon && Number(coupon.remaining_balance) >= selected.price;

  async function applyCoupon() {
    if (!code.trim() || pending.current) return;
    pending.current = true;
    setBusy('apply');
    setError('');
    setCoupon(null);
    try {
      if (!isSupabaseConfigured) throw new Error('Coupon redemption is unavailable until the site is connected to Supabase.');
      const result = await validateCoupon(code.trim());
      checkCoupon(result);
      setCoupon(result);
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to validate this coupon. Please try again.');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  async function redeem() {
    if (!coupon || !canRedeem || pending.current) return;
    pending.current = true;
    setBusy('redeem');
    setError('');
    try {
      const latest = await validateCoupon(coupon.coupon_code);
      checkCoupon(latest);
      setCoupon(latest);
      if (Number(latest.remaining_balance) < selected.price) throw new Error('Your coupon balance has changed. Choose a lower-priced option or another coupon.');
      const result = await redeemCouponAmount(latest.coupon_id, selected.price, { allowFallback: false });
      setReceipt({ name: selected.name, amount: selected.price, remaining: Number(result.remaining_balance) });
      setCoupon(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Redemption could not be confirmed. Check your coupon balance before trying again.');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <div className={`coupon-experience coupon-experience--${experience} fade-in`}>
      <section className="experience-hero">
        <div>
          <p className="experience-eyebrow">{config.eyebrow}</p>
          <h1>{config.title}<span>Powered by your coupons.</span></h1>
          <p className="experience-description">{config.description}</p>
          <Link to={config.otherPath} className="experience-other">Explore {config.other} <ArrowRight size={17} /></Link>
        </div>
        <div className="experience-art" aria-hidden="true"><Icon size={112} strokeWidth={1.2} /><span>COUPON VAULT</span></div>
      </section>

      <p className="experience-demo-note"><strong>Demo offers.</strong> No lottery entry, prize, or playable game is issued. Confirming redemption deducts the displayed amount from your coupon balance.</p>

      {receipt ? (
        <section className="experience-receipt" aria-live="polite">
          <CheckCircle size={44} />
          <h2>Coupon redemption confirmed</h2>
          <p>{receipt.name} · {money(receipt.amount)} redeemed</p>
          <p>Remaining coupon balance: <strong>{money(receipt.remaining)}</strong></p>
          <p>This completes the demo redemption only.</p>
          <button className="btn btn-primary" onClick={() => { setReceipt(null); setError(''); }}>Explore more options</button>
          <Link to="/dashboard/cards">View my coupons</Link>
        </section>
      ) : (
        <div className="experience-content">
          <section aria-labelledby="experience-offers">
            <div className="experience-section-title"><span>01 / CHOOSE</span><h2 id="experience-offers">Find your next experience</h2></div>
            <div className="experience-offers">
              {config.offers.map(offer => (
                <button key={offer.id} className={`experience-offer ${selected.id === offer.id ? 'is-selected' : ''}`} aria-pressed={selected.id === offer.id} disabled={!!busy} onClick={() => { setSelected(offer); setError(''); }}>
                  <div className="experience-offer-top"><span>{offer.badge}</span><Icon size={24} /></div>
                  <h3>{offer.name}</h3><p>{offer.description}</p>
                  <div className="experience-offer-bottom"><strong>{money(offer.price)}</strong><span>{selected.id === offer.id ? 'Selected ✓' : 'Select →'}</span></div>
                </button>
              ))}
            </div>
          </section>

          <section className="experience-checkout" aria-labelledby="experience-checkout">
            <div className="experience-section-title"><span>02 / REDEEM</span><h2 id="experience-checkout">Use your coupon</h2></div>
            <div className="experience-summary"><span>{selected.name}</span><strong>{money(selected.price)}</strong></div>
            {!coupon ? (
              <form onSubmit={event => { event.preventDefault(); void applyCoupon(); }}>
                <label htmlFor="experience-code">Coupon code</label>
                <div className="experience-code-row"><input id="experience-code" autoComplete="off" placeholder="Enter your coupon code" value={code} disabled={!!busy} onChange={event => setCode(event.target.value.toUpperCase())} /><button className="btn btn-secondary" disabled={!!busy || !code.trim()}>{busy === 'apply' ? 'Checking…' : 'Apply'}</button></div>
              </form>
            ) : (
              <div className="experience-applied"><Wallet size={20} /><div><strong>{coupon.coupon_code}</strong><span>Available: {money(Number(coupon.remaining_balance))}</span></div><button disabled={!!busy} onClick={() => { setCoupon(null); setError(''); }}>Remove</button></div>
            )}
            {error && <p className="experience-error" role="alert">{error}</p>}
            {coupon && !canRedeem && <p className="experience-error" role="status">This option needs {money(selected.price - Number(coupon.remaining_balance))} more. Choose a lower-priced option or use another coupon.</p>}
            <div className="experience-summary experience-total"><span>Coupon debit</span><strong>{money(selected.price)}</strong></div>
            <button className="btn btn-primary experience-redeem" disabled={!canRedeem || !!busy} onClick={() => void redeem()}>{busy === 'redeem' ? 'Redeeming…' : `Confirm demo redemption · ${money(selected.price)}`}</button>
            <p className="experience-help">Apply a coupon that covers the full amount. Any unused balance stays on the coupon.</p>
            <Link to="/dashboard/cards" className="experience-wallet-link">Find my coupons <ArrowRight size={14} /></Link>
          </section>
        </div>
      )}
    </div>
  );
}
