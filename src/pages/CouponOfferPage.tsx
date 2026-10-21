import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { StripeElements, StripePaymentElement } from '@stripe/stripe-js';
import { ArrowLeft, ShieldCheck, Wallet, CreditCard, Zap, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { LoadingPage } from '../components/LoadingPage';
import { getCouponOfferDetails, getUserProfileData, purchaseGiftCardOnce } from '../lib/supabase';
import type { CouponOfferDetails } from '../lib/supabase';
import { formatCurrency } from '../lib/exchangeRate';
import { getCountryByCode, getGatewaysForCountry } from '../lib/countries';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { cardBackgroundImage } from '../lib/cardBackgrounds';
import { formatOfferDate, offerUnavailable } from '../lib/couponOffer';
import { useNow } from '../hooks/useNow';
import { abandonCouponPayment, createCouponPayment, getCouponPaymentOptions, getStripe, loadRazorpayScript, openRazorpayCheckout, recoverCouponPayment, verifyPayment } from '../lib/paymentGateway';
import type { CouponPaymentRecovery, GatewayCreateResponse, GatewayPublicConfig, GatewayVerifyResponse, PaymentGateway } from '../lib/paymentGateway';
import './CouponOfferPage.css';

type SavedCheckout = { gateway: PaymentGateway; orderId: string };
const errorMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Please try again.';

export default function CouponOfferPage() {
  const { id = '' } = useParams();
  // Reset all checkout state when navigating between offers.
  return <CouponOffer key={id} id={id} />;
}

function CouponOffer({ id }: { id: string }) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const now = useNow();
  const [details, setDetails] = useState<CouponOfferDetails | null>(null);
  const card = details?.coupon;
  const unavailable = card ? offerUnavailable(card, now) : 'Coupon unavailable.';
  const currency = card?.currency || 'INR';
  const money = (amount: number) => formatCurrency(amount, currency);

  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [availableGateways, setAvailableGateways] = useState<PaymentGateway[]>([]);
  const [gatewayConfig, setGatewayConfig] = useState<Record<string, GatewayPublicConfig>>({});
  const [gateway, setGateway] = useState<PaymentGateway>('razorpay');
  const [optionsError, setOptionsError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [order, setOrder] = useState<GatewayCreateResponse | null>(null);
  const [stripeReady, setStripeReady] = useState(false);
  const elementsRef = useRef<StripeElements | null>(null);
  const stripeContainer = useRef<HTMLDivElement>(null);
  const recoveryKey = `cv_coupon_checkout_${user?.id}_${id}`;
  const [walletRequestId, setWalletRequestId] = useState<string | null>(() => {
    try { const saved=localStorage.getItem(`${recoveryKey}_wallet`); return saved && /^[\da-f-]{36}$/i.test(saved) ? saved : null; } catch { return null; }
  });
  const walletRequest = useRef<string | null>(walletRequestId);
  const [pending, setPending] = useState<SavedCheckout | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recoveryKey) || 'null');
      return saved && ['stripe','razorpay','paypal'].includes(saved.gateway) && typeof saved.orderId === 'string' ? saved : null;
    } catch { return null; }
  });
  const savePending = (saved: SavedCheckout | null) => {
    // A storage failure must never hide a captured payment or allow a second charge.
    try { if (saved) localStorage.setItem(recoveryKey, JSON.stringify(saved)); else localStorage.removeItem(recoveryKey); } catch { /* Webhooks remain authoritative. */ }
    setPending(saved);
  };

  const gateways = useMemo(() => {
    const countryCode = card?.country_code || 'IN';
    const priority = getGatewaysForCountry(countryCode);
    return [...availableGateways].sort((a, b) => {
      const ia = priority.indexOf(a);
      const ib = priority.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [availableGateways, card?.country_code]);

  useEffect(() => {
    let active = true;
    Promise.all([getCouponOfferDetails(id), getUserProfileData(user!.id)]).then(([offer, profile]) => {
      if (!active) return;
      setDetails(offer); setBalance(Number(profile.wallet_balance)); setLoading(false);
    }).catch(error => { if (active) { setLoadError(errorMessage(error)); setLoading(false); } });

    getCouponPaymentOptions().then(options => {
      if (!active) return;
      const cfg = options.config || {};
      setGatewayConfig(cfg);
      const stripeAvailable = !!(cfg.stripe?.publishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);
      const enabled = (options.gateways || []).filter(g => {
        if (g === 'razorpay') return true;
        if (g === 'stripe') return stripeAvailable;
        if (g === 'paypal') return true;
        return false;
      });
      setAvailableGateways(enabled);
      if (enabled.length > 0) {
        setGateway(enabled[0]);
      }
    }).catch(() => { if (active) setOptionsError('Direct payment is temporarily unavailable. You can still pay from your wallet.'); });
    return () => { active = false; };
  }, [id, user]);

  const finish = useCallback((result: Partial<GatewayVerifyResponse>) => {
    if (result.purchaseStatus !== 'issued' && result.purchaseStatus !== 'wallet_credited') throw new Error('Payment verification is pending. Keep this page and verify the same payment.');
    if (result.purchaseStatus === 'issued' && !result.couponId) throw new Error('Coupon confirmation is pending. Verify the same payment.');
    try { localStorage.removeItem(recoveryKey); } catch { /* The saved server result remains idempotent. */ }
    setPending(null); setOrder(null);
    if (result.purchaseStatus === 'issued' && result.couponId) {
      success('Coupon purchased', 'Your coupon is ready in My Cards.');
      navigate(`/my-coupon/${result.couponId}`, { replace: true });
    } else {
      toastError('Payment saved to wallet', result.message || 'The offer changed during checkout. The full payment is in your wallet.');
      navigate('/dashboard/wallet', { replace: true });
    }
  }, [navigate, recoveryKey, success, toastError]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const intent = url.searchParams.get('payment_intent');
    if (!intent || !intent.startsWith('pi_')) return;
    for (const field of ['payment_intent','payment_intent_client_secret','redirect_status']) url.searchParams.delete(field);
    window.history.replaceState(null, '', url.toString());
    // A return URL is only a hint; the server checks ownership, capture and offer binding.
    recoverCouponPayment('stripe', intent).then(result => {
      if (result.state === 'paid') finish(result);
    }).catch(error => toastError('Verify payment', errorMessage(error)));
  }, [finish, toastError]);

  useEffect(() => {
    if (!order?.clientSecret || order.gateway !== 'stripe') return;
    let active = true;
    let element: StripePaymentElement | undefined;
    const pubKey = order.keyId || gatewayConfig.stripe?.publishableKey;
    getStripe(pubKey).then(stripe => {
      if (!active || !stripe || !stripeContainer.current) return;
      const elements = stripe.elements({ clientSecret: order.clientSecret, appearance: { theme: 'night' } });
      const payment = elements.create('payment');
      payment.on('ready', () => { if (active) setStripeReady(true); });
      payment.on('loaderror', () => { if (active) toastError('Payment form unavailable', 'Retry this saved checkout or use wallet payment.'); });
      payment.mount(stripeContainer.current); element = payment; elementsRef.current = elements;
    }).catch(error => { if (active) toastError('Payment form unavailable', errorMessage(error)); });
    return () => { active = false; element?.destroy(); elementsRef.current = null; };
  }, [order, gatewayConfig, toastError]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); } catch (error) { toastError('Checkout', errorMessage(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const resume = async (saved: SavedCheckout): Promise<GatewayCreateResponse | null> => {
    const result = await recoverCouponPayment(saved.gateway, saved.orderId);
    if (result.state === 'paid') { finish(result); return null; }
    if (result.state === 'cancelled') { savePending(null); setOrder(null); return null; }
    if (result.state !== 'resume') throw new Error('Your payment is processing. Verify it again before making another payment.');
    return { success:true,gateway:saved.gateway,orderId:saved.orderId,clientSecret:result.clientSecret,keyId:result.keyId,
      amount:result.amount!,currency:result.currency!,receiptId:'' };
  };

  const directPay = () => run(async () => {
    if (!card) return;
    let next: GatewayCreateResponse | null;
    if (pending) next = await resume(pending);
    else {
      if (unavailable) throw new Error(unavailable);
      next = await createCouponPayment(gateway, card.id, Number(card.price));
      savePending({gateway:next.gateway,orderId:next.orderId});
    }
    if (!next) return;
    setStripeReady(false); setOrder(next);
    if (next.gateway === 'razorpay') {
      await loadRazorpayScript();
      const keyId = next.keyId || gatewayConfig.razorpay?.keyId || import.meta.env.VITE_RAZORPAY_KEY_ID;
      if (!keyId) {
        throw new Error('Razorpay payment gateway is not configured for this environment.');
      }
      let payment;
      try {
        payment = await openRazorpayCheckout({
          keyId,
          orderId: next.orderId,
          amountMinorUnit: next.amount,
          currency: next.currency,
          name: 'CouponVault',
          description: card.title,
          prefillEmail: user?.email,
          theme: '#4f46e5',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('cancelled') || msg.includes('dismiss')) return;
        throw err;
      }
      const result = await verifyPayment('razorpay', payment.razorpay_order_id, payment.razorpay_payment_id, payment.razorpay_signature);
      finish(result);
    }
  });

  const payStripe = () => run(async () => {
    const pubKey = order?.keyId || gatewayConfig.stripe?.publishableKey;
    const stripe = await getStripe(pubKey);
    if (!stripe || !elementsRef.current || !order) throw new Error('The payment form is not ready.');
    const result = await stripe.confirmPayment({elements:elementsRef.current,confirmParams:{return_url:`${window.location.origin}/dashboard/marketplace/coupon/${id}`},redirect:'if_required'});
    if (result.error) throw new Error(result.error.message || 'Payment was not completed.');
    const verified = await recoverCouponPayment('stripe',order.orderId);
    if (verified.state === 'paid') finish(verified);
    else throw new Error('Payment is processing. Use Verify payment before trying again.');
  });

  const cancelDirect = () => run(async () => {
    if (!pending) return;
    const result: CouponPaymentRecovery = await abandonCouponPayment(pending.gateway,pending.orderId);
    if (result.state === 'paid') { finish(result); return; }
    savePending(null); setOrder(null); setStripeReady(false);
    success('Direct checkout cancelled', 'Any payment that arrives later will be kept in your wallet.');
  });

  const walletPay = () => run(async () => {
    if (!card || !user || (!walletRequest.current && unavailable) || pending) return;
    const key = `${recoveryKey}_wallet`;
    if (!walletRequest.current) {
      const saved = localStorage.getItem(key);
      walletRequest.current = saved && /^[\da-f-]{36}$/i.test(saved) ? saved : crypto.randomUUID();
      localStorage.setItem(key, walletRequest.current);
      setWalletRequestId(walletRequest.current);
    }
    let result: {coupon_id: string; order_id: string};
    try {
      result = await purchaseGiftCardOnce(card.id,Number(card.price),walletRequest.current);
    } catch(error) {
      // A database rejection rolled back the purchase. Network failures retain the same request ID.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P0001') {
        localStorage.removeItem(key); walletRequest.current=null; setWalletRequestId(null);
      }
      throw error;
    }
    try { localStorage.removeItem(key); } catch { /* Do not conceal a confirmed purchase. */ }
    success('Coupon purchased','Your wallet payment is complete.');
    navigate(`/my-coupon/${result.coupon_id}`, {replace:true});
  });

  if (loading) return <LoadingPage message="Loading coupon details…" />;
  if (loadError || !details || !card) return <section className="coupon-offer-page"><Link to="/dashboard/marketplace" className="btn btn-secondary">Back to marketplace</Link><div className="card offer-section"><h1>Coupon unavailable</h1><p role="alert">{loadError || 'This coupon is not available for your country, or has been removed.'}</p><button className="btn btn-secondary" onClick={() => window.location.reload()}>Try again</button></div></section>;

  return (
    <PayPalScriptProvider
      key={currency}
      options={{
        clientId: gatewayConfig.paypal?.clientId || import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test',
        currency: currency,
        intent: 'capture',
      }}
      deferLoading={!currency || ['INR', 'AED'].includes(currency)}
    >
      <section className="coupon-offer-page">
    <Link to="/dashboard/marketplace" className="offer-back"><ArrowLeft size={17} /> Back to marketplace</Link>
    <header className="offer-hero" style={{backgroundImage:cardBackgroundImage(card.banner_image,true)}}>
      <span className="section-label">{details.company.name}</span><h1>{card.title}</h1><p>{money(card.price)} <span>· Coupon value {money(card.value)}</span></p>
    </header>
    <div className="offer-columns">
      <div className="offer-content">
        <section className="card offer-section"><span className="section-label">About the company</span><h2>{details.company.name}</h2><dl className="offer-facts"><div><dt>Company status</dt><dd>Approved merchant</dd></div><div><dt>On CouponVault since</dt><dd>{formatOfferDate(details.company.joined_at)}</dd></div></dl><h3>Business address</h3><p>{details.company.address || 'The company has not provided a public business address.'}</p><p className="offer-note">This offer is published by {details.company.name}. Redemption is subject to the company’s terms below.</p></section>
        <section className="card offer-section"><h2>Coupon details</h2><p className="offer-prewrap">{card.description || 'No additional description has been provided.'}</p><h3>Terms & conditions</h3><p className="offer-prewrap">{card.terms || 'No additional terms have been published. Contact support before buying if you need clarification.'}</p><h3>How to use</h3><p>After purchase, open My Cards to view your coupon and QR code. Redeem it with the issuing company before expiry. Only users registered in {getCountryByCode(card.country_code || '')?.name || card.country_code} can buy and redeem this offer.</p></section>
      </div>
      <aside className="card offer-section offer-checkout"><span className="section-label">Your coupon</span><h2>{card.title}</h2><div className="offer-price">{money(card.price)}</div><p className="offer-note">One coupon · No currency conversion</p>
        <dl className="offer-facts"><div><dt>Coupon value</dt><dd>{money(card.value)}</dd></div><div><dt>Launch date</dt><dd>{formatOfferDate(card.created_at)}</dd></div><div><dt>Expiry date</dt><dd>{formatOfferDate(card.expiry_date)}</dd></div><div><dt>Available count</dt><dd>{card.available_count.toLocaleString()} coupons</dd></div><div><dt>Eligible country</dt><dd>{getCountryByCode(card.country_code || '')?.name || card.country_code}</dd></div></dl>
        {unavailable && <p role="status" className="offer-warning">{unavailable}</p>}
        {!checkoutOpen && !pending && !walletRequestId ? <button className="btn btn-primary offer-wide" disabled={!!unavailable} onClick={() => setCheckoutOpen(true)}>Buy coupon</button> : <div className="offer-payment-choices">
          <h3>Choose how to pay</h3><div className="offer-wallet"><Wallet size={19}/><span>Wallet balance <strong>{money(balance)}</strong></span></div>
          <button className="btn btn-primary offer-wide" disabled={busy || !!pending || (!walletRequestId && (!!unavailable || balance < card.price))} onClick={() => void walletPay()}>{walletRequestId ? 'Verify wallet purchase' : `Pay from wallet · ${money(card.price)}`}</button>
          {walletRequestId && <p className="offer-note" role="status">A wallet purchase needs confirmation. Verify it before starting another payment.</p>}
          {balance < card.price && <p className="offer-note">Your wallet balance is too low. Choose direct payment or <Link to="/dashboard/wallet">add funds</Link>.</p>}
          <div className="offer-divider"><CreditCard size={17}/> Direct payment</div>
          {optionsError && <p className="offer-warning">{optionsError}</p>}
          {!pending && gateways.length > 1 && (
            <div className="offer-gateway-picker">
              <span className="offer-picker-label">Select payment method</span>
              <div className="offer-gateway-grid">
                {gateways.map(g => (
                  <button
                    key={g}
                    type="button"
                    disabled={busy}
                    className={`offer-gateway-option ${gateway === g ? 'active' : ''}`}
                    onClick={() => {
                      if (gateway !== g) {
                        setGateway(g);
                        setOrder(null);
                        setStripeReady(false);
                      }
                    }}
                  >
                    <div className="offer-gw-content">
                      <span className="offer-gw-title">
                        {g === 'razorpay' ? 'Razorpay' : g === 'stripe' ? 'Stripe' : 'PayPal'}
                      </span>
                      <span className="offer-gw-subtitle">
                        {g === 'razorpay' ? 'UPI · Cards · NetBanking' : g === 'stripe' ? 'Credit & Debit Cards' : 'PayPal Account / Cards'}
                      </span>
                    </div>
                    {gateway === g && <span className="offer-gw-badge">Selected</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!pending && gateways.length === 1 && (
            <div className="offer-provider-badge">
              <Zap size={14} />
              <span>Paying with <strong>{gateway === 'razorpay' ? 'Razorpay (UPI, Cards, NetBanking)' : gateway === 'stripe' ? 'Stripe (Cards)' : 'PayPal'}</strong></span>
            </div>
          )}
          {!pending && gateways.length === 0 && !optionsError && (
            <div className="offer-direct-unavail">
              <p className="offer-note">
                Direct payment is not configured for this account. Wallet payment is available.
              </p>
              {balance < card.price && (
                <Link to="/dashboard/wallet" className="btn btn-secondary offer-wide" style={{marginTop: '0.6rem'}}>
                  Top up wallet to buy
                </Link>
              )}
            </div>
          )}
          {pending && <p className="offer-note" role="status">You have a saved checkout. Resume or verify this payment before paying again.</p>}
          {!pending && gateway === 'paypal' && !['INR', 'AED'].includes(currency) && (
            <div className="offer-paypal-box" style={{ marginTop: '0.75rem' }}>
              <PayPalButtons
                style={{ layout: "vertical", color: "blue", shape: "rect", label: "pay" }}
                disabled={busy || !card || !!unavailable}
                createOrder={async () => {
                  if (!card) throw new Error('Offer unavailable.');
                  const next = await createCouponPayment('paypal', card.id, Number(card.price));
                  savePending({ gateway: 'paypal', orderId: next.orderId });
                  setOrder(next);
                  return next.orderId;
                }}
                onApprove={async (data) => {
                  setBusy(true);
                  try {
                    const result = await recoverCouponPayment('paypal', data.orderID);
                    if (result.state === 'paid') {
                      finish(result);
                    } else {
                      toastError('Payment verification pending', 'Please click "Verify payment" to confirm your order.');
                    }
                  } catch (err: unknown) {
                    toastError('Payment pending', errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
                onError={(err) => {
                  toastError('PayPal payment failed', errorMessage(err) || 'Payment was not confirmed. Please retry.');
                }}
              />
            </div>
          )}
          {gateways.length > 0 && (pending || gateway !== 'paypal') && (!order || order.gateway !== 'stripe' || gateway !== 'stripe') && (
            <button
              className="btn btn-secondary offer-wide offer-direct-btn"
              disabled={busy || !!walletRequestId || (!pending && (!!unavailable || !gateways.length))}
              onClick={() => void directPay()}
            >
              {busy ? (
                <span className="offer-btn-loading">
                  <RefreshCw size={15} className="spin" /> Please wait…
                </span>
              ) : pending ? (
                'Resume direct payment'
              ) : gateway === 'razorpay' ? (
                `Pay with Razorpay · ${money(card.price)}`
              ) : (
                `Pay with Card (Stripe) · ${money(card.price)}`
              )}
            </button>
          )}
          {gateway === 'stripe' && order?.gateway === 'stripe' && (
            <div>
              <div ref={stripeContainer} className="offer-stripe"/>
              <button className="btn btn-primary offer-wide" disabled={busy || !stripeReady} onClick={() => void payStripe()}>
                {busy ? 'Verifying payment…' : `Pay ${money(order.amount / 100)}`}
              </button>
            </div>
          )}
          {pending && <><button className="btn btn-secondary offer-wide" disabled={busy} onClick={() => void run(async () => {const result = await recoverCouponPayment(pending.gateway,pending.orderId);if (result.state === 'paid') finish(result); else if(result.state === 'cancelled'){savePending(null);setOrder(null);}else toastError('Payment not completed','Resume your saved checkout, or verify again if payment is processing.');})}>Verify payment</button><button className="btn btn-secondary offer-wide" disabled={busy} onClick={() => void cancelDirect()}>Cancel direct checkout</button><p className="offer-note">If a delayed payment arrives after cancellation, it will be kept in your wallet.</p></>}
          <p className="offer-note">If this offer sells out or changes during payment, the full amount will be saved to your wallet. We never issue a different coupon automatically.</p>
        </div>}
        <p className="offer-trust"><ShieldCheck size={17}/> Payments are verified securely before a coupon is issued.</p>
      </aside>
    </div>
  </section>
  </PayPalScriptProvider>
  );
}
