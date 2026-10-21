import { useEffect, useState } from 'react';
import BrandCatalogue from './BrandCatalogue';
import { campaignBrand, getBrandCampaigns } from '../lib/campaigns';
import type { BrandCampaign } from '../lib/campaigns';
import type { GiftCard } from '../lib/supabase';

export default function DatabaseBrandCatalogue(props: { search: string; offers: GiftCard[]; countryCode: string | null; currency: string; inventoryError: boolean }) {
  const [campaigns, setCampaigns] = useState<BrandCampaign[] | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getBrandCampaigns().then(rows => { if (!cancelled) setCampaigns(rows); }).catch(reason => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [revision]);
  if (error) return <div className="details-panel" role="alert"><p>{error}</p><button className="btn btn-secondary" onClick={() => { setError(''); setRevision(value => value + 1); }}>Retry campaigns</button></div>;
  if (!campaigns) return <p role="status">Loading brand campaigns…</p>;
  const visible = campaigns.filter(row => !row.country_code || row.country_code === props.countryCode).map(campaignBrand);
  if (!visible.length) return <p role="status">No brand campaigns are published for your country yet.</p>;
  return <BrandCatalogue {...props} brands={visible} />;
}
