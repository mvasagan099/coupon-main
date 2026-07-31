import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Rocket, Store, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { DashboardCard } from '../components/GlassCard';
import { LoadingPage } from '../components/LoadingPage';
import type { Company, GiftCard, RedemptionTransaction } from '../lib/supabase';
import {
  createGiftCard,
  deleteGiftCard,
  getCompanyByOwner,
  getGiftCards,
  getRedemptionTransactions,
  submitOnboarding,
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
    price: '45',
    expiryDate: getDefaultExpiryDate(),
    bannerImage: 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=900&auto=format&fit=crop&q=60',
    terms: 'Valid at all participating locations. Cannot be exchanged for cash.',
    issueLimit: ''
  };
}

export default function MerchantDashboard() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();

  const currentSection: MerchantSection = isMerchantSection(section) ? section : 'overview';

  const [loadingCompany, setLoadingCompany] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);

  const [kycStep, setKycStep] = useState(1);
  const [onboardingForm, setOnboardingForm] = useState({
    businessName: '',
    prefix: '',
    gstin: '',
    pan: '',
    address: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    documentName: '',
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
          activeOffers: cards.length,
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

    if (kycStep < 3) {
      setKycStep((previous) => previous + 1);
      return;
    }

    try {
      setLoadingCompany(true);
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
        document_url: onboardingForm.documentName || 'cert_incorporation.pdf',
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

      const newCard = await createGiftCard({
        company_id: company.id,
        title: wizardForm.title,
        description: wizardForm.description,
        value: valueNum,
        price: priceNum,
        expiry_date: new Date(wizardForm.expiryDate).toISOString(),
        banner_image: wizardForm.bannerImage,
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

  const handleDeleteCampaign = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete the campaign "${title}"? This action cannot be undone.`)) return;
    try {
      await deleteGiftCard(id);
      success('Campaign deleted', `"${title}" has been removed from the marketplace.`);
      fetchMerchantProfile();
    } catch (err: unknown) {
      toastError('Deletion error', getErrorMessage(err, 'Failed to delete campaign.'));
    }
  };

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
            <DashboardCard title="Projected sales" value={`₹${metrics.totalSales.toFixed(0)}`} variant="primary" icon={<span style={{ fontSize: '1rem' }}>₹</span>} />
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
                  <strong>₹{Math.max(metrics.liabilities, 0).toFixed(2)}</strong>
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
                        Sell at ₹{offer.price.toFixed(2)} for ₹{offer.value.toFixed(2)} of value
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
                        <span className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>-₹{redemption.amount.toFixed(2)}</span>
                      </div>
                      <div style={{ color: 'var(--text-3)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
                        Remaining balance ₹{redemption.remaining_balance_after.toFixed(2)}
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

            <form onSubmit={handleCreateCampaign} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {wizardStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} className="fade-in">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-1)', margin: 0 }}>Gift card details</h3>
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
                      <label className="label">Face value (₹)</label>
                      <input className="input mono" type="number" required min={1} value={wizardForm.value} onChange={(event) => setWizardForm({ ...wizardForm, value: event.target.value })} />
                    </div>
                    <div>
                      <label className="label">Selling price (₹)</label>
                      <input className="input mono" type="number" required min={0} value={wizardForm.price} onChange={(event) => setWizardForm({ ...wizardForm, price: event.target.value })} />
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
                  <div>
                    <label className="label">Card banner image URL</label>
                    <input className="input mono" value={wizardForm.bannerImage} onChange={(event) => setWizardForm({ ...wizardForm, bannerImage: event.target.value })} />
                  </div>
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
                  <button type="button" className="btn btn-primary" onClick={() => setWizardStep(wizardStep + 1)}>
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
              className="card"
              style={{
                backgroundImage: `linear-gradient(135deg, rgba(3,7,18,0.92) 0%, rgba(3,7,18,0.85) 100%), url(${wizardForm.bannerImage})`,
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
                <span style={{ fontSize: '2rem' }}>CARD</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '2rem', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-3)' }}>Selling price</span>
                  <p className="mono" style={{ fontSize: '1.25rem', fontWeight: 900, margin: 0, color: 'var(--cyan)' }}>
                    ₹{wizardForm.price || '45'}.00
                  </p>
                </div>
                <span style={{ background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.3)', padding: '0.35rem 0.75rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 800, color: '#4ade80' }}>
                  Value: ₹{wizardForm.value || '50'}
                </span>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <span className="section-label">Published campaigns</span>
              <h3 style={{ margin: '0.35rem 0 1rem', fontSize: '1.35rem' }}>Live offers</h3>
              {offers.length === 0 ? (
                <div style={{ color: 'var(--text-3)' }}>No live campaigns yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: '0.85rem' }}>
                  {offers.map((offer) => (
                    <div key={offer.id} className="glass-card" style={{ borderRadius: '20px', padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{offer.title}</div>
                        <div style={{ color: 'var(--text-3)', marginTop: '0.25rem' }}>{offer.description}</div>
                        <div className="mono" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                          <span style={{ color: 'var(--text-3)' }}>Price:</span> ₹{offer.price.toFixed(2)} <span style={{ margin: '0 0.5rem', color: 'var(--border)' }}>|</span> <span style={{ color: 'var(--text-3)' }}>Value:</span> ₹{offer.value.toFixed(2)}
                        </div>
                        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-3)' }}>
                          {offer.issue_limit ? (
                            <span style={{ color: offer.issued_count && offer.issued_count >= offer.issue_limit ? 'var(--red)' : 'inherit', fontWeight: 600 }}>
                              {offer.issued_count || 0} / {offer.issue_limit} sold
                            </span>
                          ) : (
                            <span>{offer.issued_count || 0} sold (Unlimited)</span>
                          )}
                        </div>
                      </div>
                      <button onClick={() => handleDeleteCampaign(offer.id, offer.title)} className="btn btn-danger btn-sm" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                        Delete
                      </button>
                    </div>
                  ))}
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
                        <td className="mono">₹{c.remaining_balance.toFixed(2)}</td>
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
                          <td className="mono" style={{ color: 'var(--text-3)' }}>₹{priorBalance.toFixed(2)}</td>
                          <td className="mono" style={{ color: 'var(--red)', fontWeight: 700 }}>-₹{redemption.amount.toFixed(2)}</td>
                          <td className="mono">₹{redemption.remaining_balance_after.toFixed(2)}</td>
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
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ width: '100%' }}
                          onClick={() => setOnboardingForm({ ...onboardingForm, documentName: `cert_incorporation_${onboardingForm.prefix.toLowerCase() || 'merchant'}.pdf` })}
                        >
                          {onboardingForm.documentName || 'Simulate document upload'}
                        </button>
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
                        <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--violet-400)' }}>₹{s.amount_due.toFixed(2)}</td>
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

    </div>
  );
}
