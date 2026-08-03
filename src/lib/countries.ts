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
  { code: 'IN', name: 'India',                currency: 'INR', currencySymbol: '₹',   phoneCode: '+91',  timezone: 'Asia/Kolkata',          gatewayPriority: ['razorpay', 'paypal'] },
  { code: 'US', name: 'United States',        currency: 'USD', currencySymbol: '$',   phoneCode: '+1',   timezone: 'America/New_York',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'GB', name: 'United Kingdom',       currency: 'GBP', currencySymbol: '£',   phoneCode: '+44',  timezone: 'Europe/London',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AU', name: 'Australia',            currency: 'AUD', currencySymbol: 'A$',  phoneCode: '+61',  timezone: 'Australia/Sydney',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', currencySymbol: 'AED', phoneCode: '+971', timezone: 'Asia/Dubai',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CA', name: 'Canada',               currency: 'CAD', currencySymbol: 'C$',  phoneCode: '+1',   timezone: 'America/Toronto',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'DE', name: 'Germany',              currency: 'EUR', currencySymbol: '€',   phoneCode: '+49',  timezone: 'Europe/Berlin',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'FR', name: 'France',               currency: 'EUR', currencySymbol: '€',   phoneCode: '+33',  timezone: 'Europe/Paris',           gatewayPriority: ['stripe', 'paypal'] },
  { code: 'IT', name: 'Italy',                currency: 'EUR', currencySymbol: '€',   phoneCode: '+39',  timezone: 'Europe/Rome',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'ES', name: 'Spain',                currency: 'EUR', currencySymbol: '€',   phoneCode: '+34',  timezone: 'Europe/Madrid',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'NL', name: 'Netherlands',          currency: 'EUR', currencySymbol: '€',   phoneCode: '+31',  timezone: 'Europe/Amsterdam',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'SE', name: 'Sweden',               currency: 'SEK', currencySymbol: 'kr',  phoneCode: '+46',  timezone: 'Europe/Stockholm',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'NO', name: 'Norway',               currency: 'NOK', currencySymbol: 'kr',  phoneCode: '+47',  timezone: 'Europe/Oslo',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'DK', name: 'Denmark',              currency: 'DKK', currencySymbol: 'kr',  phoneCode: '+45',  timezone: 'Europe/Copenhagen',      gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CH', name: 'Switzerland',          currency: 'CHF', currencySymbol: 'Fr',  phoneCode: '+41',  timezone: 'Europe/Zurich',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'SG', name: 'Singapore',            currency: 'SGD', currencySymbol: 'S$',  phoneCode: '+65',  timezone: 'Asia/Singapore',         gatewayPriority: ['stripe', 'paypal'] },
  { code: 'JP', name: 'Japan',                currency: 'JPY', currencySymbol: '¥',   phoneCode: '+81',  timezone: 'Asia/Tokyo',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'HK', name: 'Hong Kong',            currency: 'HKD', currencySymbol: 'HK$', phoneCode: '+852', timezone: 'Asia/Hong_Kong',         gatewayPriority: ['stripe', 'paypal'] },
  { code: 'NZ', name: 'New Zealand',          currency: 'NZD', currencySymbol: 'NZ$', phoneCode: '+64',  timezone: 'Pacific/Auckland',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'MX', name: 'Mexico',               currency: 'MXN', currencySymbol: '$',   phoneCode: '+52',  timezone: 'America/Mexico_City',    gatewayPriority: ['stripe', 'paypal'] },
  { code: 'BR', name: 'Brazil',               currency: 'BRL', currencySymbol: 'R$',  phoneCode: '+55',  timezone: 'America/Sao_Paulo',      gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AR', name: 'Argentina',            currency: 'ARS', currencySymbol: '$',   phoneCode: '+54',  timezone: 'America/Argentina/Buenos_Aires', gatewayPriority: ['paypal', 'stripe'] },
  { code: 'ZA', name: 'South Africa',         currency: 'ZAR', currencySymbol: 'R',   phoneCode: '+27',  timezone: 'Africa/Johannesburg',    gatewayPriority: ['stripe', 'paypal'] },
  { code: 'NG', name: 'Nigeria',              currency: 'NGN', currencySymbol: '₦',   phoneCode: '+234', timezone: 'Africa/Lagos',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'KE', name: 'Kenya',                currency: 'KES', currencySymbol: 'KSh', phoneCode: '+254', timezone: 'Africa/Nairobi',         gatewayPriority: ['paypal', 'stripe'] },
  { code: 'PK', name: 'Pakistan',             currency: 'PKR', currencySymbol: '₨',   phoneCode: '+92',  timezone: 'Asia/Karachi',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'BD', name: 'Bangladesh',           currency: 'BDT', currencySymbol: '৳',   phoneCode: '+880', timezone: 'Asia/Dhaka',             gatewayPriority: ['paypal', 'stripe'] },
  { code: 'LK', name: 'Sri Lanka',            currency: 'LKR', currencySymbol: 'Rs',  phoneCode: '+94',  timezone: 'Asia/Colombo',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'PH', name: 'Philippines',          currency: 'PHP', currencySymbol: '₱',   phoneCode: '+63',  timezone: 'Asia/Manila',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'ID', name: 'Indonesia',            currency: 'IDR', currencySymbol: 'Rp',  phoneCode: '+62',  timezone: 'Asia/Jakarta',           gatewayPriority: ['stripe', 'paypal'] },
  { code: 'MY', name: 'Malaysia',             currency: 'MYR', currencySymbol: 'RM',  phoneCode: '+60',  timezone: 'Asia/Kuala_Lumpur',      gatewayPriority: ['stripe', 'paypal'] },
  { code: 'TH', name: 'Thailand',             currency: 'THB', currencySymbol: '฿',   phoneCode: '+66',  timezone: 'Asia/Bangkok',           gatewayPriority: ['stripe', 'paypal'] },
  { code: 'VN', name: 'Vietnam',              currency: 'VND', currencySymbol: '₫',   phoneCode: '+84',  timezone: 'Asia/Ho_Chi_Minh',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'KR', name: 'South Korea',          currency: 'KRW', currencySymbol: '₩',   phoneCode: '+82',  timezone: 'Asia/Seoul',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CN', name: 'China',                currency: 'CNY', currencySymbol: '¥',   phoneCode: '+86',  timezone: 'Asia/Shanghai',          gatewayPriority: ['paypal', 'stripe'] },
  { code: 'SA', name: 'Saudi Arabia',         currency: 'SAR', currencySymbol: '﷼',   phoneCode: '+966', timezone: 'Asia/Riyadh',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'QA', name: 'Qatar',                currency: 'QAR', currencySymbol: '﷼',   phoneCode: '+974', timezone: 'Asia/Qatar',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'KW', name: 'Kuwait',               currency: 'KWD', currencySymbol: 'KD',  phoneCode: '+965', timezone: 'Asia/Kuwait',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'BH', name: 'Bahrain',              currency: 'BHD', currencySymbol: 'BD',  phoneCode: '+973', timezone: 'Asia/Bahrain',           gatewayPriority: ['stripe', 'paypal'] },
  { code: 'OM', name: 'Oman',                 currency: 'OMR', currencySymbol: '﷼',   phoneCode: '+968', timezone: 'Asia/Muscat',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'EG', name: 'Egypt',                currency: 'EGP', currencySymbol: '£',   phoneCode: '+20',  timezone: 'Africa/Cairo',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'PL', name: 'Poland',               currency: 'PLN', currencySymbol: 'zł',  phoneCode: '+48',  timezone: 'Europe/Warsaw',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CZ', name: 'Czech Republic',       currency: 'CZK', currencySymbol: 'Kč',  phoneCode: '+420', timezone: 'Europe/Prague',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'HU', name: 'Hungary',              currency: 'HUF', currencySymbol: 'Ft',  phoneCode: '+36',  timezone: 'Europe/Budapest',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'PT', name: 'Portugal',             currency: 'EUR', currencySymbol: '€',   phoneCode: '+351', timezone: 'Europe/Lisbon',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'BE', name: 'Belgium',              currency: 'EUR', currencySymbol: '€',   phoneCode: '+32',  timezone: 'Europe/Brussels',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AT', name: 'Austria',              currency: 'EUR', currencySymbol: '€',   phoneCode: '+43',  timezone: 'Europe/Vienna',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'FI', name: 'Finland',              currency: 'EUR', currencySymbol: '€',   phoneCode: '+358', timezone: 'Europe/Helsinki',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'GR', name: 'Greece',               currency: 'EUR', currencySymbol: '€',   phoneCode: '+30',  timezone: 'Europe/Athens',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'IE', name: 'Ireland',              currency: 'EUR', currencySymbol: '€',   phoneCode: '+353', timezone: 'Europe/Dublin',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'IL', name: 'Israel',               currency: 'ILS', currencySymbol: '₪',   phoneCode: '+972', timezone: 'Asia/Jerusalem',         gatewayPriority: ['stripe', 'paypal'] },
  { code: 'TR', name: 'Turkey',               currency: 'TRY', currencySymbol: '₺',   phoneCode: '+90',  timezone: 'Europe/Istanbul',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'UA', name: 'Ukraine',              currency: 'UAH', currencySymbol: '₴',   phoneCode: '+380', timezone: 'Europe/Kiev',            gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CO', name: 'Colombia',             currency: 'COP', currencySymbol: '$',   phoneCode: '+57',  timezone: 'America/Bogota',         gatewayPriority: ['paypal', 'stripe'] },
  { code: 'CL', name: 'Chile',                currency: 'CLP', currencySymbol: '$',   phoneCode: '+56',  timezone: 'America/Santiago',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'NP', name: 'Nepal',                currency: 'NPR', currencySymbol: 'Rs',  phoneCode: '+977', timezone: 'Asia/Kathmandu',         gatewayPriority: ['paypal', 'stripe'] },
  { code: 'GH', name: 'Ghana',                currency: 'GHS', currencySymbol: '₵',   phoneCode: '+233', timezone: 'Africa/Accra',           gatewayPriority: ['paypal', 'stripe'] },
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
  phoneCode: '+1', timezone: 'UTC', flag: '🇺🇸', gatewayPriority: ['paypal', 'stripe'],
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
