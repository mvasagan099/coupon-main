import { useEffect, useRef, useState } from 'react';
import { campaignBrand, getBrandCampaigns, updateBrandCampaign } from '../lib/campaigns';
import type { BrandCampaign } from '../lib/campaigns';
import { getCompanies } from '../lib/supabase';
import type { Company } from '../lib/supabase';
import { COUNTRIES } from '../lib/countries';
import BrandLogo from '../components/BrandLogo';
import '../styles/marketplace.css';

export default function AdminCampaignsPage() {
  const [campaigns, setCampaigns] = useState<BrandCampaign[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<BrandCampaign | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getBrandCampaigns(true), getCompanies()]).then(([rows, issuers]) => {
      if (!cancelled) { setCampaigns(rows); setCompanies(issuers); setLoading(false); }
    }).catch(reason => { if (!cancelled) { setError(reason.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [revision]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || saving.current) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const updated = await updateBrandCampaign(selected.id, selected.updated_at, selected);
      setCampaigns(rows => rows.map(row => row.id === updated.id ? updated : row).sort((a, b) => a.sort_order - b.sort_order || a.slug.localeCompare(b.slug)));
      setSelected(null); setNotice('Campaign saved. Published changes appear when customers reload the marketplace.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Campaign could not be saved.'); }
    finally { saving.current = false; setBusy(false); }
  }
  return <section className="marketplace-details">
    <span className="section-label">ADMINISTRATION</span><h1 style={{ fontSize: '2rem', margin: '.5rem 0' }}>Brand campaigns</h1>
    <p>Manage the brand catalogue. Link a verified merchant to display its published coupons. Publishing a campaign does not create coupon inventory.</p>
    <button className="btn btn-secondary" disabled={busy || loading} onClick={() => { setError(''); setNotice(''); setSelected(null); setLoading(true); setRevision(value => value + 1); }}>Reload campaigns</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">Loading campaigns…</p> : <div className="admin-campaign-grid">
      <div className="details-panel"><h2>{campaigns.length} campaigns</h2>{campaigns.map(row => <button key={row.id} className="admin-campaign-row" disabled={busy} onClick={() => { setSelected({ ...row }); setError(''); setNotice(''); }} aria-pressed={selected?.id === row.id}>
        <BrandLogo brand={campaignBrand(row)} /><span><strong>{row.name}</strong><br />{row.is_published ? 'Published' : 'Hidden'} · Order {row.sort_order}</span><span>Edit</span>
      </button>)}</div>
      {selected ? <form className="details-panel admin-campaign-form" onSubmit={event => void save(event)}><h2>Edit {selected.name}</h2>
        <label>Name<input className="input" required maxLength={100} disabled={busy} value={selected.name} onChange={event => setSelected({ ...selected, name: event.target.value })} /></label>
        <label>Category<input className="input" required maxLength={100} disabled={busy} value={selected.category} onChange={event => setSelected({ ...selected, category: event.target.value })} /></label>
        <label>Description<textarea className="input" maxLength={3000} rows={4} disabled={busy} value={selected.description} onChange={event => setSelected({ ...selected, description: event.target.value })} /></label>
        <label>Brand colour<input type="color" disabled={busy} value={selected.color} onChange={event => setSelected({ ...selected, color: event.target.value })} /></label>
        <label>Display order<input className="input" type="number" min={0} max={10000} step={1} required disabled={busy} value={selected.sort_order} onChange={event => setSelected({ ...selected, sort_order: Number(event.target.value) })} /></label>
        <label>Eligible country<select className="input" disabled={busy} value={selected.country_code ?? ''} onChange={event => setSelected({ ...selected, country_code: event.target.value || null })}><option value="">All countries</option>{COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
        <label>Coupon issuer<select className="input" disabled={busy} value={selected.issuer_company_id ?? ''} onChange={event => setSelected({ ...selected, issuer_company_id: event.target.value || null })}><option value="">No merchant linked</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name} ({company.status})</option>)}</select></label>
        <label className="admin-campaign-publish"><input type="checkbox" disabled={busy} checked={selected.is_published} onChange={event => setSelected({ ...selected, is_published: event.target.checked })} />Published in marketplace</label>
        <p>Coupon prices, expiry and stock are managed in the linked merchant’s offers.</p><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save campaign'}</button>
      </form> : <div className="details-panel"><h2>Select a campaign to edit</h2><p>Changes are saved to the database and enforced by admin permissions.</p></div>}
    </div>}
  </section>;
}
