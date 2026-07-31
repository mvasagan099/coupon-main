
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { TrendingUp, Clock, Building2, ShieldAlert, Landmark, FileText, X, Activity } from 'lucide-react';
import { useToast } from '../components/Toast';
import { DashboardCard } from '../components/GlassCard';
import type { AdminPurchasedCoupon, AdminUser, Company, CompanyStats, GiftCard, Settlement, AdminWithdrawal } from '../lib/supabase';
import {
  adminApproveCompany,
  adminGenerateSettlements,
  adminGetPurchasedCoupons,
  adminGetSettlements,
  adminGetUsers,
  adminMarkSettlementPaid,
  adminRejectCompany,
  adminSuspendCompany,
  createCompany,
  deleteCompany,
  deleteGiftCard,
  getCompanies,
  getCompanyStats,
  getGiftCards,
  updateCompanyLimit,
  adminGetWithdrawals,
  adminUpdateWithdrawalStatus,
} from '../lib/supabase';

const validSections = ['overview', 'partners', 'users', 'ledger', 'approvals', 'security', 'offers', 'settlements', 'payouts'] as const;
type AdminSection = (typeof validSections)[number];

function isAdminSection(value: string | undefined): value is AdminSection {
  return !!value && validSections.includes(value as AdminSection);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return fallback;
}

export default function AdminDashboard() {
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();

  const currentSection: AdminSection = isAdminSection(section) ? section : 'overview';

  const [stats, setStats] = useState<CompanyStats[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ 
    name: '', prefix: '', coupon_limit: 100, 
    gstin: '', pan: '', bank_name: '', account_number: '', ifsc_code: '' 
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [suspendingId, setSuspendingId] = useState<string | null>(null);

  const [_editingId, setEditingId] = useState<string | null>(null);
  const [editingLimit, setEditingLimit] = useState<number>(100);
  const [editLoading, setEditLoading] = useState(false);

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [lockedAccounts, setLockedAccounts] = useState<Record<string, boolean>>({});
  const [usersPage, setUsersPage] = useState(0);

  const [purchasedCoupons, setPurchasedCoupons] = useState<AdminPurchasedCoupon[]>([]);
  const [couponsLoading, setCouponsLoading] = useState(false);
  const [couponSearch, setCouponSearch] = useState('');
  const [couponFilter, setCouponFilter] = useState<'all' | 'active' | 'redeemed'>('all');
  const [couponsPage, setCouponsPage] = useState(0);
  const pageSize = 15;

  const [offers, setOffers] = useState<GiftCard[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [deletingOfferId, setDeletingOfferId] = useState<string | null>(null);

  const [viewingDoc, setViewingDoc] = useState<string | null>(null);

  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [settlementsLoading, setSettlementsLoading] = useState(false);

  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [withdrawalsLoading, setWithdrawalsLoading] = useState(false);

  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    actionType: 'approve' | 'reject' | null;
    withdrawalId: string | null;
    amount: number;
    email: string;
  }>({
    show: false,
    title: '',
    message: '',
    actionType: null,
    withdrawalId: null,
    amount: 0,
    email: '',
  });

  const securityLogs = [
    { time: '2026-05-18 14:32:01', event: 'High frequency redemptions', detail: 'User usr_732 claimed 12 coupons in 45 seconds.', severity: 'High', target: 'Acme Corp' },
    { time: '2026-05-18 11:15:40', event: 'Rapid balance fluctuation', detail: 'Wallet value rose by ₹48.50 in under one minute.', severity: 'Medium', target: 'usr_902' },
    { time: '2026-05-17 09:44:12', event: 'Multiple failed scan attempts', detail: 'Invalid UUID token signature processed by one counter node.', severity: 'Low', target: 'Register Counter Node B' },
  ] as const;

  useEffect(() => {
    if (!section) {
      navigate('/admin/overview', { replace: true });
      return;
    }

    if (!isAdminSection(section)) {
      navigate('/admin/overview', { replace: true });
    }
  }, [navigate, section]);

  // Stable ref for toastError so it never invalidates useCallback
  const toastErrorRef = useRef(toastError);
  useEffect(() => { toastErrorRef.current = toastError; }, [toastError]);

  const loadCompanies = useCallback(async () => {
    try {
      setLoadingCompanies(true);
      const [statsData, allCompanies] = await Promise.all([getCompanyStats(), getCompanies()]);
      setStats(statsData);
      setCompanies(allCompanies);
    } catch (err: unknown) {
      toastErrorRef.current('Load failed', getErrorMessage(err, 'Failed to load companies.'));
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  const usersPageRef = useRef(usersPage);
  useEffect(() => { usersPageRef.current = usersPage; }, [usersPage]);

  const loadUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const data = await adminGetUsers(usersPageRef.current, pageSize);
      setUsers(data);
    } catch (err: unknown) {
      toastErrorRef.current('Load users failed', getErrorMessage(err, 'Failed to load users.'));
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const couponsPageRef = useRef(couponsPage);
  useEffect(() => { couponsPageRef.current = couponsPage; }, [couponsPage]);

  const loadCoupons = useCallback(async () => {
    try {
      setCouponsLoading(true);
      const data = await adminGetPurchasedCoupons(couponsPageRef.current, pageSize);
      setPurchasedCoupons(data);
    } catch (err: unknown) {
      toastErrorRef.current('Load error', getErrorMessage(err, 'Failed to fetch ledger.'));
    } finally {
      setCouponsLoading(false);
    }
  }, []);

  const loadOffers = useCallback(async () => {
    try {
      setOffersLoading(true);
      const data = await getGiftCards();
      setOffers(data);
    } catch (err: unknown) {
      toastErrorRef.current('Load error', getErrorMessage(err, 'Failed to fetch offers.'));
    } finally {
      setOffersLoading(false);
    }
  }, []);

  const loadSettlements = useCallback(async () => {
    try {
      setSettlementsLoading(true);
      const data = await adminGetSettlements();
      setSettlements(data);
    } catch (err: unknown) {
      toastErrorRef.current('Load error', getErrorMessage(err, 'Failed to fetch settlements.'));
    } finally {
      setSettlementsLoading(false);
    }
  }, []);

  const loadWithdrawals = useCallback(async () => {
    try {
      setWithdrawalsLoading(true);
      const data = await adminGetWithdrawals();
      setWithdrawals(data);
    } catch (err: unknown) {
      toastErrorRef.current('Load error', getErrorMessage(err, 'Failed to fetch payouts.'));
    } finally {
      setWithdrawalsLoading(false);
    }
  }, []);

  // Re-fetch when page number changes
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional data refetch when pagination changes
  useEffect(() => { if (currentSection === 'users') loadUsers(); }, [usersPage]); // eslint-disable-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional data refetch when pagination changes
  useEffect(() => { if (currentSection === 'ledger') loadCoupons(); }, [couponsPage]); // eslint-disable-line react-hooks/exhaustive-deps

  /* eslint-disable react-hooks/set-state-in-effect -- intentional data fetch when the active dashboard section changes */
  useEffect(() => {
    if (currentSection === 'overview' || currentSection === 'partners' || currentSection === 'approvals') {
      loadCompanies();
    }
    if (currentSection === 'users') {
      loadUsers();
    }
    if (currentSection === 'ledger') {
      loadCoupons();
    }
    if (currentSection === 'offers') {
      loadOffers();
    }
    if (currentSection === 'settlements') {
      loadSettlements();
    }
    if (currentSection === 'payouts') {
      loadWithdrawals();
    }
  }, [currentSection]); // eslint-disable-line react-hooks/exhaustive-deps
  /* eslint-enable react-hooks/set-state-in-effect */

  const pendingCompanies = useMemo(() => companies.filter((company) => company.status === 'pending'), [companies]);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const query = userSearch.toLowerCase();
      return user.email.toLowerCase().includes(query) || user.id.toLowerCase().includes(query);
    });
  }, [userSearch, users]);

  const filteredCoupons = useMemo(() => {
    return purchasedCoupons.filter((coupon) => {
      const query = couponSearch.toLowerCase();
      const matchesSearch =
        coupon.coupon_code.toLowerCase().includes(query) ||
        coupon.company_name.toLowerCase().includes(query) ||
        (coupon.user_email || '').toLowerCase().includes(query);

      const matchesFilter =
        couponFilter === 'all' ? true : couponFilter === 'active' ? !coupon.is_used : coupon.is_used;

      return matchesSearch && matchesFilter;
    });
  }, [couponFilter, couponSearch, purchasedCoupons]);

  const platformGtv = useMemo(() => {
    return purchasedCoupons.reduce((sum, coupon) => sum + (coupon.price || 0), 0);
  }, [purchasedCoupons]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setFormError('');

    if (!/^[A-Za-z]{3}$/.test(form.prefix)) {
      setFormError('Prefix must be exactly 3 letters (A-Z).');
      return;
    }

    setFormLoading(true);
    try {
      await createCompany({
        name: form.name.trim(),
        prefix: form.prefix,
        coupon_limit: form.coupon_limit,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        bank_name: form.bank_name || undefined,
        account_number: form.account_number || undefined,
        ifsc_code: form.ifsc_code || undefined
      });
      setForm({ name: '', prefix: '', coupon_limit: 100, gstin: '', pan: '', bank_name: '', account_number: '', ifsc_code: '' });
      setShowForm(false);
      success('Company created', `${form.name.trim()} has been added to the platform.`);
      loadCompanies();
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Failed to create company.'));
    } finally {
      setFormLoading(false);
    }
  }

  async function handleUpdateLimit(id: string, name: string) {
    if (editingLimit <= 0) {
      toastError('Invalid limit', 'Limit must be at least 1.');
      return;
    }

    setEditLoading(true);
    try {
      await updateCompanyLimit(id, editingLimit);
      success('Limit updated', `Voucher capacity for ${name} is now ${editingLimit}.`);
      setEditingId(null);
      if (selectedCompany?.id === id) {
        setSelectedCompany({ ...selectedCompany, coupon_limit: editingLimit });
      }
      loadCompanies();
    } catch (err: unknown) {
      toastError('Update failed', getErrorMessage(err, 'Failed to update company limit.'));
    } finally {
      setEditLoading(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This action cannot be undone.`)) return;

    setDeletingId(id);
    try {
      await deleteCompany(id);
      success('Company deleted', `${name} has been removed from the platform.`);
      if (selectedCompany?.id === id) setSelectedCompany(null);
      loadCompanies();
    } catch (err: unknown) {
      toastError('Delete failed', getErrorMessage(err, 'Failed to delete company.'));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSuspend(id: string, name: string) {
    setSuspendingId(id);
    try {
      await adminSuspendCompany(id);
      success('Partner suspended', `${name} has been moved to suspended status.`);
      if (selectedCompany?.id === id) {
        setSelectedCompany({ ...selectedCompany, status: 'suspended' });
      }
      loadCompanies();
    } catch (err: unknown) {
      toastError('Suspend failed', getErrorMessage(err, 'Failed to suspend company.'));
    } finally {
      setSuspendingId(null);
    }
  }

  async function handleApproveMerchant(id: string, name: string) {
    try {
      await adminApproveCompany(id);
      success('Merchant approved', `${name} is now approved to launch gift card campaigns.`);
      loadCompanies();
    } catch (err: unknown) {
      toastError('Approval failed', getErrorMessage(err, 'Failed to approve merchant.'));
    }
  }

  async function handleRejectMerchant(id: string, name: string) {
    try {
      await adminRejectCompany(id);
      success('Merchant rejected', `KYC request for ${name} has been rejected.`);
      loadCompanies();
    } catch (err: unknown) {
      toastError('Rejection failed', getErrorMessage(err, 'Failed to reject merchant.'));
    }
  }

  function toggleLockAccount(userId: string) {
    setLockedAccounts((previous) => {
      const nextState = !previous[userId];
      success(nextState ? 'Account locked' : 'Account unlocked', 'Profile security status adjusted.');
      return { ...previous, [userId]: nextState };
    });
  }

  const handleDeleteOffer = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to completely remove the campaign "${title}" globally?`)) return;
    try {
      setDeletingOfferId(id);
      await deleteGiftCard(id);
      success('Offer deleted', `"${title}" has been removed globally.`);
      await loadOffers();
    } catch (err: unknown) {
      toastError('Deletion failed', getErrorMessage(err, 'Failed to delete offer.'));
    } finally {
      setDeletingOfferId(null);
    }
  };

  const titleMap: Record<AdminSection, string> = {
    overview: 'Platform operations at a glance',
    partners: 'Manage corporate partners and limits',
    offers: 'Manage global marketplace campaigns',
    users: 'Monitor platform users and roles',
    ledger: 'Track all issued and purchased vouchers',
    approvals: 'Review pending merchant applications',
    security: 'Security alerts and platform anomalies',
    settlements: 'Manage monthly merchant settlements',
    payouts: 'Review and process user withdrawal payouts',
  };

  return (
    <div className="dashboard-section fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <span className="section-label">Administration control panel</span>
          <h2 style={{ margin: '0.45rem 0 0.35rem', fontSize: '2rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>{titleMap[currentSection]}</h2>
          <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6 }}>
            Monitor partner performance, user activity, approvals, and risk from one admin workspace.
          </p>
        </div>
      </div>

      <div className="bento-grid">
        <DashboardCard title="Platform GTV" value={`₹${platformGtv.toFixed(2)}`} variant="emerald" icon={<TrendingUp size={20} />} />
        <DashboardCard title="Pending approvals" value={String(pendingCompanies.length)} variant="primary" icon={<Clock size={20} />} />
        <DashboardCard title="Partners" value={String(companies.length)} variant="violet" icon={<Building2 size={20} />} />
        <DashboardCard title="Security threats" value={String(securityLogs.length)} variant="amber" icon={<ShieldAlert size={20} />} />
      </div>

      {currentSection === 'overview' && (
        <div className="dashboard-section">
          <div className="responsive-grid-2">
            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <span className="section-label">Approval queue</span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Partners waiting for review</h3>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/admin/approvals')}>
                  Open queue
                </button>
              </div>
              {pendingCompanies.length === 0 ? (
                <div style={{ color: 'var(--text-3)' }}>No pending KYC approvals right now.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {pendingCompanies.slice(0, 3).map((company) => (
                    <div key={company.id} className="glass-card" style={{ borderRadius: '20px', padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <strong>{company.name}</strong>
                        <span className="badge badge-amber">{company.status}</span>
                      </div>
                      <div className="mono" style={{ marginTop: '0.4rem', color: 'var(--text-3)' }}>
                        {company.gstin || 'GSTIN pending'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <span className="section-label">Recent purchases</span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Latest voucher activity</h3>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/admin/ledger')}>
                  Open ledger
                </button>
              </div>
              {filteredCoupons.length === 0 ? (
                <div style={{ color: 'var(--text-3)' }}>No voucher purchases have been recorded yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {filteredCoupons.slice(0, 4).map((coupon) => (
                    <div key={coupon.coupon_id} className="glass-card" style={{ borderRadius: '20px', padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <strong className="mono">{coupon.coupon_code}</strong>
                        <span className={`badge ${coupon.is_used ? 'badge-cyan' : 'badge-green'}`}>{coupon.is_used ? 'Redeemed' : 'Active'}</span>
                      </div>
                      <div style={{ color: 'var(--text-3)', marginTop: '0.35rem' }}>{coupon.company_name} by {coupon.user_email || 'anonymous'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {currentSection === 'partners' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm((current) => !current)}>
              {showForm ? 'Cancel' : 'New partner'}
            </button>
          </div>

          {showForm && (
            <form onSubmit={handleCreate} className="card fade-in" style={{ padding: '2rem', borderColor: 'var(--cyan-border)' }}>
              <p style={{ fontWeight: 700, color: 'var(--text-1)', margin: '0 0 1.5rem', fontSize: '1.1rem' }}>New partner brand setup</p>
              
              <h4 style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Core Identity</h4>
              <div className="responsive-grid-3" style={{ marginBottom: '1.5rem' }}>
                <div>
                  <label className="label">Brand name *</label>
                  <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
                </div>
                <div>
                  <label className="label">Prefix (3 letters) *</label>
                  <input className="input mono" value={form.prefix} onChange={(event) => setForm({ ...form, prefix: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} required maxLength={3} />
                </div>
                <div>
                  <label className="label">Initial card limit *</label>
                  <input className="input mono" type="number" min={1} value={form.coupon_limit} onChange={(event) => setForm({ ...form, coupon_limit: parseInt(event.target.value, 10) || 100 })} required />
                </div>
              </div>

              <h4 style={{ margin: '1.5rem 0 1rem', fontSize: '0.9rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>Tax & Compliance (Optional)</h4>
              <div className="responsive-grid-2" style={{ marginBottom: '1.5rem' }}>
                <div>
                  <label className="label">GSTIN</label>
                  <input className="input mono" value={form.gstin} onChange={(event) => setForm({ ...form, gstin: event.target.value })} placeholder="15-character GSTIN" />
                </div>
                <div>
                  <label className="label">PAN</label>
                  <input className="input mono" value={form.pan} onChange={(event) => setForm({ ...form, pan: event.target.value.toUpperCase() })} placeholder="10-character PAN" />
                </div>
              </div>

              <h4 style={{ margin: '1.5rem 0 1rem', fontSize: '0.9rem', color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>Banking Details (Optional)</h4>
              <div className="responsive-grid-3">
                <div>
                  <label className="label">Bank Name</label>
                  <input className="input" value={form.bank_name} onChange={(event) => setForm({ ...form, bank_name: event.target.value })} placeholder="e.g. HDFC Bank" />
                </div>
                <div>
                  <label className="label">Account Number</label>
                  <input className="input mono" value={form.account_number} onChange={(event) => setForm({ ...form, account_number: event.target.value.replace(/[^0-9]/g, '') })} placeholder="Digits only" />
                </div>
                <div>
                  <label className="label">IFSC / Swift Code</label>
                  <input className="input mono" value={form.ifsc_code} onChange={(event) => setForm({ ...form, ifsc_code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
                </div>
              </div>

              {formError && <p style={{ color: 'var(--red)', fontSize: '0.8rem', margin: '1rem 0 0 0', fontWeight: 500 }}>{formError}</p>}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
                <button type="submit" disabled={formLoading} className="btn btn-primary">
                  {formLoading ? 'Registering...' : 'Confirm Registration'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setFormError(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
            {loadingCompanies ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}><div className="spinner" /></div>
            ) : stats.length === 0 ? (
              <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-3)' }}>No partner brands registered yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Brand name</th>
                      <th>Prefix</th>
                      <th>Total templates</th>
                      <th>Global card limit</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((entry) => (
                      <tr key={entry.company.id}>
                        <td>
                          <p style={{ fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>{entry.company.name}</p>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-4)', margin: 0 }}>
                            Created {new Date(entry.company.created_at).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="mono">{entry.company.prefix}</td>
                        <td className="mono">{entry.issued}</td>
                        <td>
                          <span className="mono">{entry.company.coupon_limit}</span>
                        </td>
                        <td>
                          <span className={`badge ${entry.company.status === 'approved' ? 'badge-green' : entry.company.status === 'pending' ? 'badge-amber' : 'badge-red'}`}>
                            {entry.company.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => {
                              setSelectedCompany(entry.company);
                              setEditingLimit(entry.company.coupon_limit);
                            }}
                          >
                            Manage
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          
          {selectedCompany && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.85)', display: 'flex', zIndex: 1000, padding: '1rem', overflowY: 'auto' }}>
              <div className="glass-card-strong fade-in" style={{ maxWidth: '650px', width: '100%', margin: 'auto', padding: 0, overflow: 'hidden' }}>
                {/* Modal Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-glass)', background: 'rgba(255, 255, 255, 0.03)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'var(--gradient-merchant)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '1.25rem', boxShadow: 'var(--primary-glow)' }}>
                      {selectedCompany.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-1)', fontWeight: 700, letterSpacing: '-0.02em' }}>{selectedCompany.name}</h3>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-3)' }}>Partner Management</p>
                    </div>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '0.5rem', borderRadius: '50%' }} onClick={() => setSelectedCompany(null)} aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
                
                {/* Modal Body */}
                <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Info Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    
                    {/* Profile Card */}
                    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-2)' }}>
                        <Building2 size={16} className="text-[var(--primary)]" />
                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company Profile</h4>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>Status</p>
                          <span className={`badge ${selectedCompany.status === 'approved' ? 'badge-green' : selectedCompany.status === 'pending' ? 'badge-amber' : 'badge-red'}`} style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem' }}>
                            {selectedCompany.status}
                          </span>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>Prefix</p>
                          <p className="mono" style={{ margin: 0, color: 'var(--text-1)', fontWeight: 500 }}>{selectedCompany.prefix}</p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>GSTIN</p>
                          <p className="mono" style={{ margin: 0, color: 'var(--text-1)' }}>{selectedCompany.gstin || 'Not Provided'}</p>
                        </div>
                        <div>
                          <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>PAN</p>
                          <p className="mono" style={{ margin: 0, color: 'var(--text-1)' }}>{selectedCompany.pan || 'Not Provided'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Banking Card */}
                    <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '16px', padding: '1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-2)' }}>
                        <Landmark size={16} className="text-[var(--cyan)]" />
                        <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Banking Details</h4>
                      </div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                          <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>Bank Name</p>
                          <p style={{ margin: 0, color: 'var(--text-1)', fontWeight: 500 }}>{selectedCompany.bank_name || 'Not Provided'}</p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                          <div>
                            <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>Account Number</p>
                            <p className="mono" style={{ margin: 0, color: 'var(--text-1)' }}>{selectedCompany.account_number || '-'}</p>
                          </div>
                          <div>
                            <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--text-4)' }}>IFSC / Swift</p>
                            <p className="mono" style={{ margin: 0, color: 'var(--text-1)' }}>{selectedCompany.ifsc_code || '-'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions Area */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <Activity size={16} className="text-[var(--text-3)]" />
                      <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-2)' }}>Quick Controls</h4>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {/* Global Limit Control */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', background: 'var(--bg-3)', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-1)', fontSize: '0.95rem' }}>Global Voucher Limit</p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-4)' }}>Set maximum active vouchers across all campaigns</p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <input className="input mono" style={{ width: '100px', textAlign: 'center', fontWeight: 'bold' }} type="number" value={editingLimit} onChange={(event) => setEditingLimit(parseInt(event.target.value, 10) || 1)} min={1} />
                          <button disabled={editLoading} className="btn btn-primary" style={{ padding: '0.5rem 1rem' }} onClick={() => handleUpdateLimit(selectedCompany.id, selectedCompany.name)}>
                            Apply
                          </button>
                        </div>
                      </div>

                      {/* Settlements Control */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', background: 'var(--bg-3)', padding: '1rem 1.25rem', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-1)', fontSize: '0.95rem' }}>Generate Settlements</p>
                          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-4)' }}>Process month-end payouts for this partner</p>
                        </div>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '0.5rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}
                          onClick={async () => {
                            const now = new Date();
                            const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                            try {
                              const count = await adminGenerateSettlements(prevMonth.getFullYear(), prevMonth.getMonth() + 1, selectedCompany.id);
                              success('Settlements generated', `Created ${count} settlement(s) for ${selectedCompany.name}.`);
                            } catch (err: unknown) {
                              toastError('Generation failed', getErrorMessage(err, 'Failed to generate settlements.'));
                            }
                          }}
                        >
                          <FileText size={16} /> Run Process
                        </button>
                      </div>
                      
                      {/* Danger Zone */}
                      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                         <button disabled={suspendingId === selectedCompany.id} className="btn btn-secondary" style={{ padding: '0.5rem 1.5rem', fontWeight: 600 }} onClick={() => handleSuspend(selectedCompany.id, selectedCompany.name)}>
                           {suspendingId === selectedCompany.id ? 'Processing...' : selectedCompany.status === 'suspended' ? 'Unsuspend Partner' : 'Suspend Partner'}
                         </button>
                         <button disabled={deletingId === selectedCompany.id} className="btn btn-danger" style={{ padding: '0.5rem 1.5rem', fontWeight: 600 }} onClick={() => handleDelete(selectedCompany.id, selectedCompany.name)}>
                           {deletingId === selectedCompany.id ? 'Deleting...' : 'Delete Permanently'}
                         </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {currentSection === 'offers' && (
        <div className="glass-card-strong fade-in" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h3 style={{ margin: 0 }}>Global Market Offers</h3>
            <button className="btn btn-secondary btn-sm" onClick={loadOffers} disabled={offersLoading}>
              {offersLoading ? 'Loading...' : 'Refresh Offers'}
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Offer ID</th>
                  <th>Merchant</th>
                  <th>Campaign Title</th>
                  <th>Value / Price</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {offers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-3)' }}>
                      No published offers found.
                    </td>
                  </tr>
                ) : (
                  offers.map((offer) => (
                    <tr key={offer.id}>
                      <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-4)' }}>{offer.id.split('-')[0]}...</td>
                      <td style={{ fontWeight: 600 }}>{offer.company_name || 'Unknown'}</td>
                      <td>{offer.title}</td>
                      <td className="mono" style={{ fontSize: '0.9rem' }}>
                        <span style={{ color: 'var(--text-3)' }}>Price:</span> ₹{offer.price.toFixed(2)} <br />
                        <span style={{ color: 'var(--text-3)' }}>Value:</span> ₹{offer.value.toFixed(2)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteOffer(offer.id, offer.title)}
                          disabled={deletingOfferId === offer.id}
                        >
                          {deletingOfferId === offer.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentSection === 'users' && (
        <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <span className="section-label">Registered members</span>
              <h3 style={{ margin: '0.25rem 0 0', fontSize: '1.3rem' }}>Platform users</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <input
                className="input"
                style={{ minWidth: '240px' }}
                placeholder="Search by email or ID..."
                value={userSearch}
                onChange={(event) => { setUserSearch(event.target.value); setUsersPage(0); }}
              />
              <button className="btn btn-secondary btn-sm" onClick={loadUsers} disabled={usersLoading}>
                {usersLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>

          {usersLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}><div className="spinner" /></div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-3)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</div>
              <p style={{ margin: 0, fontWeight: 600 }}>{userSearch ? 'No users match your search.' : 'No users found.'}</p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
                {userSearch ? 'Try a different email or ID.' : 'Users appear here once they register. Make sure the admin_get_users SQL function is deployed.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Email address</th>
                    <th>Joined</th>
                    <th>Role</th>
                    <th style={{ textAlign: 'right' }}>Security status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id}>
                      <td className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-4)' }} title={user.id}>
                        {user.id.split('-')[0]}…
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--text-1)' }}>{user.email}</td>
                      <td style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>
                        {new Date(user.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td>
                        <span className={`badge ${user.role === 'admin' ? 'badge-red' : user.role === 'merchant' ? 'badge-cyan' : 'badge-gray'}`}>
                          {user.role?.toUpperCase() ?? 'USER'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => toggleLockAccount(user.id)}
                          className={`btn ${lockedAccounts[user.id] ? 'btn-success' : 'btn-secondary'} btn-sm`}
                        >
                          {lockedAccounts[user.id] ? '🔓 Unlock' : '🔒 Lock'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1rem', borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-secondary btn-sm" disabled={usersPage === 0} onClick={() => setUsersPage(p => p - 1)}>
                  ← Previous
                </button>
                <span style={{ color: 'var(--text-3)', fontSize: '0.85rem', fontWeight: 600 }}>
                  Page {usersPage + 1} &nbsp;·&nbsp; Showing {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
                </span>
                <button className="btn btn-secondary btn-sm" disabled={users.length < pageSize} onClick={() => setUsersPage(p => p + 1)}>
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentSection === 'ledger' && (
        <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
            <input className="input" placeholder="Search by code, brand name, or user email..." value={couponSearch} onChange={(event) => setCouponSearch(event.target.value)} style={{ maxWidth: '380px' }} />
            <div style={{ display: 'flex', gap: '0.25rem' }}>
              {(['all', 'active', 'redeemed'] as const).map((filter) => (
                <button key={filter} onClick={() => setCouponFilter(filter)} className={`btn ${couponFilter === filter ? 'btn-primary' : 'btn-secondary'} btn-sm`} style={{ textTransform: 'capitalize' }}>
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {couponsLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}><div className="spinner" /></div>
          ) : filteredCoupons.length === 0 ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-3)' }}>No vouchers found matching the current filters.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Voucher code</th>
                    <th>Partner brand</th>
                    <th>Face value</th>
                    <th>Price paid</th>
                    <th>Consumer email</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCoupons.map((coupon) => (
                    <tr key={coupon.coupon_id}>
                      <td className="mono" style={{ fontWeight: 700, color: 'var(--cyan)' }}>{coupon.coupon_code}</td>
                      <td style={{ fontWeight: 700, color: 'var(--text-1)' }}>{coupon.company_name}</td>
                      <td className="mono">₹{(coupon.value ?? coupon.remaining_balance).toFixed(2)}</td>
                      <td className="mono">₹{(coupon.price ?? coupon.remaining_balance * 0.9).toFixed(2)}</td>
                      <td style={{ color: 'var(--text-3)' }}>{coupon.user_email || 'anonymous'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className={`badge ${coupon.is_used ? 'badge-cyan' : 'badge-green'}`}>{coupon.is_used ? 'Redeemed' : 'Active'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1rem', borderTop: '1px solid var(--border)' }}>
                <button className="btn btn-secondary btn-sm" disabled={couponsPage === 0} onClick={() => setCouponsPage(p => p - 1)}>
                  Previous
                </button>
                <span style={{ color: 'var(--text-3)', fontSize: '0.85rem', fontWeight: 600 }}>Page {couponsPage + 1}</span>
                <button className="btn btn-secondary btn-sm" disabled={purchasedCoupons.length < pageSize} onClick={() => setCouponsPage(p => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentSection === 'approvals' && (
        <div className="glass-card-strong" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr 180px', padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-2)', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', gap: '1rem' }}>
            <span>Merchant partner request</span>
            <span>Tax identifiers</span>
            <span>Attached doc</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {pendingCompanies.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-3)' }}>
              No pending KYC approvals currently in queue.
            </div>
          ) : (
            <div>
              {pendingCompanies.map((company) => (
                <div key={company.id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.2fr 180px', alignItems: 'center', padding: '1rem 1.5rem', borderBottom: '1px solid var(--border)', gap: '1rem' }}>
                  <div>
                    <p style={{ fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>{company.name}</p>
                    <p className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-4)', margin: 0 }}>
                      Bank: {company.bank_name || 'Not provided'}
                    </p>
                  </div>
                  <div>
                    <p className="mono" style={{ margin: 0, fontSize: '0.8rem' }}>GSTIN: {company.gstin || 'None'}</p>
                    <p className="mono" style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-4)' }}>PAN: {company.pan || 'None'}</p>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => setViewingDoc(company.document_url || 'cert_incorporation.pdf')}>
                    {company.document_url || 'Open document'}
                  </button>
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => handleApproveMerchant(company.id, company.name)} className="btn btn-success btn-sm">
                      Approve
                    </button>
                    <button onClick={() => handleRejectMerchant(company.id, company.name)} className="btn btn-danger btn-sm">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {viewingDoc && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,7,18,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
              <div className="glass-card-strong" style={{ maxWidth: '500px', width: '100%', padding: '2rem', textAlign: 'center' }}>
                <span style={{ fontSize: '2rem' }}>DOC</span>
                <h3 style={{ fontSize: '1.25rem', color: 'var(--text-1)', margin: '0.5rem 0' }}>Document vault preview</h3>
                <p className="mono" style={{ background: 'var(--bg-3)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '0.85rem', color: 'var(--cyan)' }}>
                  {viewingDoc}
                </p>
                <button onClick={() => setViewingDoc(null)} className="btn btn-secondary" style={{ marginTop: '1rem', width: '100%' }}>
                  Close preview
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentSection === 'security' && (
        <div className="dashboard-section fade-in">
          <div className="glass-card-strong" style={{ padding: '2rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--text-1)' }}>
              <ShieldAlert size={20} style={{ color: 'var(--amber-500)' }} />
              Security incident log
            </h3>
            <p style={{ color: 'var(--text-3)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              Review recent anomalies, failed assertions, or suspiciously rapid transaction flows detected by the platform guardrails.
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event type</th>
                    <th>Severity</th>
                    <th>Target / Actor</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {securityLogs.map((log, idx) => (
                    <tr key={idx}>
                      <td style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>{log.time}</td>
                      <td style={{ fontWeight: 600, color: 'var(--text-2)' }}>{log.event}</td>
                      <td>
                        <span className={`badge ${log.severity === 'High' ? 'badge-red' : log.severity === 'Medium' ? 'badge-amber' : 'badge-cyan'}`}>
                          {log.severity}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-3)' }}>{log.target}</td>
                      <td style={{ color: 'var(--text-2)', fontSize: '0.9rem', maxWidth: '300px', whiteSpace: 'normal', lineHeight: 1.5 }}>
                        {log.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {currentSection === 'settlements' && (
        <div className="dashboard-section fade-in">
          <div className="glass-card-strong" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--text-1)' }}>Month-End Settlements</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.95rem' }}>Generate and track payouts owed to merchants for redeemed coupons.</p>
              </div>
              <button 
                className="btn btn-primary"
                onClick={async () => {
                  const now = new Date();
                  // Default to previous month
                  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                  try {
                    const count = await adminGenerateSettlements(prevMonth.getFullYear(), prevMonth.getMonth() + 1);
                    success('Settlements generated', `Created ${count} new settlements for ${prevMonth.toLocaleDateString('default', { month: 'long', year: 'numeric' })}.`);
                    await loadSettlements();
                  } catch (err: unknown) {
                    toastError('Generation failed', getErrorMessage(err, 'Failed to generate settlements.'));
                  }
                }}
              >
                Generate Previous Month
              </button>
            </div>
            
            {settlementsLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-4)' }}>Loading settlements...</div>
            ) : settlements.length === 0 ? (
              <div className="empty-state" style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-3)', margin: 0 }}>No settlements generated yet.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Company</th>
                      <th style={{ textAlign: 'right' }}>Total Redemptions</th>
                      <th style={{ textAlign: 'right' }}>Amount Due</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((settlement) => (
                      <tr key={settlement.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{settlement.period_month}</td>
                        <td style={{ color: 'var(--text-2)' }}>{settlement.company?.name || 'Unknown'}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>{settlement.total_redemptions}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--violet-400)' }}>₹{settlement.amount_due.toFixed(2)}</td>
                        <td>
                          <span className={`badge ${settlement.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                            {settlement.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {settlement.status === 'pending' && (
                            <button 
                              className="btn btn-secondary btn-sm"
                              onClick={async () => {
                                try {
                                  await adminMarkSettlementPaid(settlement.id);
                                  success('Settlement paid', 'The settlement has been marked as paid.');
                                  await loadSettlements();
                                } catch (err: unknown) {
                                  toastError('Update failed', getErrorMessage(err, 'Failed to mark as paid.'));
                                }
                              }}
                            >
                              Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {currentSection === 'payouts' && (
        <div className="dashboard-section fade-in">
          <div className="glass-card-strong" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--text-1)' }}>User Payout Requests</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.95rem' }}>Review pending withdrawals, manually transfer funds via PayPal, and update statuses.</p>
              </div>
            </div>
            
            {withdrawalsLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-4)' }}>Loading payouts...</div>
            ) : withdrawals.length === 0 ? (
              <div className="empty-state" style={{ padding: '3rem', textAlign: 'center' }}>
                <p style={{ color: 'var(--text-3)', margin: 0 }}>No payouts found.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>User Email</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th>Method / Account</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>
                          {new Date(w.created_at).toLocaleString()}
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{w.email}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--violet-400)' }}>
                          ₹{w.amount.toFixed(2)}
                        </td>
                        <td style={{ color: 'var(--text-2)', fontSize: '0.9rem' }}>
                          <span style={{ fontWeight: 600, textTransform: 'uppercase', marginRight: '0.5rem', fontSize: '0.8rem', padding: '0.2rem 0.4rem', borderRadius: '4px', background: 'var(--surface-soft)' }}>
                            {w.routing_number}
                          </span>
                          <span className="mono">{w.account_number}</span>
                        </td>
                        <td>
                          <span className={`badge ${w.status === 'completed' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-amber'}`}>
                            {w.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {w.status === 'pending' && (
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                              <button 
                                className="btn btn-secondary btn-sm"
                                style={{ backgroundColor: '#10b981', color: 'white', border: 'none', cursor: 'pointer' }}
                                onClick={() => setConfirmModal({
                                  show: true,
                                  title: 'Confirm Payout Completion',
                                  message: `Are you sure you want to mark the withdrawal of ₹${w.amount.toFixed(2)} for ${w.email} as COMPLETED? Make sure you have manually sent the funds via PayPal first.`,
                                  actionType: 'approve',
                                  withdrawalId: w.id,
                                  amount: w.amount,
                                  email: w.email,
                                })}
                              >
                                Mark Paid
                              </button>
                              <button 
                                className="btn btn-secondary btn-sm"
                                style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', cursor: 'pointer' }}
                                onClick={() => setConfirmModal({
                                  show: true,
                                  title: 'Reject Payout Request',
                                  message: `Are you sure you want to REJECT the withdrawal of ₹${w.amount.toFixed(2)} for ${w.email}? This will automatically refund the money back into their wallet balance.`,
                                  actionType: 'reject',
                                  withdrawalId: w.id,
                                  amount: w.amount,
                                  email: w.email,
                                })}
                              >
                                Reject & Refund
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {confirmModal.show && (
        <div className="glass-modal-overlay" style={{ zIndex: 10000 }}>
          <div className="glass-modal-panel" style={{ maxWidth: '480px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
              <div style={{ 
                width: '60px', 
                height: '60px', 
                borderRadius: '50%', 
                backgroundColor: confirmModal.actionType === 'approve' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                display: 'grid', 
                placeItems: 'center' 
              }}>
                <Landmark size={30} style={{ color: confirmModal.actionType === 'approve' ? '#10b981' : '#ef4444' }} />
              </div>
            </div>
            
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--text-1)', textAlign: 'center' }}>
              {confirmModal.title}
            </h3>
            
            <p style={{ margin: '0 0 2rem', color: 'var(--text-3)', fontSize: '0.95rem', lineHeight: '1.6', textAlign: 'center' }}>
              {confirmModal.message}
            </p>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button 
                className="btn btn-secondary" 
                onClick={() => setConfirmModal(prev => ({ ...prev, show: false }))}
                style={{ padding: '0.75rem 1.5rem', borderRadius: '12px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button 
                className="btn" 
                onClick={async () => {
                  if (!confirmModal.withdrawalId || !confirmModal.actionType) return;
                  try {
                    const status = confirmModal.actionType === 'approve' ? 'completed' : 'rejected';
                    await adminUpdateWithdrawalStatus(confirmModal.withdrawalId, status);
                    success(
                      confirmModal.actionType === 'approve' ? 'Payout completed' : 'Payout rejected',
                      confirmModal.actionType === 'approve' ? 'The withdrawal has been marked as completed.' : 'The withdrawal has been rejected and refunded.'
                    );
                    setConfirmModal(prev => ({ ...prev, show: false }));
                    await loadWithdrawals();
                  } catch (err: unknown) {
                    toastError('Update failed', getErrorMessage(err, 'Failed to update withdrawal status.'));
                  }
                }}
                style={{ 
                  padding: '0.75rem 1.5rem', 
                  borderRadius: '12px', 
                  backgroundColor: confirmModal.actionType === 'approve' ? '#10b981' : '#ef4444', 
                  color: 'white', 
                  border: 'none', 
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                {confirmModal.actionType === 'approve' ? 'Yes, Complete Payout' : 'Yes, Reject & Refund'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
