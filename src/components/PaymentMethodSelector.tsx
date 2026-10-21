// src/components/PaymentMethodSelector.tsx
// Country-aware payment method selector.
// Shows only the gateways supported for the user's country, in recommended order.

import { useMemo } from 'react';
import type { PaymentGateway } from '../lib/paymentGateway';
import { getGatewaysForCountry } from '../lib/countries';

interface PaymentOption {
  id: PaymentGateway;
  label: string;
  description: string;
  currency: string;
  logo: React.ReactNode;
  color: string;
  bgGradient: string;
  configured: boolean;
}

interface PaymentMethodSelectorProps {
  selected: PaymentGateway | null;
  onSelect: (gateway: PaymentGateway) => void;
  disabled?: boolean;
  /** ISO 3166-1 alpha-2 country code — filters and orders gateways */
  countryCode?: string | null;
  /** Currency code for the selected country (used in description) */
  userCurrency?: string | null;
}

// ── Inline SVG logos ────────────────────────────────────────────────────────

const PayPalLogo = () => (
  <svg viewBox="0 0 124 33" width="72" height="19" xmlns="http://www.w3.org/2000/svg">
    <path d="M46.2 6.8h-7.7c-.5 0-1 .4-1 .9l-3.1 19.8c-.1.4.2.7.6.7h3.9c.5 0 1-.4 1-.9l.8-5.3c.1-.5.5-.9 1-.9h2.4c5.1 0 8-2.5 8.8-7.3.3-2.1 0-3.8-1-5-1.1-1.2-3-1.9-5.7-1.9z" fill="#003087"/>
    <path d="M47 14.1c-.4 2.8-2.5 2.8-4.5 2.8h-1.1l.8-5c0-.3.3-.5.6-.5h.5c1.4 0 2.7 0 3.4.8.4.5.5 1.2.3 1.9z" fill="#009cde"/>
    <path d="M68.3 14h-3.9c-.3 0-.6.2-.6.5l-.2 1-.3-.4c-.9-1.3-2.9-1.7-4.9-1.7-4.6 0-8.5 3.5-9.3 8.3-.4 2.4.2 4.7 1.5 6.3 1.3 1.5 3.1 2.1 5.2 2.1 3.7 0 5.7-2.4 5.7-2.4l-.2 1c-.1.4.2.7.6.7h3.5c.5 0 1-.4 1-.9l2.1-13.3c.1-.5-.2-.9-.7-.9zm-5.5 8c-.4 2.3-2.2 3.9-4.6 3.9-1.2 0-2.1-.4-2.7-1.1-.6-.7-.9-1.8-.6-3 .4-2.3 2.2-3.9 4.5-3.9 1.2 0 2.1.4 2.7 1.1.7.8.9 1.8.7 3z" fill="#003087"/>
    <path d="M86.5 14h-3.9c-.4 0-.7.2-.9.5l-5.4 7.9-2.3-7.6c-.1-.5-.6-.8-1-.8h-3.8c-.4 0-.7.4-.6.8l4.3 12.7-4 5.7c-.3.4 0 .9.4.9h3.9c.4 0 .7-.2.9-.5l12.9-18.6c.3-.4 0-.9-.5-.9z" fill="#009cde"/>
    <path d="M97.6 6.8h-7.7c-.5 0-1 .4-1 .9L85.8 27.5c-.1.4.2.7.6.7h4.1c.4 0 .7-.3.7-.6l.9-5.6c.1-.5.5-.9 1-.9h2.4c5.1 0 8-2.5 8.8-7.3.3-2.1 0-3.8-1-5-1.1-1.2-3-1.9-5.7-1.9z" fill="#003087"/>
    <path d="M98.4 14.1c-.4 2.8-2.5 2.8-4.5 2.8h-1.1l.8-5c0-.3.3-.5.6-.5h.5c1.4 0 2.7 0 3.4.8.4.5.5 1.2.3 1.9z" fill="#009cde"/>
    <path d="M119.7 14h-3.9c-.3 0-.6.2-.6.5l-.2 1-.3-.4c-.9-1.3-2.9-1.7-4.9-1.7-4.6 0-8.5 3.5-9.3 8.3-.4 2.4.2 4.7 1.5 6.3 1.3 1.5 3.1 2.1 5.2 2.1 3.7 0 5.7-2.4 5.7-2.4l-.2 1c-.1.4.2.7.6.7h3.5c.5 0 1-.4 1-.9l2.1-13.3c.1-.5-.2-.9-.7-.9zm-5.5 8c-.4 2.3-2.2 3.9-4.6 3.9-1.2 0-2.1-.4-2.7-1.1-.6-.7-.9-1.8-.6-3 .4-2.3 2.2-3.9 4.5-3.9 1.2 0 2.1.4 2.7 1.1.7.8.9 1.8.7 3z" fill="#003087"/>
  </svg>
);

const RazorpayLogo = () => (
  <svg viewBox="0 0 120 30" width="88" height="22" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="22" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="18" fill="#072654">razorpay</text>
  </svg>
);

const StripeLogo = () => (
  <svg viewBox="0 0 60 25" width="60" height="25" xmlns="http://www.w3.org/2000/svg">
    <text x="0" y="20" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="17" fill="#635bff">stripe</text>
  </svg>
);

// ── Env checks ──────────────────────────────────────────────────────────────
const isRazorpayConfigured = !!(import.meta.env.VITE_RAZORPAY_KEY_ID);
const isStripeConfigured   = !!(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ── Full option catalogue ───────────────────────────────────────────────────
const ALL_OPTIONS: Record<PaymentGateway, Omit<PaymentOption, 'description' | 'currency'>> = {
  paypal: {
    id:          'paypal',
    label:       'PayPal',
    logo:        <PayPalLogo />,
    color:       '#003087',
    bgGradient:  'linear-gradient(135deg, rgba(0,48,135,0.07) 0%, rgba(0,156,222,0.07) 100%)',
    configured:  true,
  },
  razorpay: {
    id:          'razorpay',
    label:       'Razorpay',
    logo:        <RazorpayLogo />,
    color:       '#072654',
    bgGradient:  'linear-gradient(135deg, rgba(7,38,84,0.07) 0%, rgba(30,120,255,0.07) 100%)',
    configured:  isRazorpayConfigured,
  },
  stripe: {
    id:          'stripe',
    label:       'Stripe',
    logo:        <StripeLogo />,
    color:       '#635bff',
    bgGradient:  'linear-gradient(135deg, rgba(99,91,255,0.07) 0%, rgba(159,152,255,0.07) 100%)',
    configured:  isStripeConfigured,
  },
};

// ── Recommended badge ───────────────────────────────────────────────────────
const RecommendedBadge = () => (
  <div style={{
    display:        'flex',
    alignItems:     'center',
    gap:            '0.25rem',
    fontSize:       '0.68rem',
    fontWeight:     700,
    letterSpacing:  '0.04em',
    padding:        '0.18rem 0.5rem',
    borderRadius:   '6px',
    background:     'linear-gradient(135deg, #6c63ff22 0%, #00c79222 100%)',
    color:          'var(--accent)',
    border:         '1px solid var(--accent-muted)',
    whiteSpace:     'nowrap',
    flexShrink:     0,
  }}>
    ⭐ Best
  </div>
);

// ── Component ───────────────────────────────────────────────────────────────

export default function PaymentMethodSelector({
  selected,
  onSelect,
  disabled = false,
  countryCode,
  userCurrency,
}: PaymentMethodSelectorProps) {
  // Build ordered, filtered options based on the user's country
  const options = useMemo<PaymentOption[]>(() => {
    const priorityOrder = countryCode
      ? getGatewaysForCountry(countryCode)
      : ['stripe', 'paypal'] as PaymentGateway[];

    const currency = userCurrency ?? (countryCode === 'IN' ? 'INR' : 'USD');

    return priorityOrder
      .filter(gateway => (gateway !== 'paypal' || (currency !== 'INR' && currency !== 'AED')) && (gateway !== 'razorpay' || currency === 'INR'))
      .map((gwId, idx) => {
      const base = ALL_OPTIONS[gwId];
      let description = '';
      switch (gwId) {
        case 'paypal':    description = `PayPal balance or card (${currency})`; break;
        case 'razorpay':  description = 'UPI, Cards, Net Banking (INR)';         break;
        case 'stripe':    description = `Credit / Debit card (${currency})`;     break;
      }
      return {
        ...base,
        description,
        currency,
        isRecommended: idx === 0,
      } as PaymentOption & { isRecommended: boolean };
    });
  }, [countryCode, userCurrency]);

  return (
    <div style={{ display: 'grid', gap: '0.65rem' }}>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        Payment method
      </span>

      {options.map((opt, idx) => {
        const isSelected  = selected === opt.id;
        const isDisabled  = disabled || !opt.configured;
        const isRecommended = idx === 0;

        return (
          <button
            key={opt.id}
            type="button"
            id={`payment-method-${opt.id}`}
            aria-pressed={isSelected}
            disabled={isDisabled}
            onClick={() => !isDisabled && onSelect(opt.id)}
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:        '0.85rem',
              padding:    '0.85rem 1rem',
              borderRadius: '14px',
              border:     `2px solid ${isSelected ? opt.color : 'var(--border)'}`,
              background: isSelected ? opt.bgGradient : 'var(--surface-soft)',
              cursor:     isDisabled ? 'not-allowed' : 'pointer',
              opacity:    isDisabled ? 0.5 : 1,
              transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
              textAlign:  'left',
              width:      '100%',
              outline:    'none',
              boxShadow:  isSelected ? `0 0 0 3px ${opt.color}22` : 'none',
              transform:  isSelected ? 'scale(1.01)' : 'scale(1)',
            }}
            onMouseEnter={(e) => {
              if (!isDisabled && !isSelected) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = opt.color;
                (e.currentTarget as HTMLButtonElement).style.background = opt.bgGradient;
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-soft)';
              }
            }}
          >
            {/* Logo area */}
            <div style={{ width: '90px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flexShrink: 0 }}>
              {opt.logo}
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-1)' }}>
                {opt.label}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: '0.1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {opt.configured ? opt.description : 'Not configured — add API keys to enable'}
              </div>
            </div>

            {/* Recommended badge (first gateway for user's country) */}
            {isRecommended && opt.configured && <RecommendedBadge />}

            {/* Currency badge */}
            {opt.configured && !isRecommended && (
              <div style={{
                fontSize:   '0.72rem',
                fontWeight: 700,
                padding:    '0.2rem 0.5rem',
                borderRadius: '6px',
                background: isSelected ? opt.color : 'var(--border)',
                color:      isSelected ? '#fff' : 'var(--text-3)',
                letterSpacing: '0.05em',
                flexShrink: 0,
                transition: 'all 0.18s',
              }}>
                {opt.currency}
              </div>
            )}

            {/* Selected indicator */}
            {isSelected && (
              <div style={{
                width:        '20px',
                height:       '20px',
                borderRadius: '50%',
                background:   opt.color,
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                flexShrink:   0,
                animation:    'fadeIn 0.18s ease',
              }}>
                <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                  <path d="M1 4.5L4 7.5L10 1.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
