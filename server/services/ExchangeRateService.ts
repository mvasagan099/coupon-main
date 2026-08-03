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
  AED: 3.67,
  SAR: 3.75,
  QAR: 3.64,
  KWD: 0.31,
  BHD: 0.38,
  OMR: 0.38,
  EGP: 48.5,
  PKR: 278.0,
  BDT: 117.0,
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
  NZD: 1.63,
  BRL: 5.40,
  MXN: 18.20,
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
   * Get exchange rate: how many `to` units equal 1 `from` unit.
   * E.g. getRate('USD', 'INR') → 83.5
   */
  async getRate(from: string, to: string): Promise<number> {
    if (from.toUpperCase() === to.toUpperCase()) return 1;
    const rates = await this.getRatesFromUSD();

    // We store rates as USD → X, so:
    // from→to = rates[to] / rates[from]
    const fromRate = from.toUpperCase() === BASE_CURRENCY ? 1 : rates[from.toUpperCase()];
    const toRate   = to.toUpperCase()   === BASE_CURRENCY ? 1 : rates[to.toUpperCase()];

    if (!fromRate || !toRate) {
      console.warn(`[ExchangeRateService] Unknown currency pair: ${from}→${to}. Defaulting to 1.`);
      return 1;
    }
    return toRate / fromRate;
  }

  /**
   * Convert an amount in USD to the target currency.
   * Returns { amount, rate, formattedRate }.
   */
  async convertFromUSD(amountUSD: number, targetCurrency: string): Promise<{
    amount: number;
    rate: number;
    amountUSD: number;
  }> {
    const rate   = await this.getRate(BASE_CURRENCY, targetCurrency);
    const amount = this.roundForCurrency(amountUSD * rate, targetCurrency);
    return { amount, rate, amountUSD };
  }

  /**
   * Convert a local currency amount back to USD.
   */
  async convertToUSD(amountLocal: number, fromCurrency: string): Promise<{
    amountUSD: number;
    rate: number;
  }> {
    const rate      = await this.getRate(fromCurrency, BASE_CURRENCY);
    const amountUSD = this.roundForCurrency(amountLocal * rate, BASE_CURRENCY);
    return { amountUSD, rate };
  }

  /**
   * Returns the full rates map (USD as base). Respects the cache TTL.
   */
  async getRatesFromUSD(): Promise<Record<string, number>> {
    // Serve from cache if fresh
    if (this.cache && (Date.now() - this.cache.fetchedAt) < CACHE_TTL_MS) {
      return this.cache.rates;
    }

    // Deduplicate concurrent calls — only one in-flight fetch at a time
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this.fetchAndCache().finally(() => {
      this.fetchPromise = null;
    });

    return this.fetchPromise;
  }

  /** Force a cache refresh. Returns fresh rates. */
  async forceRefresh(): Promise<Record<string, number>> {
    this.cache = null;
    return this.getRatesFromUSD();
  }

  /** Returns cached rates metadata for admin display */
  getCacheInfo(): { rates: Record<string, number> | null; fetchedAt: Date | null; ageSeconds: number | null } {
    if (!this.cache) return { rates: null, fetchedAt: null, ageSeconds: null };
    return {
      rates:       { ...this.cache.rates, [BASE_CURRENCY]: 1 },
      fetchedAt:   new Date(this.cache.fetchedAt),
      ageSeconds:  Math.round((Date.now() - this.cache.fetchedAt) / 1000),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async fetchAndCache(): Promise<Record<string, number>> {
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
