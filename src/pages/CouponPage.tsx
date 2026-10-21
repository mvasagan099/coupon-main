import { useParams, useNavigate } from "react-router-dom";
import { formatCurrency } from '../lib/exchangeRate';
import { getCountryByCode } from '../lib/countries';
import { formatOfferDate } from '../lib/couponOffer';
import { QRCode } from "react-qr-code";
import { useAuth } from "../context/AuthContext";
import { getUserOrders, supabase } from "../lib/supabase";
import { useState, useEffect } from "react";
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

function getDestinationMetaSafe(dest?: string | null) {
  if (!dest) return null;
  const map: Record<string, { label: string; shortLabel: string; icon: string; badgeClass: string }> = {
    gaming: { label: 'Gaming Application', shortLabel: 'Gaming App Only', icon: '🎮', badgeClass: 'badge-purple' },
    lottery: { label: 'Lottery Application', shortLabel: 'Lottery App Only', icon: '🎰', badgeClass: 'badge-amber' },
    couponvault: { label: 'CouponVault Store', shortLabel: 'CouponVault Store', icon: '🛍️', badgeClass: 'badge-green' },
  };
  return map[dest.toLowerCase()] ?? null;
}

export default function CouponPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const couponUrl = order ? `${window.location.origin}/coupon/${order.coupon_id}` : '';

  useEffect(() => {
    let channel: any = null;

    async function load() {
      if (!user || !id) return;
      try {
        const orders = await getUserOrders(user.id);
        const foundOrder = orders.find((o) => o.coupon_id === id) ?? null;
        setOrder(foundOrder);

        // Subscribe to real-time changes on the coupon if it is currently valid (not used)
        if (foundOrder && foundOrder.coupon && !foundOrder.coupon.is_used) {
          channel = supabase
            .channel(`coupon-realtime-${foundOrder.coupon_id}`)
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "coupons",
                filter: `id=eq.${foundOrder.coupon_id}`
              },
              (payload: any) => {
                if (payload.new) {
                  setOrder((prev: any) => {
                    if (!prev) return prev;
                    return {
                      ...prev,
                      coupon: {
                        ...prev.coupon,
                        is_used: payload.new.is_used,
                        remaining_balance: payload.new.remaining_balance,
                        status: payload.new.status
                      }
                    };
                  });
                }
              }
            )
            .subscribe();
        }
      } finally {
        setLoading(false);
      }
    }
    load();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [user, id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '6rem 0', gap: '0.75rem' }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  if (!order) {
    return (
      <div style={{ maxWidth: '400px', margin: '4rem auto', textAlign: 'center' }}>
        <div className="glass-card-strong" style={{ padding: '3.5rem 2rem', border: '1px solid var(--red-border)' }}>
          <div style={{
            width: '60px', height: '60px', background: 'var(--red-muted)', borderRadius: '50%',
            margin: '0 auto 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--red-border)', boxShadow: '0 0 15px rgba(239, 68, 68, 0.1)'
          }}>
            <svg width="26" height="26" fill="none" viewBox="0 0 24 24" style={{ color: 'var(--red)' }}>
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-1)', margin: '0 0 0.5rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Ticket Not Found</h2>
          <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', margin: '0 0 1.75rem', fontWeight: 500, lineHeight: 1.5 }}>This coupon either does not exist or does not belong to your active account profile.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard')}>← Back to Wallet</button>
        </div>
      </div>
    );
  }

  const isUsed = order.coupon?.is_used;
  const currency = getCountryByCode(order.coupon?.country_code || '')?.currency;
  const money = (amount: number) => currency ? formatCurrency(Number(amount),currency) : `${Number(amount).toFixed(2)} (currency unavailable)`;

  const couponCode = order.coupon?.code || (order.coupon_id ? `CPN-${order.coupon_id.substring(0, 8).toUpperCase()}` : '');
  const maskedCode = '*'.repeat(Math.min(Math.max((couponCode.length || 12), 10), 16));

  const copyCode = async () => {
    if (!couponCode) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(couponCode);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = couponCode;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      setCopied(true);
      setShowCode(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '0 auto' }} className="fade-in">
        {/* Back navigation */}
        <button
          onClick={() => navigate('/dashboard')}
          className="btn btn-secondary btn-sm"
          style={{
            background: 'none', border: 'none', color: 'var(--text-3)',
            boxShadow: 'none', marginBottom: '1.5rem', padding: 0, fontWeight: 700
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-1)'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'var(--text-3)'}
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" style={{ marginRight: '0.25rem' }}>
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to Wallet
        </button>

        {/* Coupon Ticket */}
        <div className="glass-card-strong coupon-ticket" style={{ 
          overflow: 'hidden', 
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          borderRadius: '24px'
        }}>
          
          {/* Header strip with Brand Banner */}
          <div style={{
            background: isUsed ? 'var(--bg-3)' : 'var(--amber-gradient)', 
            padding: '2rem 1.75rem',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Background texture for the header */}
            <div style={{ 
              position: 'absolute', inset: 0, opacity: 0.1, 
              backgroundImage: 'radial-gradient(circle at 2px 2px, #000 1px, transparent 0)',
              backgroundSize: '12px 12px'
            }} />

            <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: isUsed ? 'var(--text-4)' : 'var(--text-1)', opacity: 0.7, marginBottom: '0.4rem' }}>
                  OFFICIAL MERCHANT VOUCHER
                </p>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: isUsed ? 'var(--text-3)' : 'var(--text-1)', margin: 0, letterSpacing: '0.02em', wordSpacing: '0.08em', lineHeight: 1 }}>
                  {order.company?.name}
                </h2>
                
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                   {order.coupon?.amount != null && (
                     <span style={{ fontSize: '0.8rem', color: isUsed ? 'var(--text-4)' : 'var(--text-3)', fontWeight: 600 }}>
                       Face Value: {money(order.coupon.amount)}
                     </span>
                   )}
                   <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>Paid: {money(order.amount)} · Expires: {formatOfferDate(order.coupon?.expiry_date)}</span>
                   <span style={{ fontSize: '1.4rem', fontWeight: 900, color: isUsed ? 'var(--text-4)' : 'var(--cyan)' }}>
                      Available: {money(order.coupon?.remaining_balance ?? 0)}
                   </span>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                   <span style={{ background: 'rgba(0,0,0,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800, color: isUsed ? 'var(--text-4)' : 'var(--text-2)' }}>
                     SECURE NODE: {order.company?.prefix}
                   </span>
                   <span style={{ background: 'rgba(0,0,0,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800, color: isUsed ? 'var(--text-4)' : 'var(--text-2)' }}>
                     ID: {id?.substring(0,8).toUpperCase()}
                   </span>
                   {(() => {
                     const destMeta = getDestinationMetaSafe(order.coupon?.redemption_destination);
                     return destMeta ? (
                       <span className={`badge ${destMeta.badgeClass}`} style={{ fontSize: '0.62rem', padding: '0.15rem 0.45rem' }}>
                         {destMeta.icon} {destMeta.shortLabel}
                       </span>
                     ) : (
                       <span className="badge badge-amber" style={{ fontSize: '0.62rem', padding: '0.15rem 0.45rem' }}>
                         ⚠️ Unclassified
                       </span>
                     );
                   })()}
                </div>
              </div>

              {order.company?.logo_url && (
                <div style={{ width: '56px', height: '56px', borderRadius: '12px', background: '#fff', padding: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  <img src={order.company.logo_url} alt={`${order.company?.name ?? 'Company'} logo`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }} />
                </div>
              )}
            </div>
          </div>

          {/* Perforation Effect with "Cut" lines */}
          <div style={{ display: 'flex', alignItems: 'center', height: '32px', position: 'relative', background: 'var(--bg-2)' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg)', marginLeft: '-16px', border: '1px solid var(--border)', zIndex: 2 }} />
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '8px', opacity: 0.3 }}>
              {Array.from({ length: 20 }).map((_, i) => (
                <div key={i} style={{ width: '4px', height: '2px', background: 'var(--text-4)' }} />
              ))}
            </div>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg)', marginRight: '-16px', border: '1px solid var(--border)', zIndex: 2 }} />
          </div>

          {/* QR section with "Shadow" depth */}
          <div style={{ padding: '2rem 1.75rem 2.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.4rem', background: 'var(--bg-2)' }}>

            {/* Voucher Code Reveal & Copy Box */}
            {couponCode && (
              <div
                style={{
                  width: '100%',
                  maxWidth: '300px',
                  background: 'var(--surface-soft)',
                  border: '1.5px solid var(--border)',
                  borderRadius: '16px',
                  padding: '0.75rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.5rem',
                  boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04)',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-4)', letterSpacing: '0.12em' }}>
                    Coupon Code
                  </span>
                  <div
                    className="mono"
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 800,
                      letterSpacing: showCode ? '0.06em' : '0.22em',
                      color: showCode ? 'var(--primary)' : 'var(--text-2)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      marginTop: '0.18rem',
                      cursor: 'pointer',
                      userSelect: showCode ? 'all' : 'none',
                    }}
                    onClick={() => setShowCode(!showCode)}
                    title={showCode ? couponCode : 'Click to reveal'}
                  >
                    {showCode ? couponCode : maskedCode}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setShowCode(!showCode)}
                    aria-label={showCode ? 'Hide coupon code' : 'Reveal coupon code'}
                    title={showCode ? 'Hide code' : 'Reveal code'}
                    style={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      padding: '0.5rem',
                      color: showCode ? 'var(--primary)' : 'var(--text-3)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {showCode ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>

                  <button
                    type="button"
                    onClick={copyCode}
                    aria-label={copied ? 'Code copied' : 'Copy coupon code'}
                    title={copied ? 'Copied to clipboard!' : 'Copy code'}
                    style={{
                      background: copied ? 'var(--green-muted)' : 'var(--surface)',
                      border: `1px solid ${copied ? 'var(--green-border)' : 'var(--border)'}`,
                      borderRadius: '10px',
                      padding: '0.5rem 0.75rem',
                      color: copied ? 'var(--green)' : 'var(--text-2)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            <div style={{ position: 'relative' }}>
               {/* Frame for the QR */}
               <div style={{
                  padding: '1.5rem',
                  background: '#ffffff',
                  borderRadius: '24px',
                  boxShadow: '0 20px 40px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(0,0,0,0.05)',
                  filter: isUsed ? 'grayscale(1) contrast(0.8) opacity(0.2)' : 'none',
                  transition: 'all 0.4s ease'
               }}>
                  <QRCode value={couponUrl} size={200} fgColor="#060814" bgColor="#ffffff" style={{ width: '100%', height: 'auto', maxWidth: '200px' }} />
               </div>

               {isUsed && (
                 <div style={{
                   position: 'absolute', inset: 0,
                   display: 'flex', alignItems: 'center', justifyContent: 'center',
                   pointerEvents: 'none'
                 }}>
                   <div style={{
                     transform: 'rotate(-15deg)',
                     border: '4px solid var(--red)',
                     borderRadius: '12px',
                     padding: '0.75rem 2rem',
                     fontSize: '2rem',
                     fontWeight: 900,
                     color: 'var(--red)',
                     letterSpacing: '0.1em',
                     background: 'rgba(11, 15, 25, 0.9)',
                     boxShadow: '0 15px 35px rgba(0,0,0,0.6)',
                     backdropFilter: 'blur(8px)',
                     animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                   }}>
                     VOID
                   </div>
                 </div>
               )}
            </div>

            <div style={{ textAlign: 'center', width: '100%' }}>
               <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', marginBottom: '0.5rem' }}>
                  {isUsed ? 'Transaction Completed' : (() => {
                    const dest = order.coupon?.redemption_destination;
                    if (dest === 'gaming') return '🎮 Redeem inside Gaming App';
                    if (dest === 'lottery') return '🎰 Redeem inside Lottery App';
                    return 'Present to Merchant';
                  })()}
               </h3>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', fontWeight: 500, lineHeight: 1.5, maxWidth: '280px', margin: '0 auto' }}>
                  {isUsed 
                    ? 'This voucher has been scanned and the cashback has been credited to your wallet.' 
                    : (() => {
                      const dest = order.coupon?.redemption_destination;
                      if (dest === 'gaming') return 'Enter your coupon code inside the connected Gaming application to top up your balance.';
                      if (dest === 'lottery') return 'Enter your coupon code inside the connected Lottery application to enter games.';
                      return 'Show this QR code to the store manager to scan and unlock your rewards.';
                    })()}
               </p>
            </div>
          </div>

          {/* Footer with unique ID */}
          <div style={{ 
            padding: '1.5rem 1.75rem', 
            background: 'var(--bg-3)', 
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ textAlign: 'left' }}>
              <p style={{ color: 'var(--text-4)', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Voucher Issued</p>
              <p style={{ color: 'var(--text-2)', fontSize: '0.75rem', fontWeight: 600, margin: 0 }}>
                {new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ color: 'var(--text-4)', fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>System Auth</p>
              <p style={{ color: 'var(--green)', fontSize: '0.75rem', fontWeight: 800, margin: 0 }}>SECURED ✓</p>
            </div>
          </div>
        </div>
      </div>
  );
}
