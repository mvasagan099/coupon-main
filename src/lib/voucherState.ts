export function voucherState(voucher: { is_used: boolean; status: string; expiry_date: string; remaining_balance: number }, now = Date.now()): 'active' | 'used' | 'unavailable' {
  if (voucher.is_used || voucher.status === 'redeemed' || Number(voucher.remaining_balance) <= 0) return 'used';
  const expires = new Date(voucher.expiry_date).getTime();
  return voucher.status === 'active' && Number.isFinite(expires) && expires > now ? 'active' : 'unavailable';
}
