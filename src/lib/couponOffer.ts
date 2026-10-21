export function formatOfferDate(value: string | null | undefined): string {
  if (!value) return 'No expiry set';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
}
export function offerUnavailable(card: {is_active?: boolean; expiry_date?: string | null; price: number; value: number; available_count: number}, now = Date.now()): string | null {
  if (!card.is_active) return 'This coupon is unavailable.';
  if (card.expiry_date && (!Number.isFinite(Date.parse(card.expiry_date)) || Date.parse(card.expiry_date) <= now)) return 'This coupon has expired.';
  if (!Number.isFinite(Number(card.price)) || card.price <= 0 || !Number.isFinite(Number(card.value)) || card.value <= 0) return 'This offer cannot be purchased.';
  if (card.available_count <= 0) return 'This coupon is sold out.';
  return null;
}
