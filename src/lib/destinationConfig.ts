export type RedemptionDestination = 'gaming' | 'lottery' | 'couponvault';

export interface DestinationMeta {
  id: RedemptionDestination;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  badgeClass: string;
  accentColor: string;
  appNotice: string;
}

export const DESTINATIONS: Record<RedemptionDestination, DestinationMeta> = {
  gaming: {
    id: 'gaming',
    label: 'Gaming Application',
    shortLabel: 'Gaming App Only',
    icon: '🎮',
    description: 'Exclusive to verified Gaming partners. Redeemable only inside the Gaming application.',
    badgeClass: 'badge-purple',
    accentColor: '#a855f7',
    appNotice: 'Redeemable inside Gaming App',
  },
  lottery: {
    id: 'lottery',
    label: 'Lottery Application',
    shortLabel: 'Lottery App Only',
    icon: '🎰',
    description: 'Exclusive to verified Lottery partners. Redeemable only inside the Lottery application.',
    badgeClass: 'badge-amber',
    accentColor: '#f59e0b',
    appNotice: 'Redeemable inside Lottery App',
  },
  couponvault: {
    id: 'couponvault',
    label: 'CouponVault & Storefronts',
    shortLabel: 'CouponVault Store',
    icon: '🛍️',
    description: 'Redeemable in the CouponVault web application and participating merchant checkout counters.',
    badgeClass: 'badge-green',
    accentColor: '#10b981',
    appNotice: 'Redeemable in CouponVault & In-Store',
  },
};

export function getDestinationMeta(destination?: string | null): DestinationMeta | null {
  if (!destination) return null;
  const key = destination.toLowerCase().trim() as RedemptionDestination;
  return DESTINATIONS[key] ?? null;
}
