import CardBackgroundPicker from '../components/CardBackgroundPicker';
import CouponBackgroundEditor from '../components/CouponBackgroundEditor';
import { DEFAULT_CARD_BACKGROUND, cardBackgroundImage, normalizeCardBackground } from '../lib/cardBackgrounds';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CountrySelector from '../components/CountrySelector';
import { getCountryByCode } from '../lib/countries';
import { formatCurrency } from '../lib/exchangeRate';
import { Rocket, Store, AlertCircle, Edit3, Pause, Play, Copy, Trash2, Search, CheckCircle2, Clock, X, Layers, Filter } from 'lucide-react';
import { useNow } from '../hooks/useNow';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { DashboardCard } from '../components/GlassCard';
import { LoadingPage } from '../components/LoadingPage';
import type { Company, GiftCard, RedemptionTransaction } from '../lib/supabase';
import {
  createGiftCard,
  updateGiftCard,
  toggleGiftCardActive,
  updateGiftCardCountry,
  deleteGiftCard,
  getCompanyByOwner,
  getGiftCards,
  getRedemptionTransactions,
  submitOnboarding,
  uploadMerchantDocument,
  getCompanyCoupons,
  merchantGetSettlements,
} from '../lib/supabase';

const validSections = ['overview', 'campaigns', 'coupons', 'redemptions', 'settlements', 'onboarding'] as const;
type MerchantSection = (typeof validSections)[number];

function isMerchantSection(value: string | undefined): value is MerchantSection {
  return !!value && validSections.includes(value as MerchantSection);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return fallback;
}

function getDefaultExpiryDate() {
  return new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
}

function createInitialWizardForm() {
  return {
    title: '',
    description: '',
    value: '50',
    price: '50',
    expiryDate: getDefaultExpiryDate(),
    bannerImage: DEFAULT_CARD_BACKGROUND,
    terms: 'Valid at all participating locations. Cannot be exchanged for cash.',
    issueLimit: '',
    countryCode: ''
  };
}

export default function MerchantDashboard() {
  const now = useNow();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();

  const currentSection: MerchantSection = isMerchantSection(section) ? section : 'overview';

  const [loadingCompany, setLoadingCompany] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);

  const [kycStep, setKycStep] = useState(1);
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [uploadedDocument, setUploadedDocument] = useState<string | null>(null);
  const [onboardingForm, setOnboardingForm] = useState({
    businessName: '',
    prefix: '',
    gstin: '',
    pan: '',
    address: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
  });

  const [offers, setOffers] = useState<GiftCard[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionTransaction[]>([]);
  const [purchasedCoupons, setPurchasedCoupons] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    totalSales: 0,
    couponsRedeemed: 0,
    activeOffers: 0,
    liabilities: 0,
  });

  const [wizardStep, setWizardStep] = useState(1);
  const [wizardForm, setWizardForm] = useState(createInitialWizardForm);

  // Campaign management & filtering state
  const [offerSearch, setOfferSearch] = useState('');
  const [offerStatusFilter, setOfferStatusFilter] = useState<'all' | 'active' | 'paused' | 'sold_out' | 'expired'>('all');
  const [offerSortBy, setOfferSortBy] = useState<'newest' | 'sales' | 'price_desc' | 'price_asc' | 'expiry'>('newest');

  // Edit campaign modal state
  const [editingOffer, setEditingOffer] = useState<GiftCard | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    terms: '',
    price: '',
    value: '',
    issueLimit: '',
    expiryDate: '',
    countryCode: '',
    bannerImage: DEFAULT_CARD_BACKGROUND,
    isActive: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [togglingOfferId, setTogglingOfferId] = useState<string | null>(null);

  const [settlements, setSettlements] = useState<any[]>([]);


  useEffect(() => {
    if (!section) {
      navigate('/merchant/overview', { replace: true });
      return;
    }

    if (!isMerchantSection(section)) {
      navigate('/merchant/overview', { replace: true });
    }
  }, [navigate, section]);

  const userId = user?.id;

  const toastErrorRef = useRef(toastError);
  useEffect(() => { toastErrorRef.current = toastError; }, [toastError]);

  const fetchMerchantProfile = useCallback(async () => {
    if (!userId) return;

    try {
      setLoadingCompany(true);
      const profile = await getCompanyByOwner(userId);
      setCompany(profile);

      if (profile && profile.status === 'approved') {
        const [cards, transactions, coupons, merchantSettlements] = await Promise.all([
          getGiftCards(profile.id),
          getRedemptionTransactions(undefined, profile.id),
          getCompanyCoupons(profile.id),
          merchantGetSettlements(profile.id)
        ]);

        setOffers(cards);
        setRedemptions(transactions);
        setPurchasedCoupons(coupons);
        setSettlements(merchantSettlements);

        const totalRedeemedValue = transactions.reduce((acc, transaction) => acc + transaction.amount, 0);

        setMetrics({
          totalSales: totalRedeemedValue,
          couponsRedeemed: transactions.length,
          activeOffers: cards.filter(card => card.is_active && new Date(card.expiry_date).getTime() > Date.now()).length,
          liabilities: cards.reduce((acc, card) => acc + card.value, 0) - totalRedeemedValue,
        });
      } else {
        setOffers([]);
        setRedemptions([]);
        setPurchasedCoupons([]);
        setSettlements([]);
      }
    } catch (err: unknown) {
      toastErrorRef.current('Error', getErrorMessage(err, 'Failed to load company profile.'));
    } finally {
      setLoadingCompany(false);
    }
  }, [userId]);

  useEffect(() => {
    const syncProfile = async () => {
      await fetchMerchantProfile();
    };

    void syncProfile();
  }, [fetchMerchantProfile]);

  const handleKycSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (kycStep === 2 && !kycFile) { toastError('Document required', 'Choose your business verification document.'); return; }
    if (kycStep < 3) {
      setKycStep((previous) => previous + 1);
      return;
    }

    try {
      setLoadingCompany(true);
      if (!user?.id || !kycFile) throw new Error('A signed-in account and KYC document are required.');
      const documentPath = uploadedDocument ?? await uploadMerchantDocument(user.id, kycFile);
      setUploadedDocument(documentPath);
      const payload: Partial<Company> = {
        name: onboardingForm.businessName,
        prefix: onboardingForm.prefix || onboardingForm.businessName.substring(0, 3),
        coupon_limit: 500,
        gstin: onboardingForm.gstin,
        pan: onboardingForm.pan,
        address: onboardingForm.address,
        bank_name: onboardingForm.bankName,
        account_number: onboardingForm.accountNumber,
        ifsc_code: onboardingForm.ifscCode,
        document_url: documentPath,
        owner_id: user?.id,
      };

      const newCompany = await submitOnboarding(payload);
      setCompany(newCompany);
      success('Profile submitted', 'Your business profile is pending admin activation.');
      navigate('/merchant/onboarding');
    } catch (err: unknown) {
      toastError('Submission error', getErrorMessage(err, 'Failed to submit merchant profile.'));
    } finally {
      setLoadingCompany(false);
    }
  };

  const handleCreateCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!company) return;

    if (!wizardForm.countryCode) { toastError('Country required', 'Select the country allowed to buy and redeem this coupon.'); return; }
    if (wizardStep < 3) {
      setWizardStep(wizardStep + 1);
      return;
    }

    try {
      const valueNum = parseFloat(wizardForm.value);
      const priceNum = parseFloat(wizardForm.price);
      const issueLimitNum = wizardForm.issueLimit ? parseInt(wizardForm.issueLimit, 10) : null;
      
      if (isNaN(valueNum) || valueNum <= 0) throw new Error('Card face value must be positive.');
      if (isNaN(priceNum) || priceNum < 0) throw new Error('Price cannot be negative.');
      if (issueLimitNum !== null && (isNaN(issueLimitNum) || issueLimitNum <= 0)) throw new Error('Issue limit must be positive.');
      if (issueLimitNum !== null && company.coupon_limit && issueLimitNum > company.coupon_limit) {
        throw new Error(`Limit cannot exceed your company's global maximum of ${company.coupon_limit}.`);
      }

      const banner = normalizeCardBackground(wizardForm.bannerImage);
      if (!banner) throw new Error('Choose a background design or enter a valid HTTPS image URL.');
      const newCard = await createGiftCard({
        company_id: company.id,
        country_code: wizardForm.countryCode,
        title: wizardForm.title,
        description: wizardForm.description,
        value: valueNum,
        price: priceNum,
        expiry_date: new Date(wizardForm.expiryDate).toISOString(),
        banner_image: banner,
        terms: wizardForm.terms,
        issue_limit: issueLimitNum,
      });

      success('Campaign launched', `"${newCard.title}" has been published to the marketplace.`);
      setWizardForm(createInitialWizardForm());
      setWizardStep(1);
      navigate('/merchant/overview');
      fetchMerchantProfile();
    } catch (err: unknown) {
      toastError('Creation error', getErrorMessage(err, 'Failed to create campaign.'));
    }
  };

  const handleStartEdit = (offer: GiftCard) => {
    setEditingOffer(offer);
    setEditForm({
      title: offer.title,
      description: offer.description || '',
      terms: offer.terms || '',
      price: String(offer.price),
      value: String(offer.value),
      issueLimit: offer.issue_limit ? String(offer.issue_limit) : '',
      expiryDate: offer.expiry_date ? offer.expiry_date.slice(0, 10) : '',
      countryCode: offer.country_code || '',
      bannerImage: offer.banner_image || DEFAULT_CARD_BACKGROUND,
      isActive: offer.is_active !== false,
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOffer || !company) return;
    const priceNum = parseFloat(editForm.price);
    const valueNum = parseFloat(editForm.value);
    const limitNum = editForm.issueLimit ? parseInt(editForm.issueLimit, 10) : null;

    if (isNaN(priceNum) || priceNum < 0) {
      toastError('Invalid price', 'Selling price cannot be negative.');
      return;
    }
    if (isNaN(valueNum) || valueNum <= 0) {
      toastError('Invalid value', 'Card face value must be positive.');
      return;
    }
    if (limitNum !== null && (isNaN(limitNum) || limitNum <= 0)) {
      toastError('Invalid issue limit', 'Issue limit must be positive.');
      return;
    }
    if (limitNum !== null && (editingOffer.issued_count || 0) > limitNum) {
      toastError('Issue limit too low', `Already sold ${editingOffer.issued_count} vouchers. Limit cannot be lower than existing sales.`);
      return;
    }
    if (limitNum !== null && company.coupon_limit && limitNum > company.coupon_limit) {
      toastError('Exceeds limit', `Limit cannot exceed your company maximum of ${company.coupon_limit}.`);
      return;
    }

    setSavingEdit(true);
    try {
      const updated = await updateGiftCard(editingOffer.id, company.id, {
        title: editForm.title,
        description: editForm.description,
        terms: editForm.terms,
        price: priceNum,
        value: valueNum,
        issue_limit: limitNum,
        expiry_date: editForm.expiryDate ? new Date(editForm.expiryDate).toISOString() : undefined,
        country_code: editForm.countryCode,
        banner_image: editForm.bannerImage,
        is_active: editForm.isActive,
      });

      setOffers(prev => prev.map(o => o.id === updated.id ? { ...o, ...updated } : o));
      success('Campaign updated', `"${updated.title}" has been saved.`);
      setEditingOffer(null);
      await fetchMerchantProfile();
    } catch (err: unknown) {
      toastError('Update failed', getErrorMessage(err, 'Could not save campaign updates.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (offer: GiftCard) => {
    if (!company) return;
    const nextStatus = offer.is_active === false;
    setTogglingOfferId(offer.id);
    try {
      await toggleGiftCardActive(offer.id, company.id, nextStatus);
      setOffers(prev => prev.map(o => o.id === offer.id ? { ...o, is_active: nextStatus } : o));
      success(
        nextStatus ? 'Campaign resumed' : 'Campaign paused',
        nextStatus
          ? `"${offer.title}" is now active and visible in the marketplace.`
          : `"${offer.title}" is paused and hidden from marketplace buyers.`
      );
    } catch (err: unknown) {
      toastError('Status change failed', getErrorMessage(err, 'Could not update campaign status.'));
    } finally {
      setTogglingOfferId(null);
    }
  };

  const handleCloneCampaign = (offer: GiftCard) => {
    setWizardForm({
      title: `${offer.title} (Copy)`,
      description: offer.description || '',
      terms: offer.terms || '',
      price: String(offer.price),
      value: String(offer.value),
      issueLimit: offer.issue_limit ? String(offer.issue_limit) : '',
      expiryDate: getDefaultExpiryDate(),
      countryCode: offer.country_code || '',
      bannerImage: offer.banner_image || DEFAULT_CARD_BACKGROUND,
    });
    setWizardStep(1);
    success('Campaign cloned', 'Wizard prefilled with campaign details. Review and publish your new campaign.');
    window.scrollTo({ top: 300, behavior: 'smooth' });
  };

  const handleDeleteCampaign = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete the campaign "${title}"? This action cannot be undone.`)) return;
    try {
      await deleteGiftCard(id);
      success('Campaign deleted', `"${title}" has been removed from the marketplace.`);
      fetchMerchantProfile();
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to delete campaign.');
      if (msg.includes('already purchased') || msg.includes('customer')) {
        toastError('Cannot delete active campaign', 'Customers have already purchased vouchers from this campaign. Pause the campaign instead to remove it from the marketplace while preserving buyer vouchers.');
      } else {
        toastError('Deletion error', msg);
      }
    }
  };

  const filteredOffers = useMemo(() => {
    return offers.filter(offer => {
      const isExpired = !!offer.expiry_date && new Date(offer.expiry_date).getTime() <= now;
      const isSoldOut = !!offer.issue_limit && (offer.issued_count || 0) >= offer.issue_limit;
      const isPaused = offer.is_active === false;
      const isActive = !isPaused && !isExpired && !isSoldOut;

      if (offerStatusFilter === 'active' && !isActive) return false;
      if (offerStatusFilter === 'paused' && !isPaused) return false;
      if (offerStatusFilter === 'sold_out' && !isSoldOut) return false;
      if (offerStatusFilter === 'expired' && !isExpired) return false;

      if (offerSearch.trim()) {
        const query = offerSearch.toLowerCase().trim();
        const matchesTitle = offer.title.toLowerCase().includes(query);
        const matchesDesc = (offer.description || '').toLowerCase().includes(query);
        const country = getCountryByCode(offer.country_code || '');
        const matchesCountry = country?.name.toLowerCase().includes(query) || (offer.country_code || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc && !matchesCountry) return false;
      }

      return true;
    }).sort((a, b) => {
      if (offerSortBy === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      if (offerSortBy === 'sales') return (b.issued_count || 0) - (a.issued_count || 0);
      if (offerSortBy === 'price_desc') return b.price - a.price;
      if (offerSortBy === 'price_asc') return a.price - b.price;
      if (offerSortBy === 'expiry') return new Date(a.expiry_date || 0).getTime() - new Date(b.expiry_date || 0).getTime();
      return 0;
    });
  }, [offers, offerStatusFilter, offerSearch, offerSortBy, now]);

  const statusCounts = useMemo(() => {
    let active = 0, paused = 0, soldOut = 0, expired = 0;
    for (const o of offers) {
      const isExp = !!o.expiry_date && new Date(o.expiry_date).getTime() <= now;
      const isSold = !!o.issue_limit && (o.issued_count || 0) >= o.issue_limit;
      const isPsd = o.is_active === false;
      if (isPsd) paused++;
      else if (isExp) expired++;
      else if (isSold) soldOut++;
      else active++;
    }
    return { all: offers.length, active, paused, soldOut, expired };
  }, [offers, now]);

  const handleResendApprovalRequest = async () => {
    if (!company || !user?.id) return;
    try {
      setLoadingCompany(true);
      const updatedCompany = await submitOnboarding({
        ...company,
        status: 'pending',
        owner_id: user.id,
      });
      setCompany(updatedCompany);
      success('Approval reminder sent', 'Admin has been notified to review your profile.');
    } catch (err: unknown) {
      toastError('Action failed', getErrorMessage(err, 'Failed to resend approval request.'));
    } finally {
      setLoadingCompany(false);
    }
  };


  const companyStatusTone =
    company?.status === 'approved' ? 'badge-green' : company?.status === 'rejected' ? 'badge-red' : 'badge-amber';

  const merchantHasApproval = company?.status === 'approved';


  const countryMoney = (amount: number, country?: string | null) => country
    ? formatCurrency(amount, getCountryByCode(country).currency) : `${amount.toFixed(2)} (country unset)`;
  const moneySummary = (totals: Record<string, number>) => Object.entries(totals).map(([country, amount]) => countryMoney(amount, country === 'unset' ? null : country)).join(' · ') || '0';
  const redeemedByCountry = useMemo(() => redemptions.reduce<Record<string, number>>((totals, row) => {
    const coupon = purchasedCoupons.find(c => c.id === row.coupon_id);
    const country = coupon?.country_code ?? 'unset'; totals[country] = (totals[country] ?? 0) + row.amount; return totals;
  }, {}), [redemptions, purchasedCoupons]);
  const balanceByCountry = useMemo(() => purchasedCoupons.reduce<Record<string, number>>((totals, coupon) => {
    const country = coupon.country_code ?? 'unset'; totals[country] = (totals[country] ?? 0) + coupon.remaining_balance; return totals;
  }, {}), [purchasedCoupons]);

  const recentOffers = useMemo(() => offers.slice(0, 3), [offers]);
  const recentTransactions = useMemo(() => redemptions.slice(0, 5), [redemptions]);

  if (loadingCompany) {
    return <LoadingPage message="Loading merchant dashboard..." />;
  }

  return (
    <div className="dashboard-section fade-in">
      {currentSection === 'overview' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <span className="section-label">Merchant operations</span>
              <h2 style={{ margin: '0.45rem 0 0.35rem', fontSize: '2rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
                {company?.name || 'Merchant workspace'}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6 }}>
                Manage onboarding, publish cards, and validate redemptions from one place.
              </p>
            </div>
          </div>

          <div className="responsive-grid-4">
            <DashboardCard title="Redeemed value" value={moneySummary(redeemedByCountry)} variant="primary" icon={<span style={{ fontSize: '1rem' }}>₹</span>} />
            <DashboardCard title="Coupons redeemed" value={String(metrics.couponsRedeemed)} variant="emerald" icon={<span style={{ fontSize: '1rem' }}>✓</span>} />
            <DashboardCard title="Active campaigns" value={String(metrics.activeOffers)} variant="violet" icon={<span style={{ fontSize: '1rem' }}>🚀</span>} />
            <DashboardCard title="Current status" value={company?.status || 'Not started'} variant="amber" icon={<span style={{ fontSize: '1rem' }}>⚡</span>} />
          </div>
        </>
      )}

      {!company && currentSection !== 'onboarding' && (
        <div className="glass-card-strong" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <span className="section-label">Setup needed</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem' }}>Complete onboarding to unlock merchant tools</h3>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
            Start onboarding
          </button>
        </div>
      )}

      {company?.status === 'pending' && currentSection !== 'onboarding' && (
        <div className="glass-card-strong" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <span className="section-label">Verification in progress</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem' }}>Your company profile is waiting for admin approval</h3>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
            View onboarding status
          </button>
        </div>
      )}

      {currentSection === 'overview' && (
        <div className="dashboard-section">
          <div className="responsive-grid-2">
            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <span className="section-label">Company snapshot</span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Profile & approval state</h3>
                </div>
                <span className={`badge ${companyStatusTone}`}>{company?.status || 'not started'}</span>
              </div>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {[
                  { label: 'Brand prefix', value: company?.prefix || '---', mono: true },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'rgba(79,99,245,0.04)', borderRadius: '12px' }}>
                    <span style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>{row.label}</span>
                    <strong className={row.mono ? 'mono' : ''}>{row.value}</strong>
                  </div>
                ))}
                {(() => {
                  const globalLimit = company?.coupon_limit || 0;
                  const totalIssued = offers.reduce((acc, offer) => acc + (offer.issued_count || 0), 0);
                  const availableLimit = Math.max(0, globalLimit - totalIssued);
                  return (
                    <>
                      {[
                        { label: 'Total global limit', value: String(globalLimit), mono: false },
                        { label: 'Used limit (issued)', value: String(totalIssued), mono: false },
                        { label: 'Available limit', value: String(availableLimit), mono: false, color: availableLimit > 0 ? 'var(--green)' : 'var(--red)' },
                      ].map(row => (
                        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'rgba(79,99,245,0.04)', borderRadius: '12px' }}>
                          <span style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>{row.label}</span>
                          <strong style={row.color ? { color: row.color } : {}}>{row.value}</strong>
                        </div>
                      ))}
                    </>
                  );
                })()}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'rgba(79,99,245,0.04)', borderRadius: '12px', marginTop: '0.25rem', borderTop: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.88rem' }}>Outstanding liability</span>
                  <strong>{moneySummary(balanceByCountry)}</strong>
                </div>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ marginBottom: '1.25rem' }}>
                <span className="section-label">Quick navigation</span>
                <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Move between merchant tools</h3>
              </div>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('/merchant/campaigns')}>
                  🚀 Launch a new campaign
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
                  📋 Review onboarding details
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/merchant/redemptions')}>
                  🔍 View redemption log
                </button>
              </div>
            </div>
          </div>

          {recentOffers.length === 0 && company?.status === 'approved' && (
            <div className="premium-gradient-card" style={{ padding: '2rem', display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div className="premium-gradient-card__bg" />
              <div className="premium-gradient-card__shimmer" />
              <div style={{ position: 'relative', zIndex: 1, background: 'rgba(255,255,255,0.18)', padding: '1.25rem', borderRadius: '50%', color: '#fff' }}>
                <Rocket size={32} />
              </div>
              <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
                <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.4rem', color: '#fff', fontWeight: 800 }}>Welcome to your Merchant Dashboard!</h3>
                <p style={{ margin: 0, color: 'rgba(255,255,255,0.82)' }}>You are fully verified. Your next step is to create a Campaign to launch your first gift card into the marketplace.</p>
              </div>
              <button className="btn" onClick={() => navigate('/merchant/campaigns')} style={{ position: 'relative', zIndex: 1, background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', backdropFilter: 'blur(8px)' }}>
                Launch First Campaign
              </button>
            </div>
          )}

          <div className="responsive-grid-2">
            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <span className="section-label">Active campaigns</span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Recent gift card launches</h3>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/merchant/campaigns')}>
                  Manage
                </button>
              </div>
              {recentOffers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', background: 'rgba(79,99,245,0.04)', borderRadius: '16px' }}>
                  <Store size={28} style={{ color: 'var(--text-4)', marginBottom: '0.75rem' }} />
                  <div style={{ fontWeight: 600 }}>No campaigns yet</div>
                  <div style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Create a campaign to publish your first card.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {recentOffers.map((offer) => (
                    <div key={offer.id} className="glass-card" style={{ borderRadius: '16px', padding: '1rem' }}>
                      <div style={{ fontWeight: 700 }}>{offer.title}</div>
                      <div style={{ color: 'var(--text-3)', marginTop: '0.25rem', fontSize: '0.88rem' }}>
                        <label className="label" htmlFor={`offer-country-${offer.id}`}>Eligible country</label>
                        <CountrySelector id={`offer-country-${offer.id}`} value={offer.country_code} required onChange={async country => {
                          try { await updateGiftCardCountry(offer.id, country.code); await fetchMerchantProfile(); success('Country saved', `Only ${country.name} users can purchase new coupons.`); }
                          catch (error) { toastError('Country update failed', getErrorMessage(error, 'Please retry.')); }
                        }} />
                        Sell at {(offer.currency ? formatCurrency(offer.price, offer.currency) : "Set country")} for {(offer.currency ? formatCurrency(offer.value, offer.currency) : offer.value.toFixed(2))} of value
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div>
                  <span className="section-label">Recent redemptions</span>
                  <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Latest cashier activity</h3>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('/merchant/redemptions')}>
                  Open
                </button>
              </div>
              {recentTransactions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', background: 'rgba(79,99,245,0.04)', borderRadius: '16px' }}>
                  <AlertCircle size={28} style={{ color: 'var(--text-4)', marginBottom: '0.75rem' }} />
                  <div style={{ fontWeight: 600 }}>No redemptions logged</div>
                  <div style={{ color: 'var(--text-3)', fontSize: '0.9rem', marginTop: '0.25rem' }}>Transactions will appear once customers scan.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {recentTransactions.map((redemption) => (
                    <div key={redemption.id} className="glass-card" style={{ borderRadius: '16px', padding: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <strong className="mono" style={{ fontSize: '0.9rem' }}>{redemption.coupon_code || 'COUPON'}</strong>
                        <span className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>-🪙{redemption.amount.toFixed(2)}</span>
                      </div>
                      <div style={{ color: 'var(--text-3)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
                        Remaining balance 🪙{redemption.remaining_balance_after.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {currentSection === 'campaigns' && (
        !merchantHasApproval ? (
          <div className="glass-card-strong" style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
            <span className="section-label">Approval required</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Publishing campaigns is locked</h3>
            <p style={{ color: 'var(--text-3)', marginTop: '0.85rem', lineHeight: 1.7 }}>
              Your business profile must be approved by the admin before new gift card campaigns can be published.
              Return to the onboarding tab to check the approval status or resend the review request.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
              View onboarding status
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem', alignItems: 'start' }}>
          <div className="glass-card-strong" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              {[1, 2, 3].map((step) => (
                <div
                  key={step}
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: step === wizardStep ? 'var(--cyan)' : 'var(--text-4)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: `2px solid ${step === wizardStep ? 'var(--cyan)' : 'transparent'}`,
                    paddingBottom: '4px',
                  }}
                >
                  Step {step}
                </div>
              ))}
            </div>

            {offers.length > 0 && <details className="glass-card" style={{ padding: '1rem', marginBottom: '1rem' }}>
              <summary>Manage published coupons ({offers.length})</summary>
              {offers.map(offer => <div key={offer.id} style={{ marginTop: '1rem' }}>
                <label className="label" htmlFor={`campaign-country-${offer.id}`}>{offer.title}</label>
                <CountrySelector id={`campaign-country-${offer.id}`} value={offer.country_code} onChange={async country => {
                  try { await updateGiftCardCountry(offer.id, country.code); await fetchMerchantProfile(); success('Country saved', 'Country applies to new purchases; issued coupons keep their original country.'); }
                  catch (error) { toastError('Country update failed', getErrorMessage(error, 'Please retry.')); }
                }} />
                <CouponBackgroundEditor offer={offer} onSaved={image => setOffers(rows => rows.map(row => row.id === offer.id ? { ...row, banner_image: image } : row))} />
              </div>)}
            </details>}
            <form onSubmit={handleCreateCampaign} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {wizardStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-1)', margin: 0 }}>Gift card details</h3>
                  <div className="form-group">
                    <label className="label" htmlFor="coupon-country">Coupon country (required)</label>
                    <CountrySelector id="coupon-country" required value={wizardForm.countryCode} onChange={country => setWizardForm({ ...wizardForm, countryCode: country.code })} />
                    <p>Only users registered in this country can buy and redeem this coupon. Values use its local currency without conversion.</p>
                  </div>
                  <div>
                    <label className="label">Gift card title</label>
                    <input className="input" required placeholder="Starbucks Premium Brew Card" value={wizardForm.title} onChange={(event) => setWizardForm({ ...wizardForm, title: event.target.value })} />
                  </div>
                  <div>
                    <label className="label">Voucher description</label>
                    <textarea
                      className="input"
                      required
                      placeholder="Describe what items or discounts are redeemable with this card..."
                      style={{ minHeight: '80px', resize: 'vertical' }}
                      value={wizardForm.description}
                      onChange={(event) => setWizardForm({ ...wizardForm, description: event.target.value })}
                    />
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-1)', margin: 0 }}>Values and expiry</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="label">Face value ({wizardForm.countryCode ? getCountryByCode(wizardForm.countryCode).currency : "local currency"})</label>
                      <input className="input mono" type="number" required min={1} value={wizardForm.value} onChange={(event) => setWizardForm({ ...wizardForm, value: event.target.value, price: event.target.value })} />
                    </div>
                    <div>
                      <label className="label">Selling price ({wizardForm.countryCode ? getCountryByCode(wizardForm.countryCode).currency : "local currency"})</label>
                      <input className="input mono" type="number" required min={0} value={wizardForm.price} readOnly style={{ backgroundColor: 'var(--bg-3)', opacity: 0.7, cursor: 'not-allowed' }} title="Selling price must match face value" />
                    </div>
                  </div>
                  <div>
                    <label className="label">Expiry date</label>
                    <input className="input mono" type="date" required value={wizardForm.expiryDate} onChange={(event) => setWizardForm({ ...wizardForm, expiryDate: event.target.value })} />
                  </div>
                  <div style={{ background: 'var(--bg-3)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', marginTop: '0.5rem' }}>
                    <label className="label">Total Issue Limit (Optional)</label>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-3)', margin: '0 0 0.5rem 0' }}>
                      Maximum number of cards that can be sold for this campaign. Max allowed: {company?.coupon_limit || 0}.
                    </p>
                    <input className="input mono" type="number" min={1} max={company?.coupon_limit || 100} placeholder="Unlimited" value={wizardForm.issueLimit} onChange={(event) => setWizardForm({ ...wizardForm, issueLimit: event.target.value })} />
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-1)', margin: 0 }}>Banner and terms</h3>
                  <CardBackgroundPicker value={wizardForm.bannerImage} onChange={image => setWizardForm({ ...wizardForm, bannerImage: image })} />
                  <div>
                    <label className="label">Terms and conditions</label>
                    <textarea className="input" style={{ minHeight: '80px', resize: 'vertical' }} value={wizardForm.terms} onChange={(event) => setWizardForm({ ...wizardForm, terms: event.target.value })} />
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                {wizardStep > 1 ? (
                  <button type="button" className="btn btn-secondary" onClick={() => setWizardStep(wizardStep - 1)}>
                    Back
                  </button>
                ) : (
                  <div />
                )}
                {wizardStep < 3 ? (
                  <button type="button" className="btn btn-primary" onClick={event => { event.preventDefault(); setWizardStep(wizardStep + 1); }}>
                    Next
                  </button>
                ) : (
                  <button type="submit" className="btn btn-success" style={{ minWidth: '150px' }} disabled={!company || company.status !== 'approved' || loadingCompany}>
                    {loadingCompany ? 'Publishing...' : 'Launch Campaign'}
                  </button>
                )}
              </div>
            </form>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <span className="section-label" style={{ paddingLeft: '4px' }}>Card live preview</span>
            <div
              className="card" role="region" aria-label="Coupon card live preview"
              style={{
                backgroundImage: cardBackgroundImage(wizardForm.bannerImage, true),
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                borderRadius: '24px',
                padding: '2rem',
                color: '#ffffff',
                boxShadow: 'var(--cyan-glow)',
                minHeight: '220px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                border: '1px solid var(--cyan-border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--cyan)' }}>
                    {(company?.name || 'Your brand')} gift card
                  </span>
                  <h3 style={{ fontSize: '1.35rem', fontWeight: 900, margin: '4px 0 0 0', color: '#fff' }}>
                    {wizardForm.title || 'Voucher title preview'}
                  </h3>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '2rem', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)' }}>Selling price</span>
                  <p className="mono" style={{ fontSize: '1.25rem', fontWeight: 900, margin: 0, color: 'var(--cyan)' }}>
                    {formatCurrency(Number(wizardForm.price || 0), wizardForm.countryCode ? getCountryByCode(wizardForm.countryCode).currency : "USD")}
                  </p>
                </div>
                <span style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, color: '#4ade80' }}>
                  Value: {formatCurrency(Number(wizardForm.value || 0), wizardForm.countryCode ? getCountryByCode(wizardForm.countryCode).currency : "USD")}
                </span>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <span className="section-label">Campaign Portfolio</span>
                  <h3 style={{ margin: '0.25rem 0 0', fontSize: '1.35rem', fontWeight: 800 }}>Manage Published Coupons</h3>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                    Monitor sales, adjust stock, edit campaign terms, or pause offers instantly.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setWizardForm(createInitialWizardForm());
                      setWizardStep(1);
                      window.scrollTo({ top: 300, behavior: 'smooth' });
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <Rocket size={14} /> New Campaign
                  </button>
                </div>
              </div>

              {/* Status Metric Pills */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.65rem' }}>
                <div className="glass-card" style={{ padding: '0.75rem', borderRadius: '14px', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-3)', textTransform: 'uppercase', fontWeight: 700 }}>Total</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-1)', marginTop: '2px' }}>{statusCounts.all}</div>
                </div>
                <div className="glass-card" style={{ padding: '0.75rem', borderRadius: '14px', textAlign: 'center', borderColor: 'rgba(34,197,94,0.3)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#4ade80', textTransform: 'uppercase', fontWeight: 700 }}>Active</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#4ade80', marginTop: '2px' }}>{statusCounts.active}</div>
                </div>
                <div className="glass-card" style={{ padding: '0.75rem', borderRadius: '14px', textAlign: 'center', borderColor: 'rgba(245,158,11,0.3)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#fbbf24', textTransform: 'uppercase', fontWeight: 700 }}>Paused</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#fbbf24', marginTop: '2px' }}>{statusCounts.paused}</div>
                </div>
                <div className="glass-card" style={{ padding: '0.75rem', borderRadius: '14px', textAlign: 'center', borderColor: 'rgba(239,68,68,0.3)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#f87171', textTransform: 'uppercase', fontWeight: 700 }}>Sold Out</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f87171', marginTop: '2px' }}>{statusCounts.soldOut}</div>
                </div>
                <div className="glass-card" style={{ padding: '0.75rem', borderRadius: '14px', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-4)', textTransform: 'uppercase', fontWeight: 700 }}>Expired</span>
                  <div style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--text-4)', marginTop: '2px' }}>{statusCounts.expired}</div>
                </div>
              </div>

              {/* Search, Filter Tabs and Sort Controls */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', flex: '1 1 200px' }}>
                    <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)' }} />
                    <input
                      type="text"
                      className="input"
                      placeholder="Filter by title, terms or country..."
                      value={offerSearch}
                      onChange={e => setOfferSearch(e.target.value)}
                      style={{ paddingLeft: '2.2rem', width: '100%', fontSize: '0.85rem' }}
                    />
                    {offerSearch && (
                      <button
                        type="button"
                        onClick={() => setOfferSearch('')}
                        style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-4)', cursor: 'pointer', padding: 0 }}
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  <select
                    className="input"
                    value={offerSortBy}
                    onChange={e => setOfferSortBy(e.target.value as any)}
                    style={{ flex: '0 0 auto', width: 'auto', fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                  >
                    <option value="newest">Sort: Newest first</option>
                    <option value="sales">Sort: Most sold</option>
                    <option value="price_desc">Sort: Highest price</option>
                    <option value="price_asc">Sort: Lowest price</option>
                    <option value="expiry">Sort: Expiring soon</option>
                  </select>
                </div>

                {/* Filter pills */}
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {(['all', 'active', 'paused', 'sold_out', 'expired'] as const).map(tab => (
                    <button
                      key={tab}
                      type="button"
                      className={`btn btn-sm ${offerStatusFilter === tab ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setOfferStatusFilter(tab)}
                      style={{
                        padding: '0.3rem 0.65rem',
                        fontSize: '0.75rem',
                        textTransform: 'capitalize',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <span>{tab.replace('_', ' ')}</span>
                      <span
                        style={{
                          background: offerStatusFilter === tab ? 'rgba(255,255,255,0.2)' : 'var(--surface-soft)',
                          borderRadius: '999px',
                          padding: '0.05rem 0.35rem',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                        }}
                      >
                        {tab === 'all' ? statusCounts.all : tab === 'active' ? statusCounts.active : tab === 'paused' ? statusCounts.paused : tab === 'sold_out' ? statusCounts.soldOut : statusCounts.expired}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Offers List */}
              {offers.length === 0 ? (
                <div className="glass-card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-3)', borderRadius: '16px' }}>
                  <Layers size={36} style={{ color: 'var(--text-4)', margin: '0 auto 0.75rem', display: 'block' }} />
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-2)' }}>No published campaigns yet</div>
                  <p style={{ margin: '0.35rem 0 1rem', fontSize: '0.85rem' }}>
                    Use the launch wizard to publish your first gift card offer to the marketplace.
                  </p>
                </div>
              ) : filteredOffers.length === 0 ? (
                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-3)', borderRadius: '16px' }}>
                  <Filter size={28} style={{ color: 'var(--text-4)', margin: '0 auto 0.5rem', display: 'block' }} />
                  <div style={{ fontWeight: 600 }}>No campaigns match your filter</div>
                  <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.82rem' }}>Try clearing your search query or selecting a different status filter.</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setOfferSearch(''); setOfferStatusFilter('all'); }}
                  >
                    Reset filters
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {filteredOffers.map((offer) => {
                    const isExpired = !!offer.expiry_date && new Date(offer.expiry_date).getTime() <= now;
                    const isSoldOut = !!offer.issue_limit && (offer.issued_count || 0) >= offer.issue_limit;
                    const isPaused = offer.is_active === false;

                    const country = getCountryByCode(offer.country_code || '');
                    const currency = offer.currency || country.currency || 'USD';
                    const soldCount = offer.issued_count || 0;
                    const limitCount = offer.issue_limit;
                    const percentSold = limitCount ? Math.min(100, Math.round((soldCount / limitCount) * 100)) : null;
                    const discountPercent = offer.value > offer.price ? Math.round(((offer.value - offer.price) / offer.value) * 100) : 0;

                    return (
                      <div
                        key={offer.id}
                        className="glass-card"
                        style={{
                          borderRadius: '18px',
                          padding: '1.15rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.85rem',
                          border: isPaused ? '1px dashed var(--border)' : '1px solid var(--border)',
                          background: isPaused ? 'rgba(0,0,0,0.15)' : undefined,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {/* Top row: Thumbnail, Title, Country, Status Badge */}
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                          <div
                            style={{
                              width: '74px',
                              height: '52px',
                              borderRadius: '10px',
                              backgroundImage: cardBackgroundImage(offer.banner_image || DEFAULT_CARD_BACKGROUND, true),
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              flexShrink: 0,
                              border: '1px solid rgba(255,255,255,0.1)',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-1)', wordBreak: 'break-word' }}>
                                {offer.title}
                              </h4>
                              {/* Status Badge */}
                              <div>
                                {isPaused ? (
                                  <span className="badge badge-amber" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <Pause size={11} /> Paused
                                  </span>
                                ) : isExpired ? (
                                  <span className="badge" style={{ fontSize: '0.72rem', background: 'var(--surface-soft)', color: 'var(--text-4)' }}>
                                    <Clock size={11} /> Expired
                                  </span>
                                ) : isSoldOut ? (
                                  <span className="badge badge-red" style={{ fontSize: '0.72rem' }}>
                                    Sold out
                                  </span>
                                ) : (
                                  <span className="badge badge-green" style={{ fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                    <CheckCircle2 size={11} /> Active
                                  </span>
                                )}
                              </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginTop: '0.35rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-3)' }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                {country.flag} {country.name}
                              </span>
                              <span>·</span>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Clock size={12} /> Exp: {offer.expiry_date ? new Date(offer.expiry_date).toLocaleDateString() : 'None'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Middle row: Price, Value, Stock Progress */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', background: 'var(--surface-soft)', padding: '0.65rem 0.85rem', borderRadius: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                            <span className="mono" style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--cyan)' }}>
                              {formatCurrency(offer.price, currency)}
                            </span>
                            <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-3)', textDecoration: 'line-through' }}>
                              {formatCurrency(offer.value, currency)}
                            </span>
                            {discountPercent > 0 && (
                              <span style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', padding: '0.1rem 0.4rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 800 }}>
                                {discountPercent}% OFF
                              </span>
                            )}
                          </div>

                          <div style={{ flex: '1 1 180px', maxWidth: '240px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: 700, marginBottom: '3px', color: 'var(--text-3)' }}>
                              <span>Stock claimed</span>
                              <span style={{ color: isSoldOut ? 'var(--red)' : 'var(--text-2)' }}>
                                {limitCount ? `${soldCount} / ${limitCount} (${percentSold}%)` : `${soldCount} sold`}
                              </span>
                            </div>
                            {limitCount && (
                              <div style={{ height: '5px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${percentSold}%`,
                                    background: isSoldOut ? 'var(--red)' : (percentSold ?? 0) > 80 ? '#fbbf24' : 'var(--cyan)',
                                    borderRadius: '999px',
                                    transition: 'width 0.3s ease',
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Bottom Action Toolbar */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', paddingTop: '0.25rem', borderTop: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            {/* Toggle Pause / Resume */}
                            <button
                              type="button"
                              className={`btn btn-sm ${isPaused ? 'btn-success' : 'btn-secondary'}`}
                              disabled={togglingOfferId === offer.id}
                              onClick={() => handleToggleActive(offer)}
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              title={isPaused ? 'Reactivate campaign in marketplace' : 'Pause campaign (temporarily hides from marketplace)'}
                            >
                              {togglingOfferId === offer.id ? (
                                <span className="spinner spinner-sm" style={{ width: '12px', height: '12px' }} />
                              ) : isPaused ? (
                                <Play size={12} />
                              ) : (
                                <Pause size={12} />
                              )}
                              <span>{isPaused ? 'Resume' : 'Pause'}</span>
                            </button>

                            {/* Edit Campaign */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleStartEdit(offer)}
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                            >
                              <Edit3 size={12} /> Edit
                            </button>

                            {/* Clone / Duplicate */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleCloneCampaign(offer)}
                              style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                              title="Duplicate settings to launch a new campaign"
                            >
                              <Copy size={12} /> Clone
                            </button>
                          </div>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteCampaign(offer.id, offer.title)}
                            className="btn btn-danger btn-sm"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                          >
                            <Trash2 size={12} /> Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          </div>
        )
      )}

      {currentSection === 'coupons' && (
        !merchantHasApproval ? (
          <div className="glass-card-strong" style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
            <span className="section-label">Approval required</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Coupons data is locked</h3>
            <p style={{ color: 'var(--text-3)', marginTop: '0.85rem', lineHeight: 1.7 }}>
              Your company is still awaiting admin approval. Once approved, you can view the list of customer purchased coupons here.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
              Check onboarding status
            </button>
          </div>
        ) : (
          <div className="glass-card-strong" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <span className="section-label">Purchased Coupons</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Customer buy coupon list</h3>
            </div>
            {purchasedCoupons.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-4)' }}>
                No coupons have been purchased from your campaigns yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th scope="col">Coupon Code</th>
                      <th scope="col">Status</th>
                      <th scope="col">Remaining Balance</th>
                      <th scope="col">Issued To</th>
                      <th scope="col">Issued Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchasedCoupons.map((c) => (
                      <tr key={c.id}>
                        <td className="mono" style={{ fontWeight: 700 }}>{c.code}</td>
                        <td>
                          <span className={`badge ${c.status === 'active' ? 'badge-green' : c.status === 'redeemed' ? 'badge-amber' : 'badge-red'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="mono">{countryMoney(c.remaining_balance, c.country_code)}</td>
                        <td style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-1)' }}>
                          {c.issued_to ? (
                            c.issued_to === 'usr_101' ? 'customer@demo.com' : `Customer (${c.issued_to.substring(0, 8)})`
                          ) : (
                            <span style={{ color: 'var(--text-4)', fontStyle: 'italic' }}>Anonymous</span>
                          )}
                        </td>
                        <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                          {new Date(c.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {currentSection === 'redemptions' && (
        !merchantHasApproval ? (
          <div className="glass-card-strong" style={{ padding: '2rem', maxWidth: '720px', margin: '0 auto' }}>
            <span className="section-label">Approval required</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Cashier scanner is disabled</h3>
            <p style={{ color: 'var(--text-3)', marginTop: '0.85rem', lineHeight: 1.7 }}>
              Your company is still awaiting admin approval. Once approved, you can redeem vouchers at the store counter.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/merchant/onboarding')}>
              Check onboarding status
            </button>
          </div>
        ) : (
          <div className="dashboard-section">


          <div className="glass-card-strong" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
              <span className="section-label">Redemption log</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Transaction history</h3>
            </div>
            {redemptions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-4)' }}>
                No redemption transactions logged yet. Use the cashier scanner to redeem vouchers.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th scope="col">Customer</th>
                      <th scope="col">Coupon code</th>
                      <th scope="col">Prior balance</th>
                      <th scope="col">Redeemed amount</th>
                      <th scope="col">Remaining balance</th>
                      <th scope="col">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((redemption) => {
                      const coupon = purchasedCoupons.find(c => c.code === redemption.coupon_code);
                      const userName = coupon?.issued_to ? (coupon.issued_to === 'usr_101' ? 'customer@demo.com' : `Customer (${coupon.issued_to.substring(0,8)})`) : 'anonymous';
                      const priorBalance = redemption.amount + redemption.remaining_balance_after;

                      return (
                        <tr key={redemption.id}>
                          <td style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-1)' }}>
                            {userName !== 'anonymous' ? userName : <span style={{ color: 'var(--text-4)', fontStyle: 'italic' }}>Anonymous</span>}
                          </td>
                          <td className="mono" style={{ fontWeight: 700 }}>{redemption.coupon_code || 'COUPON'}</td>
                          <td className="mono" style={{ color: 'var(--text-3)' }}>{countryMoney(priorBalance, coupon?.country_code)}</td>
                          <td className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>-{countryMoney(redemption.amount, coupon?.country_code)}</td>
                          <td className="mono">{countryMoney(redemption.remaining_balance_after, coupon?.country_code)}</td>
                          <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                            {new Date(redemption.created_at).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        )
      )}

      {currentSection === 'onboarding' && (
        <>
          {company?.status === 'pending' && (
            <div className="glass-card-strong fade-in" style={{ padding: '1.5rem', maxWidth: '720px', margin: '0 auto 1.5rem' }}>
              <span className="section-label">Approval request sent</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Your profile is under admin review</h3>
              <p style={{ color: 'var(--text-3)', marginTop: '0.75rem', lineHeight: 1.7 }}>
                We have sent your onboarding details to the admin approval queue. You can resend the review request if you want to prompt the admin again.
              </p>
              <button className="btn btn-secondary btn-sm" onClick={handleResendApprovalRequest}>
                Resend approval request
              </button>
            </div>
          )}
          {!company || company.status === 'rejected' ? (
            <div style={{ maxWidth: '640px', margin: '0 auto' }} className="fade-in">
              <div className="glass-card-strong" style={{ padding: '2.5rem', border: '1px solid var(--cyan-border)' }}>
                <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                  <span style={{ fontSize: '2rem' }}>ONBOARD</span>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: 900, color: 'var(--text-1)', margin: '0.5rem 0 0.25rem' }}>
                    {company?.status === 'rejected' ? 'KYC denied, please reapply' : 'Establish merchant profile'}
                  </h2>
                  <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', margin: 0, fontWeight: 500 }}>
                    Submit business details, tax forms, and settlement routing data to activate campaigns.
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem', position: 'relative' }}>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: '2px', background: 'var(--border)', zIndex: 1 }} />
                  <div style={{ position: 'absolute', top: '50%', left: 0, width: `${((kycStep - 1) / 2) * 100}%`, height: '2px', background: 'var(--cyan)', zIndex: 1, transition: 'width 0.3s' }} />
                  {[1, 2, 3].map((step) => (
                    <div
                      key={step}
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: step <= kycStep ? 'var(--cyan)' : 'var(--bg-3)',
                        border: `2px solid ${step <= kycStep ? 'var(--cyan)' : 'var(--border)'}`,
                        color: step <= kycStep ? '#0a0a1a' : 'var(--text-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        zIndex: 2,
                      }}
                    >
                      {step}
                    </div>
                  ))}
                </div>

                <form onSubmit={handleKycSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {kycStep === 1 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label className="label">Legal business name</label>
                        <input className="input" required value={onboardingForm.businessName} onChange={(event) => setOnboardingForm({ ...onboardingForm, businessName: event.target.value })} />
                      </div>
                      <div>
                        <label className="label">Brand prefix</label>
                        <input className="input mono" required minLength={3} maxLength={3} pattern="[A-Z]{3}" title="Please enter exactly 3 uppercase letters" placeholder="e.g. SBU" value={onboardingForm.prefix} onChange={(event) => setOnboardingForm({ ...onboardingForm, prefix: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                      </div>
                    </div>
                  )}

                  {kycStep === 2 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label className="label">GSTIN ID</label>
                          <input className="input mono" required value={onboardingForm.gstin} onChange={(event) => setOnboardingForm({ ...onboardingForm, gstin: event.target.value })} />
                        </div>
                        <div>
                          <label className="label">PAN</label>
                          <input className="input mono" required value={onboardingForm.pan} onChange={(event) => setOnboardingForm({ ...onboardingForm, pan: event.target.value })} />
                        </div>
                      </div>
                      <div>
                        <label className="label">Corporate address</label>
                        <input className="input" required value={onboardingForm.address} onChange={(event) => setOnboardingForm({ ...onboardingForm, address: event.target.value })} />
                      </div>
                      <div>
                        <label className="label">KYC document</label>
                        <input className="input" type="file" accept="application/pdf,image/jpeg,image/png" required={!kycFile}
                          onChange={(event) => { setKycFile(event.target.files?.[0] ?? null); setUploadedDocument(null); }} />
                        <p className="text-sm">{kycFile && <>Selected: {kycFile.name}. </>}Private PDF, JPG or PNG, up to 5 MB. Only you and authorized administrators can access it.</p>
                      </div>
                    </div>
                  )}

                  {kycStep === 3 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <div>
                        <label className="label">Settlement bank name</label>
                        <input className="input" required value={onboardingForm.bankName} onChange={(event) => setOnboardingForm({ ...onboardingForm, bankName: event.target.value })} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                          <label className="label">Account number</label>
                          <input className="input mono" required value={onboardingForm.accountNumber} onChange={(event) => setOnboardingForm({ ...onboardingForm, accountNumber: event.target.value })} />
                        </div>
                        <div>
                          <label className="label">IFSC or Swift</label>
                          <input className="input mono" required value={onboardingForm.ifscCode} onChange={(event) => setOnboardingForm({ ...onboardingForm, ifscCode: event.target.value })} />
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
                    {kycStep > 1 ? (
                      <button type="button" className="btn btn-secondary" onClick={() => setKycStep(kycStep - 1)}>
                        Back
                      </button>
                    ) : (
                      <div />
                    )}
                    <button type="submit" className="btn btn-primary" style={{ minWidth: '150px' }}>
                      {kycStep === 3 ? 'Submit profile' : 'Next step'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="responsive-grid-2">
              <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <span className="section-label">Profile details</span>
                    <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.35rem' }}>Registered company information</h3>
                  </div>
                  <span className={`badge ${companyStatusTone}`}>{company.status}</span>
                </div>
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  <div><strong>Business name:</strong> {company.name}</div>
                  <div><strong>Prefix:</strong> <span className="mono">{company.prefix}</span></div>
                  <div><strong>GSTIN:</strong> <span className="mono">{company.gstin || 'Not provided'}</span></div>
                  <div><strong>PAN:</strong> <span className="mono">{company.pan || 'Not provided'}</span></div>
                  <div><strong>Address:</strong> {company.address || 'Not provided'}</div>
                </div>
              </div>

              <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
                <span className="section-label">Settlement and compliance</span>
                <h3 style={{ margin: '0.35rem 0 1rem', fontSize: '1.35rem' }}>Bank and KYC references</h3>
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  <div><strong>Bank:</strong> {company.bank_name || 'Not provided'}</div>
                  <div><strong>Account:</strong> <span className="mono">{company.account_number || 'Not provided'}</span></div>
                  <div><strong>IFSC / Swift:</strong> <span className="mono">{company.ifsc_code || 'Not provided'}</span></div>
                  <div><strong>Document:</strong> <span className="mono">{company.document_url || 'Not provided'}</span></div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes scanner-laser {
          0% { top: 15%; }
          50% { top: 85%; }
          100% { top: 15%; }
        }
      `}</style>
      {currentSection === 'settlements' && (
        <div className="dashboard-section fade-in">
          <div className="glass-card-strong" style={{ padding: '2rem' }}>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: 'var(--text-1)' }}>Month-End Settlements</h3>
            <p style={{ color: 'var(--text-3)', marginBottom: '1.5rem' }}>View the payouts generated by the platform for redemptions made at your store.</p>
            
            {company?.status !== 'approved' ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--amber)' }}>Your account must be approved by an administrator to view and receive settlements.</div>
            ) : settlements.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-4)' }}>No settlements have been generated yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th style={{ textAlign: 'right' }}>Total Redemptions</th>
                      <th style={{ textAlign: 'right' }}>Amount Due</th>
                      <th>Status</th>
                      <th>Paid At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settlements.map((s) => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{s.period_month}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>{s.total_redemptions}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--violet-400)' }}>{s.currency ? formatCurrency(s.amount_due, s.currency) : `${s.amount_due.toFixed(2)} (currency unset)`}</td>
                        <td>
                          <span className={`badge ${s.status === 'paid' ? 'badge-green' : 'badge-amber'}`}>
                            {s.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-3)' }}>
                          {s.paid_at ? new Date(s.paid_at).toLocaleDateString() : '-'}
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

      {/* ── Edit Campaign Modal ── */}
      {editingOffer && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-campaign-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'rgba(5, 7, 15, 0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            overflowY: 'auto',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !savingEdit) setEditingOffer(null);
          }}
        >
          <div
            className="glass-card-strong fade-in"
            style={{
              width: '100%',
              maxWidth: '720px',
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '24px',
              padding: '2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
              <div>
                <span className="section-label">Campaign settings</span>
                <h2 id="edit-campaign-title" style={{ margin: '0.2rem 0 0', fontSize: '1.35rem', fontWeight: 800 }}>
                  Edit Campaign: {editingOffer.title}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setEditingOffer(null)}
                disabled={savingEdit}
                style={{ padding: '0.4rem', borderRadius: '50%' }}
                aria-label="Close modal"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Card Live Preview */}
              <div>
                <span className="label" style={{ marginBottom: '0.5rem', display: 'block' }}>Live Card Preview</span>
                <div
                  className="card"
                  style={{
                    backgroundImage: cardBackgroundImage(editForm.bannerImage, true),
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: '20px',
                    padding: '1.5rem',
                    color: '#ffffff',
                    minHeight: '160px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    border: '1px solid var(--cyan-border)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--cyan)' }}>
                        {(company?.name || 'Your brand')}
                      </span>
                      <h4 style={{ fontSize: '1.15rem', fontWeight: 900, margin: '4px 0 0 0', color: '#fff' }}>
                        {editForm.title || 'Campaign Title'}
                      </h4>
                    </div>
                    {editForm.isActive ? (
                      <span className="badge badge-green" style={{ fontSize: '0.68rem' }}>Active</span>
                    ) : (
                      <span className="badge badge-amber" style={{ fontSize: '0.68rem' }}>Paused</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '1rem' }}>
                    <div>
                      <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)' }}>Selling price</span>
                      <p className="mono" style={{ fontSize: '1.15rem', fontWeight: 900, margin: 0, color: 'var(--cyan)' }}>
                        {formatCurrency(Number(editForm.price || 0), editForm.countryCode ? getCountryByCode(editForm.countryCode).currency : "USD")}
                      </p>
                    </div>
                    <span style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800, color: '#4ade80' }}>
                      Value: {formatCurrency(Number(editForm.value || 0), editForm.countryCode ? getCountryByCode(editForm.countryCode).currency : "USD")}
                    </span>
                  </div>
                </div>
              </div>

              {/* General details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                <div>
                  <label className="label">Campaign title</label>
                  <input
                    type="text"
                    className="input"
                    required
                    value={editForm.title}
                    onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Coupon country</label>
                  <CountrySelector
                    id="edit-campaign-country"
                    value={editForm.countryCode}
                    onChange={c => setEditForm({ ...editForm, countryCode: c.code })}
                  />
                  <p className="background-help">Only users registered in this country can purchase and redeem this coupon.</p>
                </div>
              </div>

              {/* Pricing & Stock */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div>
                  <label className="label">
                    Selling price ({editForm.countryCode ? getCountryByCode(editForm.countryCode).currency : 'USD'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input mono"
                    required
                    value={editForm.price}
                    onChange={e => setEditForm({ ...editForm, price: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">
                    Face value ({editForm.countryCode ? getCountryByCode(editForm.countryCode).currency : 'USD'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    className="input mono"
                    required
                    value={editForm.value}
                    onChange={e => setEditForm({ ...editForm, value: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label">Issue limit (inventory cap)</label>
                  <input
                    type="number"
                    min={editingOffer.issued_count || 1}
                    className="input mono"
                    placeholder="Leave empty for unlimited"
                    value={editForm.issueLimit}
                    onChange={e => setEditForm({ ...editForm, issueLimit: e.target.value })}
                  />
                  <p className="background-help">
                    Already sold: {editingOffer.issued_count || 0}.
                  </p>
                </div>
              </div>

              {/* Expiry Date */}
              <div>
                <label className="label">Expiry date</label>
                <input
                  type="date"
                  className="input"
                  required
                  value={editForm.expiryDate}
                  onChange={e => setEditForm({ ...editForm, expiryDate: e.target.value })}
                />
              </div>

              {/* Description & Terms */}
              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={editForm.description}
                  onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Terms & conditions</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.terms}
                  onChange={e => setEditForm({ ...editForm, terms: e.target.value })}
                />
              </div>

              {/* Card Artwork */}
              <div>
                <CardBackgroundPicker
                  value={editForm.bannerImage}
                  onChange={image => setEditForm({ ...editForm, bannerImage: image })}
                  disabled={savingEdit}
                />
              </div>

              {/* Active Toggle Switch */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.85rem 1rem', background: 'var(--surface-soft)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-1)' }}>Active in Marketplace</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                    When disabled, the coupon is hidden from marketplace buyers but remains valid for existing buyers.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.isActive}
                  onChange={e => setEditForm({ ...editForm, isActive: e.target.checked })}
                  style={{ width: '1.25rem', height: '1.25rem', cursor: 'pointer', accentColor: 'var(--cyan)' }}
                />
              </div>

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savingEdit}
                  onClick={() => setEditingOffer(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                  style={{ minWidth: '130px' }}
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
