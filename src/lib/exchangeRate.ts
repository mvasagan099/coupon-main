// src/lib/exchangeRate.ts
// Currency formatting and fresh published exchange rates.

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

/** Read only fresh published rates; missing rates never silently become 1. */
export async function getRate(from: string, to: string): Promise<number> {
  if (from.toUpperCase() === to.toUpperCase()) return 1;
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from('exchange_rates').select('target_currency,rate')
    .eq('base_currency', 'USD')
    .in('target_currency', [from.toUpperCase(), to.toUpperCase()])
    .gte('updated_at', new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString());
  if (error) throw new Error('Exchange rates are unavailable.');
  const rates: Record<string, number> = { USD: 1 };
  for (const row of data ?? []) rates[row.target_currency] = Number(row.rate);
  const rate = rates[to.toUpperCase()] / rates[from.toUpperCase()];
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('No current exchange rate for this currency.');
  return rate;
}
export async function convertFromUSD(amountUSD: number, targetCurrency: string) {
  const rate = await getRate('USD', targetCurrency);
  const amount = Number((amountUSD * rate).toFixed(decimalsForCurrency(targetCurrency)));
  return { amount, rate, formatted: formatCurrency(amount, targetCurrency) };
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
    return new Intl.NumberFormat(locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US') ?? 'en-US', {
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
 * Warm exchange rate cache stub.
 */
export function warmExchangeRateCache(): void {
  // No-op: conversions disabled
}

/**
 * Returns cache age in seconds.
 */
export function getCacheAge(): number | null {
  return null;
}

