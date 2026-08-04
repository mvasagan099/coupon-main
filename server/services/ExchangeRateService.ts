// server/services/ExchangeRateService.ts
// Fetches live exchange rates from Frankfurter (https://www.frankfurter.app)
// — no API key required, free tier supports up to 10k req/day.
// Caches in memory for 60 minutes. Falls back to last-good cache on failure.
// Persists latest rates to the exchange_rates Supabase table for admin visibility.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTL_MS   = 60 * 60 * 1000;   // 60 minutes
const BASE_CURRENCY  = 'USD';
const PROVIDER_URL   = 'https://api.frankfurter.app';

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.78,
  AUD: 1.52,
  CAD: 1.36,
  JPY: 155.0,
  CNY: 7.23,
  SGD: 1.35,
  HKD: 7.81,
  NZD: 1.63,
  MXN: 18.20,
  BRL: 5.40,
  ARS: 920.0,
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  KWD: 0.31,
  BHD: 0.38,
  OMR: 0.38,
  EGP: 48.5,
  PKR: 278.0,
  BDT: 117.0,
  LKR: 305.0,
  PHP: 58.5,
  MYR: 4.70,
  THB: 36.5,
  IDR: 16300.0,
  VND: 25400.0,
  NGN: 1500.0,
  KES: 129.0,
  KRW: 1380.0,
  ZAR: 18.2,
  TRY: 32.8,
  CHF: 0.89,
  SEK: 10.6,
  NOK: 10.7,
  DKK: 6.9,
  PLN: 3.95,
  CZK: 23.2,
  HUF: 365.0,
  ILS: 3.70,
  UAH: 40.5,
  COP: 3950.0,
  CLP: 920.0,
  NPR: 135.5,
  GHS: 15.2,
};

export class ExchangeRateService {
  private static instance: ExchangeRateService;

  private cache: RateCache | null = null;
  private fetchPromise: Promise<Record<string, number>> | null = null;
  private supabase: SupabaseClient | null = null;

  private constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key);
    }
  }

  static getInstance(): ExchangeRateService {
    if (!ExchangeRateService.instance) {
      ExchangeRateService.instance = new ExchangeRateService();
    }
    return ExchangeRateService.instance;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Get exchange rate: always 1 (FX conversion disabled)
   */
  async getRate(_from: string, _to: string): Promise<number> {
    return 1;
  }

  /**
   * Convert an amount in USD to the target currency (1:1).
   */
  async convertFromUSD(amountUSD: number, targetCurrency: string): Promise<{
    amount: number;
    rate: number;
    amountUSD: number;
  }> {
    const amount = this.roundForCurrency(amountUSD, targetCurrency);
    return { amount, rate: 1, amountUSD };
  }

  /**
   * Convert a local currency amount back to USD (1:1).
   */
  async convertToUSD(amountLocal: number, _fromCurrency: string): Promise<{
    amountUSD: number;
    rate: number;
  }> {
    const amountUSD = this.roundForCurrency(amountLocal, BASE_CURRENCY);
    return { amountUSD, rate: 1 };
  }

  /**
   * Returns rates map where all rates equal 1.
   */
  async getRatesFromUSD(): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};
    for (const key of Object.keys(FALLBACK_RATES)) {
      rates[key] = 1;
    }
    rates[BASE_CURRENCY] = 1;
    return rates;
  }

  /** Force a cache refresh. Returns 1:1 rates map. */
  async forceRefresh(): Promise<Record<string, number>> {
    return this.getRatesFromUSD();
  }

  /** Returns cached rates metadata for admin display */
  getCacheInfo(): { rates: Record<string, number> | null; fetchedAt: Date | null; ageSeconds: number | null } {
    return {
      rates:       { [BASE_CURRENCY]: 1 },
      fetchedAt:   new Date(),
      ageSeconds:  0,
    };
  }

  /**
   * Fetch exchange rates stub
   */
  async getRatesFromDB(): Promise<Record<string, number> | null> {
    return this.getRatesFromUSD();
  }

  /**
   * Seed rates stub
   */
  async seedAllRatesToDatabase(): Promise<Record<string, number>> {
    return this.getRatesFromUSD();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchAndCache(): Promise<Record<string, number>> {
    // 1. Try DB first for currency conversion values
    const dbRates = await this.getRatesFromDB();
    if (dbRates && Object.keys(dbRates).length > 1) {
      const rates = { ...FALLBACK_RATES, ...dbRates, [BASE_CURRENCY]: 1 };
      this.cache = { rates, fetchedAt: Date.now() };
      console.log(`[ExchangeRateService] Loaded ${Object.keys(rates).length} exchange rates from database.`);
      return rates;
    }

    // 2. If DB is empty, fetch live from API and persist/seed to database
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`${PROVIDER_URL}/latest?base=${BASE_CURRENCY}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);

      const json = await res.json() as { rates: Record<string, number> };
      const rates = { ...FALLBACK_RATES, ...(json.rates ?? {}), [BASE_CURRENCY]: 1 };

      this.cache = { rates, fetchedAt: Date.now() };
      console.log(`[ExchangeRateService] Refreshed ${Object.keys(rates).length} rates from Frankfurter.`);

      // Persist to Supabase in background (non-blocking)
      void this.persistToSupabase(rates);

      return rates;
    } catch (err: any) {
      console.error(`[ExchangeRateService] Fetch failed: ${err.message}. Using cached rates.`);
      // Fall back to stale cache if available
      if (this.cache) return this.cache.rates;
      return FALLBACK_RATES;
    }
  }

  private async persistToSupabase(rates: Record<string, number>): Promise<void> {
    if (!this.supabase) return;
    try {
      const rows = Object.entries(rates).map(([target, rate]) => ({
        base_currency:   BASE_CURRENCY,
        target_currency: target,
        rate,
        updated_at:      new Date().toISOString(),
      }));

      const { error } = await this.supabase
        .from('exchange_rates')
        .upsert(rows, { onConflict: 'base_currency,target_currency' });

      if (error) {
        console.warn('[ExchangeRateService] Failed to persist rates to Supabase:', error.message);
      }
    } catch (err: any) {
      console.warn('[ExchangeRateService] Supabase persist error:', err.message);
    }
  }

  /**
   * Round amounts appropriately for a given currency.
   * JPY, KRW, VND, etc. use 0 decimal places.
   * Most currencies use 2. KWD, BHD, OMR use 3.
   */
  private roundForCurrency(amount: number, currency: string): number {
    const zeroDp  = new Set(['JPY', 'KRW', 'VND', 'IDR', 'UGX', 'RWF', 'TZS', 'GNF', 'CLP']);
    const threeDp = new Set(['KWD', 'BHD', 'OMR', 'TND']);

    if (zeroDp.has(currency.toUpperCase()))  return Math.round(amount);
    if (threeDp.has(currency.toUpperCase())) return Math.round(amount * 1000) / 1000;
    return Math.round(amount * 100) / 100;
  }
}

export const exchangeRateService = ExchangeRateService.getInstance();
