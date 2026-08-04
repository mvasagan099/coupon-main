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
  { code: 'IN', name: 'India',                currency: 'INR', currencySymbol: '₹',   phoneCode: '+91',  timezone: 'Asia/Kolkata',          gatewayPriority: ['razorpay', 'paypal'] },
  { code: 'US', name: 'United States',        currency: 'USD', currencySymbol: '$',   phoneCode: '+1',   timezone: 'America/New_York',       gatewayPriority: ['stripe', 'paypal'] },
  { code: 'GB', name: 'United Kingdom',       currency: 'GBP', currencySymbol: '£',   phoneCode: '+44',  timezone: 'Europe/London',          gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', currencySymbol: 'AED', phoneCode: '+971', timezone: 'Asia/Dubai',             gatewayPriority: ['stripe', 'paypal'] },
  { code: 'AU', name: 'Australia',            currency: 'AUD', currencySymbol: 'A$',  phoneCode: '+61',  timezone: 'Australia/Sydney',       gatewayPriority: ['stripe', 'paypal'] },
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
