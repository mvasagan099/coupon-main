// src/lib/exchangeRate.ts
// Single-currency / 1:1 formatting & rate utilities.
// All FX conversion disabled — rate is fixed to 1:1 across all currencies.

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

/**
 * Get the exchange rate between two currencies.
 * Always returns 1 (no currency conversion).
 */
export async function getRate(_from: string, _to: string): Promise<number> {
  return 1;
}

/**
 * Convert an amount from USD to a target currency.
 * Returns 1:1 amount with localized formatting.
 */
export async function convertFromUSD(
  amountUSD: number,
  targetCurrency: string,
): Promise<{ amount: number; rate: number; formatted: string }> {
  const dp     = decimalsForCurrency(targetCurrency);
  const amount = parseFloat(amountUSD.toFixed(dp));
  return {
    amount,
    rate: 1,
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
  return 0;
}

