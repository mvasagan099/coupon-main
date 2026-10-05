import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, isSupabaseConfigured, updateUserProfile } from '../lib/supabase';
import { Eye, EyeOff } from 'lucide-react';
import CountrySelector from '../components/CountrySelector';
import type { CountryInfo } from '../lib/countries';

export function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const path = window.location.pathname;
  const isCompanyRoute = path.includes('companylogin');
  const isAdminRoute = path.includes('adminlogin');
  const isUserRoute = path.includes('userlogin');

  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState(isAdminRoute ? 'admin@123.com' : '');
  const [password, setPassword] = useState(isAdminRoute ? 'admin@123' : '');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryInfo | null>(null);

  let loginTitle = 'Welcome back to CouponVault';
  let loginSubtitle = 'Sign in to access your gift cards, balances, and redemptions.';
  let sideTitle = 'Premium gifting, without the friction';
  let sideBody =
    'Discover beautifully presented cards, secure wallet storage, and simple redemption from any supported merchant.';
  let routeLabel = 'Customer access';
  let routeChipClass = 'auth-route-pill auth-route-pill--customer';
  let visualClass = 'auth-visual';
  let formCardClass = 'glass-panel auth-form-card auth-form-card--customer';
  let highlightBadge = 'Lifestyle gifting flow';
  let immersiveCards = [
    {
      label: 'Discover',
      title: 'Browse premium brands',
      body: 'Move from curated discovery to wallet-ready redemption without friction.',
    },
    {
      label: 'Redeem',
      title: 'Scan at checkout',
      body: 'Every purchased card becomes instantly usable with a clean QR-first flow.',
    },
  ];
  let signalBand = [
    { value: '100+', label: 'brands live' },
    { value: '2 min', label: 'average claim' },
    { value: '24/7', label: 'wallet access' },
  ];

  if (isSignUp) {
    loginTitle = 'Create your CouponVault account';
    loginSubtitle = 'Set up secure access for your gift card wallet.';
  } else if (isCompanyRoute) {
    loginTitle = 'Company login access';
    loginSubtitle = 'Manage onboarding, campaigns, and store-side redemption from one workspace.';
    sideTitle = 'Designed for operators';
    sideBody =
      'Launch campaigns, track liability, and verify redemptions with a merchant experience that feels clean and controlled.';
    routeLabel = 'Company login';
    routeChipClass = 'auth-route-pill auth-route-pill--merchant';
    visualClass = 'auth-visual';
    formCardClass = 'glass-panel auth-form-card auth-form-card--merchant';
    highlightBadge = 'Revenue and redemption ops';
    immersiveCards = [
      {
        label: 'Campaigns',
        title: 'Launch value faster',
        body: 'Create offers, set pricing, and push branded cards to the marketplace with clarity.',
      },
      {
        label: 'Store-side',
        title: 'Redeem with confidence',
        body: 'Give teams a polished scanner workflow that feels trustworthy at the counter.',
      },
    ];
    signalBand = [
      { value: 'Live', label: 'campaign control' },
      { value: 'KYC', label: 'guided onboarding' },
      { value: 'Instant', label: 'scan validation' },
    ];
  } else if (isAdminRoute) {
    loginTitle = 'Platform admin access';
    loginSubtitle = 'Direct-entry sign in for approvals, controls, and security monitoring.';
    sideTitle = 'Restricted operations';
    sideBody =
      'Admin tools remain available by direct route only, with the redesign focused on clarity, trust, and control.';
    routeLabel = 'Direct admin route';
    routeChipClass = 'auth-route-pill auth-route-pill--admin';
    visualClass = 'auth-visual';
    formCardClass = 'glass-panel auth-form-card auth-form-card--admin';
    highlightBadge = 'Restricted command surface';
    immersiveCards = [
      {
        label: 'Oversight',
        title: 'Approvals and controls',
        body: 'Review onboarding, platform activity, and merchant risk from a focused control plane.',
      },
      {
        label: 'Security',
        title: 'Direct-entry only',
        body: 'Admin tooling stays intentionally hidden from public navigation and marketing flows.',
      },
    ];
    signalBand = [
      { value: 'Audit', label: 'operational trace' },
      { value: 'Review', label: 'partner approvals' },
      { value: 'Secure', label: 'restricted entry' },
    ];
  } else if (isUserRoute) {
    loginTitle = 'Customer login';
    loginSubtitle = 'Open your wallet, browse the marketplace, and manage active cards.';
  }

  if (user) {
    if (isAdminRoute) return <Navigate to="/admin/overview" replace />;
    if (isCompanyRoute) return <Navigate to="/merchant/overview" replace />;
    return <Navigate to="/dashboard/marketplace" replace />;
  }

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    // Determine role from the current route
    const role = isAdminRoute ? 'admin' : isCompanyRoute ? 'company' : 'user';

    try {
      if (isSignUp) {
        // Country is required for new user registrations
        if (isUserRoute && !selectedCountry) {
          setMessage({ type: 'error', text: 'Please select your country to continue.' });
          setLoading(false);
          return;
        }

        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: {
              role,
              country:            selectedCountry?.name ?? null,
              country_code:       selectedCountry?.code ?? null,
              currency:           selectedCountry?.currency ?? null,
              timezone:           selectedCountry?.timezone ?? null,
              phone_country_code: selectedCountry?.phoneCode ?? null,
            },
          },
        });
        if (error) throw error;

        // Supabase returns an empty identities array if an account with this email already exists
        if (signUpData?.user && signUpData.user.identities && signUpData.user.identities.length === 0) {
          setMessage({
            type: 'error',
            text: 'An account with this email address already exists. Please sign in instead.',
          });
          return;
        }

        // Persist country/currency to the profiles table after sign-up
        if (signUpData?.user && selectedCountry) {
          try {
            await updateUserProfile(signUpData.user.id, {
              country:            selectedCountry.name,
              country_code:       selectedCountry.code,
              currency:           selectedCountry.currency,
              timezone:           selectedCountry.timezone,
              phone_country_code: selectedCountry.phoneCode,
            });
          } catch (profileErr) {
            // Non-fatal: profile update can be done later from dashboard
            console.warn('Could not save country to profile:', profileErr);
          }
        }

        setMessage({ type: 'info', text: 'Account created! Check your email to confirm.' });
      } else {
        let { error } = await supabase.auth.signInWithPassword({ email, password });
        
        // Auto-provision the default admin account on the live server if it doesn't exist yet
        if (error && email === 'admin@123.com' && isAdminRoute) {
          const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { role: 'admin' } },
          });
          if (!signUpError) {
            const retry = await supabase.auth.signInWithPassword({ email, password });
            error = retry.error;
          }
        }

        if (error) {
          if (error.message.toLowerCase().includes('email not confirmed')) {
            throw new Error('Email not confirmed. Please check your inbox and confirm your email address before signing in.');
          }
          throw error;
        }
        
        navigate(isAdminRoute ? '/admin/overview' : isCompanyRoute ? '/merchant/overview' : '/dashboard/marketplace');
      }
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Authentication failed.' });
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className={`fade-in auth-page auth-page--${isAdminRoute ? 'admin' : isCompanyRoute ? 'merchant' : 'customer'}`}>
      {/* Aurora Orbs for full page background effect */}
      <div className="aurora-orb aurora-orb-1"></div>
      <div className="aurora-orb aurora-orb-2"></div>
      <div className="aurora-orb aurora-orb-3"></div>
      
      <section className={visualClass}>

        <div className="auth-visual-inner">
          <div>
            <span className="auth-chip auth-chip--light">
              {highlightBadge}
            </span>
            <h1 style={{ fontSize: 'clamp(1.75rem, 3vw, 2.6rem)', lineHeight: 1.08, letterSpacing: '0.02em', wordSpacing: '0.08em', margin: 0 }}>
              {sideTitle}
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.94rem', lineHeight: 1.65, maxWidth: '48ch', marginTop: '0.85rem' }}>
              {sideBody}
            </p>
          </div>

          <div className="auth-signal-band">
            {signalBand.map((item) => (
              <div key={item.label} className="auth-signal">
                <div className="auth-signal-value">{item.value}</div>
                <div className="auth-signal-label">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="auth-immersive-grid auth-visual-grid">
            {immersiveCards.map((card) => (
              <div key={card.title} className="auth-immersive-card">
                <div className="section-label" style={{ color: 'rgba(255,255,255,0.75)', marginBottom: '0.45rem' }}>
                  {card.label}
                </div>
                <div className="auth-immersive-title">{card.title}</div>
                <div className="auth-immersive-copy">{card.body}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="auth-form-shell">
        <div className={formCardClass}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div className="auth-brand-row">
              <div className="auth-brand-mark">C</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>CouponVault</div>
                <div style={{ color: 'var(--text-3)', fontSize: '0.78rem' }}>{routeLabel}</div>
              </div>
            </div>
            <span className={routeChipClass}>{isSignUp ? 'Account creation' : routeLabel}</span>
            <h2 style={{ margin: '0 0 0.45rem', fontSize: '1.45rem', fontWeight: 700, letterSpacing: '0.02em', wordSpacing: '0.08em', }}>{loginTitle}</h2>
            <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.55, fontSize: '0.92rem' }}>{loginSubtitle}</p>
          </div>

          {!isSupabaseConfigured && (
            <div
              style={{
                marginBottom: '1rem',
                background: 'var(--amber-muted)',
                border: '1px solid var(--amber-border)',
                color: 'var(--amber)',
                borderRadius: '20px',
                padding: '0.9rem',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              Add your Supabase keys in <code>.env</code> before using live auth.
            </div>
          )}

          {message && (
            <div
              role="alert"
              aria-live="polite"
              style={{
                marginBottom: '1rem',
                background: message.type === 'error' ? 'var(--red-muted)' : 'var(--green-muted)',
                border: `1px solid ${message.type === 'error' ? 'var(--red-border)' : 'var(--green-border)'}`,
                color: message.type === 'error' ? 'var(--red)' : 'var(--green)',
                borderRadius: '20px',
                padding: '0.9rem',
                fontSize: '0.84rem',
              }}
            >
              {message.text}
            </div>
          )}

          <form onSubmit={handleAuth} className="auth-form">
            <div>
              <label htmlFor="email" className="label">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  className="input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  style={{ paddingRight: '40px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-3)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Country selector — shown only in sign-up mode for users */}
            {isSignUp && isUserRoute && (
              <div>
                <label className="label" htmlFor="country-selector">
                  Country <span style={{ color: 'var(--red)' }}>*</span>
                </label>
                <CountrySelector
                  id="country-selector"
                  value={selectedCountry?.code}
                  onChange={setSelectedCountry}
                  required
                  placeholder="Search your country…"
                />
                {selectedCountry && (
                  <div style={{
                    marginTop: '0.5rem',
                    display: 'flex',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    fontSize: '0.78rem',
                    color: 'var(--text-3)',
                  }}>
                    <span style={{ background: 'var(--surface-soft)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                      💱 Currency: <strong style={{ color: 'var(--text-1)' }}>{selectedCountry.currency}</strong>
                    </span>
                    <span style={{ background: 'var(--surface-soft)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                      📞 {selectedCountry.phoneCode}
                    </span>
                    <span style={{ background: 'var(--surface-soft)', padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                      🌏 {selectedCountry.timezone}
                    </span>
                  </div>
                )}
              </div>
            )}

            <button className="btn btn-primary" disabled={loading} type="submit" style={{ width: '100%' }}>
              {loading ? (
                <>
                  <span className="spinner" />
                  {isSignUp ? 'Creating account...' : 'Signing in...'}
                </>
              ) : isSignUp ? (
                'Create account'
              ) : (
                'Continue'
              )}
            </button>
          </form>



          {!isAdminRoute && (
            <div style={{ marginTop: '1.5rem', color: 'var(--text-3)', textAlign: 'center', lineHeight: 1.6 }}>
              {isSignUp ? 'Already have an account?' : 'Need an account?'}{' '}
              <button
                onClick={() => setIsSignUp((current) => !current)}
                className="auth-toggle"
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </div>
          )}

          {!isAdminRoute && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <Link to="/" style={{ color: 'var(--text-3)', textDecoration: 'none', fontWeight: 600 }}>
                Back to homepage
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default LoginPage;
