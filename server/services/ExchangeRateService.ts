import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const MAX_RATE_AGE_MS = 72 * 60 * 60 * 1000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export class ExchangeRateService {
  private cache: { rates: Record<string, number>; fetchedAt: number } | null = null;
  private pending: Promise<Record<string, number>> | null = null;
  private client: SupabaseClient | null;

  constructor() {
    this.client = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) : null;
  }
  async getRate(from: string, to: string): Promise<number> {
    if (from.toUpperCase() === to.toUpperCase()) return 1;
    const rates = await this.getRatesFromUSD();
    const source = rates[from.toUpperCase()];
    const target = rates[to.toUpperCase()];
    if (!source || !target) throw new Error('A current exchange rate is unavailable for this currency.');
    return target / source;
  }
  async convertFromUSD(amountUSD: number, targetCurrency: string) {
    const rate = await this.getRate('USD', targetCurrency);
    return { amount: amountUSD * rate, rate, amountUSD };
  }
  async convertToUSD(amount: number, currency: string) {
    const rate = await this.getRate(currency, 'USD');
    const amountUSD = Math.round(amount * rate * 100) / 100;
    if (!Number.isFinite(amountUSD) || amountUSD <= 0) throw new Error('Payment is below the minimum wallet credit.');
    return { amountUSD, rate };
  }
  async getRatesFromUSD(): Promise<Record<string, number>> {
    if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL_MS) return this.cache.rates;
    if (!this.pending) this.pending = this.loadRates().finally(() => { this.pending = null; });
    return this.pending;
  }
  async forceRefresh() { this.cache = null; return this.getRatesFromUSD(); }
  getCacheInfo() {
    return { rates: this.cache?.rates ?? null,
      fetchedAt: this.cache ? new Date(this.cache.fetchedAt) : null,
      ageSeconds: this.cache ? (Date.now() - this.cache.fetchedAt) / 1000 : null };
  }
  async getRatesFromDB(): Promise<Record<string, number> | null> {
    if (!this.client && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      this.client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    }
    if (!this.client) return null;
    const { data, error } = await this.client.from('exchange_rates').select('target_currency,rate,updated_at')
      .eq('base_currency', 'USD').gte('updated_at', new Date(Date.now() - MAX_RATE_AGE_MS).toISOString());
    if (error) return null;
    const rates: Record<string, number> = { USD: 1 };
    for (const row of data ?? []) if (Number.isFinite(Number(row.rate)) && Number(row.rate) > 0) rates[row.target_currency] = Number(row.rate);
    return rates;
  }
  async seedAllRatesToDatabase() { return this.forceRefresh(); }
  private async loadRates() {
    const databaseRates = await this.getRatesFromDB();
    const rates: Record<string, number> = { ...databaseRates, USD: 1 };
    try {
      const response = await fetch('https://api.frankfurter.dev/v1/latest?base=USD', { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Exchange rate provider unavailable.');
      const payload = await response.json() as { date: string; rates: Record<string, number> };
      const rateDate = Date.parse(payload.date);
      if (!Number.isFinite(rateDate) || Date.now() - rateDate > MAX_RATE_AGE_MS) throw new Error('Exchange rates are outdated.');
      const rows = [];
      for (const [currency, rate] of Object.entries(payload.rates)) {
        if (!Number.isFinite(rate) || rate <= 0) continue;
        rates[currency] = rate;
        rows.push({ base_currency: 'USD', target_currency: currency, rate, updated_at: new Date(rateDate).toISOString() });
      }
      if (this.client && rows.length) {
        const { error } = await this.client.from('exchange_rates').upsert(rows, { onConflict: 'base_currency,target_currency' });
        if (error) console.warn('Exchange rates could not be persisted.');
      }
    } catch {
      if (Object.keys(rates).length <= 1) throw new Error('Current exchange rates are unavailable. Please retry.');
    }
    this.cache = { rates, fetchedAt: Date.now() };
    return rates;
  }
}
export const exchangeRateService = new ExchangeRateService();
