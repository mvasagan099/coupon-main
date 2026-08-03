// server/services/CountryService.ts
// Static country registry — single source of truth for country→currency→gateway mappings.
// Adding a new country requires only adding one entry to COUNTRY_LIST below.

import type { PaymentGateway } from './PaymentService';

export interface CountryInfo {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  /** ISO 4217 currency code */
  currency: string;
  currencySymbol: string;
  /** ITU-T E.164 dial code */
  phoneCode: string;
  /** IANA timezone (primary) */
  timezone: string;
  /** Ordered list of supported gateways (first = recommended) */
  gatewayPriority: PaymentGateway[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Country registry
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_LIST: CountryInfo[] = [
  // Razorpay-priority countries (India)
  { code: 'IN', name: 'India',                currency: 'INR', currencySymbol: '₹',   phoneCode: '+91',  timezone: 'Asia/Kolkata',          gatewayPriority: ['razorpay', 'paypal'] },

  // Stripe-priority countries (Western markets)
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
  { code: 'GH', name: 'Ghana',                currency: 'GHS', currencySymbol: '₵',   phoneCode: '+233', timezone: 'Africa/Accra',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'ET', name: 'Ethiopia',             currency: 'ETB', currencySymbol: 'Br',  phoneCode: '+251', timezone: 'Africa/Addis_Ababa',     gatewayPriority: ['paypal', 'stripe'] },
  { code: 'TZ', name: 'Tanzania',             currency: 'TZS', currencySymbol: 'TSh', phoneCode: '+255', timezone: 'Africa/Dar_es_Salaam',   gatewayPriority: ['paypal', 'stripe'] },
  { code: 'UG', name: 'Uganda',               currency: 'UGX', currencySymbol: 'USh', phoneCode: '+256', timezone: 'Africa/Kampala',         gatewayPriority: ['paypal', 'stripe'] },
  { code: 'RW', name: 'Rwanda',               currency: 'RWF', currencySymbol: 'FRw', phoneCode: '+250', timezone: 'Africa/Kigali',          gatewayPriority: ['paypal', 'stripe'] },
  { code: 'PL', name: 'Poland',               currency: 'PLN', currencySymbol: 'zł',  phoneCode: '+48',  timezone: 'Europe/Warsaw',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'CZ', name: 'Czech Republic',       currency: 'CZK', currencySymbol: 'Kč',  phoneCode: '+420', timezone: 'Europe/Prague',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'HU', name: 'Hungary',              currency: 'HUF', currencySymbol: 'Ft',  phoneCode: '+36',  timezone: 'Europe/Budapest',        gatewayPriority: ['stripe', 'paypal'] },
  { code: 'RO', name: 'Romania',              currency: 'RON', currencySymbol: 'lei', phoneCode: '+40',  timezone: 'Europe/Bucharest',       gatewayPriority: ['stripe', 'paypal'] },
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
  { code: 'PE', name: 'Peru',                 currency: 'PEN', currencySymbol: 'S/',  phoneCode: '+51',  timezone: 'America/Lima',           gatewayPriority: ['paypal', 'stripe'] },
  { code: 'NP', name: 'Nepal',                currency: 'NPR', currencySymbol: 'Rs',  phoneCode: '+977', timezone: 'Asia/Kathmandu',         gatewayPriority: ['paypal', 'stripe'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fallback for unknown countries
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COUNTRY: CountryInfo = {
  code: 'US',
  name: 'United States',
  currency: 'USD',
  currencySymbol: '$',
  phoneCode: '+1',
  timezone: 'UTC',
  gatewayPriority: ['paypal', 'stripe'],
};

// ─────────────────────────────────────────────────────────────────────────────
// CountryService singleton
// ─────────────────────────────────────────────────────────────────────────────

export class CountryService {
  private static instance: CountryService;
  private readonly byCode: Map<string, CountryInfo>;

  private constructor() {
    this.byCode = new Map(COUNTRY_LIST.map((c) => [c.code.toUpperCase(), c]));
  }

  static getInstance(): CountryService {
    if (!CountryService.instance) {
      CountryService.instance = new CountryService();
    }
    return CountryService.instance;
  }

  /** All countries ordered by name */
  getAll(): CountryInfo[] {
    return [...COUNTRY_LIST].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Look up by ISO 3166-1 alpha-2 code. Falls back to DEFAULT_COUNTRY. */
  getByCode(code: string): CountryInfo {
    return this.byCode.get(code.toUpperCase()) ?? DEFAULT_COUNTRY;
  }

  /** Ordered gateway list for a given country code */
  getGatewaysForCountry(countryCode: string): PaymentGateway[] {
    return this.getByCode(countryCode).gatewayPriority;
  }

  /** Currency code for a given country */
  getCurrencyForCountry(countryCode: string): string {
    return this.getByCode(countryCode).currency;
  }

  /** Whether a given gateway is supported for a country */
  isGatewaySupported(countryCode: string, gateway: PaymentGateway): boolean {
    return this.getGatewaysForCountry(countryCode).includes(gateway);
  }
}

export const countryService = CountryService.getInstance();
