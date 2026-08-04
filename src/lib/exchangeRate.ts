import { supabase, isSupabaseConfigured } from './supabase';

const PROVIDER = 'https://api.frankfurter.app';
const BASE     = 'USD';
const TTL_MS   = 60 * 60 * 1000;

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: RateCache | null = null;
let fetchPromise: Promise<Record<string, number>> | null = null;

// ── Zero-decimal currencies (no cents)
const ZERO_DP = new Set(['JPY', 'KRW', 'VND', 'IDR', 'UGX', 'RWF', 'TZS', 'CLP', 'GNF']);
// ── Three-decimal currencies
const THREE_DP = new Set(['KWD', 'BHD', 'OMR', 'TND']);

function decimalsForCurrency(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DP.has(c))  return 0;
  if (THREE_DP.has(c)) return 3;
  return 2;
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

/**
 * Fetch currency conversion values directly from Supabase database (`exchange_rates` table).
 */
export async function fetchRatesFromDatabase(): Promise<Record<string, number> | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('base_currency, target_currency, rate');

    if (error || !data || data.length === 0) {
      return null;
    }

    const rates: Record<string, number> = { [BASE]: 1 };
    for (const row of data) {
      if (row.target_currency && row.rate) {
        rates[row.target_currency.trim().toUpperCase()] = Number(row.rate);
      }
    }
    return rates;
  } catch (err) {
    console.warn('[exchangeRate] Failed to fetch rates from DB:', err);
    return null;
  }
}

async function fetchRates(): Promise<Record<string, number>> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.rates;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      // 1. Try DB first for currency conversion values
      const dbRates = await fetchRatesFromDatabase();
      if (dbRates && Object.keys(dbRates).length > 1) {
        const rates = { ...FALLBACK_RATES, ...dbRates, [BASE]: 1 };
        cache = { rates, fetchedAt: Date.now() };
        return rates;
      }

      // 2. Fallback to live Frankfurter API
      const res = await fetch(`${PROVIDER}/latest?base=${BASE}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout?.(5000) ?? undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { rates: Record<string, number> };
      const rates = { ...FALLBACK_RATES, ...(json.rates ?? {}), [BASE]: 1 };
      cache = { rates, fetchedAt: Date.now() };
      return rates;
    } catch (err) {
      console.warn('[exchangeRate] Fetch failed, using fallback rates.', err);
      if (cache) return cache.rates;
      return FALLBACK_RATES;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the exchange rate between two currencies.
 * E.g. getRate('USD', 'INR') → 83.5
 */
export async function getRate(from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const rates = await fetchRates();
  const fromRate = from.toUpperCase() === BASE ? 1 : (rates[from.toUpperCase()] ?? FALLBACK_RATES[from.toUpperCase()] ?? 1);
  const toRate   = to.toUpperCase()   === BASE ? 1 : (rates[to.toUpperCase()]   ?? FALLBACK_RATES[to.toUpperCase()]   ?? 1);
  return toRate / fromRate;
}

/**
 * Convert an amount from USD to a target currency.
 * Returns the converted amount, exchange rate, and formatted string.
 */
export async function convertFromUSD(
  amountUSD: number,
  targetCurrency: string,
): Promise<{ amount: number; rate: number; formatted: string }> {
  const rate   = await getRate(BASE, targetCurrency);
  const dp     = decimalsForCurrency(targetCurrency);
  const amount = parseFloat((amountUSD * rate).toFixed(dp));
  return {
    amount,
    rate,
    formatted: formatCurrency(amount, targetCurrency),
  };
}

/**
 * Format a number as a localized currency string.
 * E.g. formatCurrency(500, 'INR') → '₹500.00'
 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale?: string,
): string {
  try {
    return new Intl.NumberFormat(locale ?? navigator.language ?? 'en-US', {
      style:                 'currency',
      currency:              currency.toUpperCase(),
      minimumFractionDigits: decimalsForCurrency(currency),
      maximumFractionDigits: decimalsForCurrency(currency),
    }).format(amount);
  } catch {
    // Fallback for unknown currencies
    return `${currency.toUpperCase()} ${amount.toFixed(decimalsForCurrency(currency))}`;
  }
}

/**
 * Warm the cache proactively (call on app startup).
 */
export function warmExchangeRateCache(): void {
  void fetchRates();
}

/**
 * Returns the cached rate age in seconds, or null if not yet cached.
 */
export function getCacheAge(): number | null {
  if (!cache) return null;
  return Math.round((Date.now() - cache.fetchedAt) / 1000);
}
