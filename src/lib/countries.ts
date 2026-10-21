// src/lib/countries.ts
// Client-side mirror of the backend CountryService.
// Single source of truth for country data used by CountrySelector,
// PaymentMethodSelector, and UserDashboard.

import type { PaymentGateway } from './paymentGateway';

export interface CountryInfo {
  code: string;          // ISO 3166-1 alpha-2
  name: string;
  currency: string;      // ISO 4217
  currencySymbol: string;
  phoneCode: string;     // E.164 dial code
  timezone: string;      // IANA primary timezone
  flag: string;          // emoji flag
  gatewayPriority: PaymentGateway[];
}

// Helper: convert country code to flag emoji
function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .split('')
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Country data (kept in sync with server/services/CountryService.ts)
// ─────────────────────────────────────────────────────────────────────────────

const RAW_COUNTRIES = [
  { code: 'IN', name: 'India',                currency: 'INR', currencySymbol: '₹',   phoneCode: '+91',  timezone: 'Asia/Kolkata',          gatewayPriority: ['razorpay', 'stripe'] },
  { code: 'US', name: 'United States',        currency: 'USD', currencySymbol: '$',   phoneCode: '+1',   timezone: 'America/New_York',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'GB', name: 'United Kingdom',       currency: 'GBP', currencySymbol: '£',   phoneCode: '+44',  timezone: 'Europe/London',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', currencySymbol: 'AED', phoneCode: '+971', timezone: 'Asia/Dubai',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AU', name: 'Australia',            currency: 'AUD', currencySymbol: 'A$',  phoneCode: '+61',  timezone: 'Australia/Sydney',       gatewayPriority: ['stripe', 'paypal'] },
] as const;

// Build typed array with flag emoji added
export const COUNTRIES: CountryInfo[] = RAW_COUNTRIES.map((c) => ({
  ...c,
  flag: flagEmoji(c.code),
  gatewayPriority: [...c.gatewayPriority] as PaymentGateway[],
})).sort((a, b) => a.name.localeCompare(b.name));

// Lookup map by code
const BY_CODE = new Map<string, CountryInfo>(COUNTRIES.map((c) => [c.code, c]));

const DEFAULT: CountryInfo = {
  code: 'US', name: 'United States', currency: 'USD', currencySymbol: '$',
  phoneCode: '+1', timezone: 'UTC', flag: '🇺🇸', gatewayPriority: ['stripe', 'paypal'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Look up country by ISO alpha-2 code. Returns DEFAULT if not found. */
export function getCountryByCode(code: string): CountryInfo {
  return BY_CODE.get(code.toUpperCase()) ?? DEFAULT;
}

/** Ordered gateway list for a country. */
export function getGatewaysForCountry(countryCode: string): PaymentGateway[] {
  return getCountryByCode(countryCode).gatewayPriority;
}

/** Preferred provider that supports the country's nominal wallet currency. */
export function getPreferredGateway(countryCode: string): PaymentGateway {
  const country = getCountryByCode(countryCode);
  return country.gatewayPriority.find(gateway => gateway !== 'paypal' || !['INR', 'AED'].includes(country.currency)) ?? 'stripe';
}

/** ISO 4217 currency code for a country. */
export function getCurrencyForCountry(countryCode: string): string {
  return getCountryByCode(countryCode).currency;
}

/** Currency symbol for a country. */
export function getCurrencySymbolForCountry(countryCode: string): string {
  return getCountryByCode(countryCode).currencySymbol;
}

/** Filter countries by name or code (case-insensitive). */
export function searchCountries(query: string): CountryInfo[] {
  const q = query.toLowerCase().trim();
  if (!q) return COUNTRIES;
  return COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.currency.toLowerCase().includes(q),
  );
}

export interface CountryBankConfig {
  routingLabel: string;
  routingPlaceholder: string;
  accountLabel: string;
  accountPlaceholder: string;
  bankPlaceholder: string;
}

/** Get country-tailored banking details configuration. */
export function getCountryBankConfig(countryCode: string | null | undefined): CountryBankConfig {
  const code = (countryCode || '').toUpperCase();

  if (code === 'IN') {
    return {
      routingLabel: 'IFSC Code',
      routingPlaceholder: 'e.g. HDFC0001234',
      accountLabel: 'Bank Account Number',
      accountPlaceholder: 'e.g. 50100234567890',
      bankPlaceholder: 'e.g. HDFC Bank, SBI, ICICI',
    };
  }

  if (code === 'US') {
    return {
      routingLabel: 'ACH / ABA Routing Number',
      routingPlaceholder: '9-digit routing number',
      accountLabel: 'Account Number',
      accountPlaceholder: 'Account number',
      bankPlaceholder: 'e.g. Chase, Bank of America, Wells Fargo',
    };
  }

  if (code === 'CA') {
    return {
      routingLabel: 'Transit & Institution No.',
      routingPlaceholder: 'e.g. 12345-004',
      accountLabel: 'Account Number',
      accountPlaceholder: 'e.g. 1234567',
      bankPlaceholder: 'e.g. RBC Royal Bank, TD Canada Trust',
    };
  }

  if (code === 'GB') {
    return {
      routingLabel: 'Sort Code / BIC',
      routingPlaceholder: 'e.g. 20-04-15 or BIC',
      accountLabel: 'Account Number / IBAN',
      accountPlaceholder: 'e.g. 12345678 or GB IBAN',
      bankPlaceholder: 'e.g. Barclays, HSBC UK, Lloyds',
    };
  }

  if (code === 'AU') {
    return {
      routingLabel: 'BSB Number',
      routingPlaceholder: '6-digit BSB (e.g. 062-000)',
      accountLabel: 'Account Number',
      accountPlaceholder: 'e.g. 12345678',
      bankPlaceholder: 'e.g. Commonwealth Bank, ANZ, NAB',
    };
  }

  if (code === 'NZ') {
    return {
      routingLabel: 'Branch Code',
      routingPlaceholder: 'e.g. 12-3456',
      accountLabel: 'Account Number',
      accountPlaceholder: 'e.g. 1234567-00',
      bankPlaceholder: 'e.g. ANZ NZ, ASB Bank, BNZ',
    };
  }

  if (['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'FI', 'GR', 'IE', 'PT', 'SE', 'NO', 'DK', 'CH', 'PL', 'CZ', 'HU'].includes(code)) {
    return {
      routingLabel: 'BIC / SWIFT Code',
      routingPlaceholder: 'e.g. DEUTDEDDBXX',
      accountLabel: 'IBAN',
      accountPlaceholder: 'e.g. DE89370400440532013000',
      bankPlaceholder: 'e.g. Deutsche Bank, BNP Paribas, Santander',
    };
  }

  if (['QA', 'AE', 'SA', 'KW', 'BH', 'OM', 'EG', 'IL', 'TR'].includes(code)) {
    return {
      routingLabel: 'SWIFT / BIC Code',
      routingPlaceholder: 'e.g. QNBAQAQA',
      accountLabel: 'IBAN',
      accountPlaceholder: 'e.g. QA58QNBA00000000123456',
      bankPlaceholder: 'e.g. QNB, Emirates NBD, Al Rajhi Bank',
    };
  }

  if (['MX', 'BR', 'AR', 'CO', 'CL'].includes(code)) {
    return {
      routingLabel: 'CLABE / Bank Code',
      routingPlaceholder: 'e.g. 18-digit CLABE / Code',
      accountLabel: 'Account Number / CLABE',
      accountPlaceholder: 'e.g. 012180001234567890',
      bankPlaceholder: 'e.g. BBVA Mexico, Itaú, Banco Galicia',
    };
  }

  if (['SG', 'HK', 'JP', 'KR', 'CN', 'PH', 'ID', 'MY', 'TH', 'VN', 'PK', 'BD', 'LK', 'NP'].includes(code)) {
    return {
      routingLabel: 'SWIFT / Branch Code',
      routingPlaceholder: 'e.g. DBSGSGSG',
      accountLabel: 'Bank Account Number',
      accountPlaceholder: 'Account number',
      bankPlaceholder: 'e.g. DBS Bank, HSBC, Maybank, Bangkok Bank',
    };
  }

  if (['ZA', 'NG', 'KE', 'GH'].includes(code)) {
    return {
      routingLabel: 'Branch Code / SWIFT',
      routingPlaceholder: 'e.g. 6-digit branch code',
      accountLabel: 'Account Number / NUBAN',
      accountPlaceholder: 'Account number',
      bankPlaceholder: 'e.g. Standard Bank, Access Bank, KCB',
    };
  }

  return {
    routingLabel: 'Routing / IFSC / SWIFT',
    routingPlaceholder: 'Code',
    accountLabel: 'Account Number / IBAN',
    accountPlaceholder: 'Account number',
    bankPlaceholder: 'Bank Name',
  };
}
