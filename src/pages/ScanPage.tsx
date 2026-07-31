import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CouponValidation } from '../lib/supabase';
import { markCouponUsedById, validateCouponById } from '../lib/supabase';
import { useToast } from '../components/Toast';

export default function ScanPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<CouponValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    async function load() {
      if (!code) return;
      try {
        const result = await validateCouponById(code);
        setData(result);
      } catch (err: any) {
        setError(err.message ?? 'Invalid coupon link');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [code]);

  async function handleMarkUsed() {
    if (!code) return;
    setMarking(true);

    try {
      const revealedCode = await markCouponUsedById(code);
      setData((previous) =>
        previous ? { ...previous, is_used: true, coupon_code: revealedCode } : previous,
      );
      setMarked(true);
      success('Voucher redeemed', 'The coupon has been marked as used successfully.');
    } catch (err: any) {
      setError(err.message);
      toastError('Redemption failed', err.message);
    } finally {
      setMarking(false);
    }
  }

  const isUsed = data?.is_used;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: '520px' }} className="fade-in">
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              margin: '0 auto 0.85rem',
              borderRadius: '18px',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              background: 'linear-gradient(135deg, var(--primary-container), var(--primary))',
            }}
          >
            C
          </div>
          <div className="section-label" style={{ marginBottom: '0.4rem' }}>
            CouponVault validator
          </div>
          <h1 style={{ margin: 0, fontSize: '2rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Redemption checkpoint</h1>
        </div>

        {loading ? (
          <div className="glass-card-strong" style={{ padding: '3rem', textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.85rem' }}>
              <span className="spinner spinner-lg" />
            </div>
            <div style={{ color: 'var(--text-3)' }}>Validating voucher...</div>
          </div>
        ) : error ? (
          <div className="glass-card-strong" style={{ padding: '2rem', border: '1px solid var(--red-border)' }}>
            <span className="badge badge-red" style={{ marginBottom: '1rem' }}>
              Invalid voucher
            </span>
            <h2 style={{ margin: '0 0 0.5rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>This scan could not be verified</h2>
            <p style={{ margin: '0 0 1rem', color: 'var(--text-3)', lineHeight: 1.6 }}>{error}</p>
            <div className="glass-card" style={{ borderRadius: '20px', padding: '1rem', wordBreak: 'break-all' }}>
              <div className="section-label" style={{ marginBottom: '0.35rem' }}>
                Request hash
              </div>
              <div className="mono" style={{ color: 'var(--text-3)' }}>
                {code}
              </div>
            </div>
          </div>
        ) : data ? (
          <div className="glass-card-strong" style={{ overflow: 'hidden' }}>
            <div
              style={{
                padding: '1.5rem',
                background: isUsed
                  ? 'linear-gradient(135deg, rgba(74,68,85,0.08), rgba(255,255,255,0.92))'
                  : 'linear-gradient(135deg, rgba(128,249,200,0.3), rgba(255,255,255,0.96))',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span className={`badge ${isUsed ? 'badge-amber' : 'badge-green'}`}>
                {isUsed ? 'Already redeemed' : 'Valid and active'}
              </span>
              <h2 style={{ margin: '0.8rem 0 0.35rem', fontSize: '1.8rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
                {data.company_name}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6 }}>
                {isUsed
                  ? 'This voucher has already been processed in the system.'
                  : 'This voucher is ready for merchant-side redemption.'}
              </p>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="glass-card" style={{ borderRadius: '22px', padding: '1rem' }}>
                <div className="section-label" style={{ marginBottom: '0.35rem' }}>
                  Voucher status
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>Issued</div>
                    <div style={{ fontWeight: 700 }}>
                      {new Date(data.issued_at).toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>Reference code</div>
                    <div className="mono" style={{ fontWeight: 700 }}>
                      {isUsed ? data.coupon_code : 'Locked until redeemed'}
                    </div>
                  </div>
                </div>
              </div>

              <button
                className={`btn ${isUsed ? 'btn-secondary' : 'btn-primary'}`}
                onClick={handleMarkUsed}
                disabled={isUsed || marking || marked}
                style={{ width: '100%' }}
              >
                {marking ? (
                  <>
                    <span className="spinner" />
                    Processing redemption...
                  </>
                ) : isUsed || marked ? (
                  'Redemption already recorded'
                ) : (
                  'Redeem voucher'
                )}
              </button>
            </div>
          </div>
        ) : null}

        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')}>
            Back to homepage
          </button>
        </div>
      </div>
    </div>
  );
}
