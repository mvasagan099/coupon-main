import { formatOfferDate } from '../lib/couponOffer';
import { normalizeCardBackground, DEFAULT_CARD_BACKGROUND } from '../lib/cardBackgrounds';
import { voucherState } from '../lib/voucherState';
import { useNow } from '../hooks/useNow';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCode } from 'react-qr-code';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, SearchX, Wallet, CreditCard, Activity, ArrowLeftRight, Gift, Zap, ShieldCheck, ArrowUpRight, ArrowDownLeft, CheckCircle2, Landmark, Copy, MapPin, QrCode, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { DashboardCard } from '../components/GlassCard';
import { LoadingPage } from '../components/LoadingPage';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import PaymentMethodSelector from '../components/PaymentMethodSelector';
import type { PaymentGateway } from '../lib/paymentGateway';
import {
  createPayment,
  getStripe,
  recoverStripePayment as recoverStripeOrder,
  verifyPayment as verifyGatewayPayment,
  loadRazorpayScript,
  openRazorpayCheckout,
} from '../lib/paymentGateway';
import type { Coupon, GiftCard, Order, RedemptionTransaction, Withdrawal, UserDeposit } from '../lib/supabase';
import {
  getGiftCards,
  getRedemptionTransactions,
  getUserGiftCards,
  getUserOrders,
  createWithdrawal,
  getUserWithdrawals,
  getUserDeposits,
  createPayPalOrder,
  verifyPayPalPayment,
  getUserProfileData,
  updateUserPaypalEmail,
  updateUserProfile,
} from '../lib/supabase';
import CountrySelector from '../components/CountrySelector';
import type { CountryInfo } from '../lib/countries';
import { getCountryByCode, getCountryBankConfig, getPreferredGateway } from '../lib/countries';
import { formatCurrency } from '../lib/exchangeRate';
import { getDestinationMeta } from '../lib/destinationConfig';

const validSections = ['marketplace', 'wallet', 'activity', 'cards'] as const;
type UserSection = (typeof validSections)[number];

function isUserSection(value: string | undefined): value is UserSection {
  return !!value && validSections.includes(value as UserSection);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return fallback;
}

function cleanPaymentMethod(method?: string): string {
  if (!method) return 'Wallet Top-up';
  return method
    .replace(/lottery\s+winnings?\s+transfer/gi, 'Winning Transfer')
    .replace(/lottery\s+winnings?/gi, 'Winning Transfer')
    .replace(/\blottery\b/gi, '')
    .trim() || 'Wallet Top-up';
}

function getMonogram(name?: string): string {
  if (!name) return 'CV';
  const clean = name.trim().toUpperCase();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).substring(0, 2);
  }
  return clean.substring(0, 2);
}

export default function UserDashboard() {
  const now = useNow();
  const { user, isLoading: authLoading } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { section } = useParams<{ section?: string }>();

  const currentSection: UserSection = isUserSection(section) ? section : 'marketplace';

  const [giftCards, setGiftCards] = useState<GiftCard[]>([]);
  const [userVouchers, setUserVouchers] = useState<Coupon[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [redemptions, setRedemptions] = useState<RedemptionTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [priceFilter, setPriceFilter] = useState('All');

  const [walletBalance, setWalletBalance] = useState(0);

  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState(1);
  const [withdrawMethod, setWithdrawMethod] = useState<'paypal' | 'bank'>('paypal');
  const [withdrawForm, setWithdrawForm] = useState({
    amount: '',
    paypalEmail: '',   // PayPal email
    bankAccount: '',   // Bank Account Number / IBAN
    bankName: '',      // e.g. Chase Bank, HDFC Bank
    routing: '',       // Routing Number / IFSC / SWIFT
    accountName: '',   // Full Name on Bank Account
  });
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const [showAddMoneyModal, setShowAddMoneyModal] = useState(false);
  const [addMoneyAmount, setAddMoneyAmount] = useState('500');
  const [addMoneyLoading, setAddMoneyLoading] = useState(false);
  const paymentRecoveryKey = `cv_pending_paypal_${user?.id ?? 'signed-out'}`;
  const [pendingPayPalOrder, setPendingOrder] = useState<string | null>(() => localStorage.getItem(paymentRecoveryKey));
  const setPendingPayPalOrder = (order: string | null) => {
    if (order) localStorage.setItem(paymentRecoveryKey, order);
    else localStorage.removeItem(paymentRecoveryKey);
    setPendingOrder(order);
  };
  const stripeRecoveryKey = `cv_pending_stripe_${user?.id ?? 'signed-out'}`;
  const [pendingStripeIntent, setPendingStripeIntent] = useState<string | null>(null);
  const stripeOrderRef = useRef<string | null>(null);
  const [stripeResumeOrder, setStripeResumeOrder] = useState<{orderId:string;clientSecret:string} | null>(null);
  const [stripeRecovering, setStripeRecovering] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    const returnedIntent = new URL(window.location.href).searchParams.get('payment_intent');
    const pending = returnedIntent?.startsWith('pi_') ? returnedIntent : localStorage.getItem(stripeRecoveryKey);
    if (pending) localStorage.setItem(stripeRecoveryKey, pending);
    const timer = window.setTimeout(() => {
      setPendingStripeIntent(pending);
      setPendingOrder(localStorage.getItem(paymentRecoveryKey));
    }, 0);
    if (returnedIntent) {
      const url = new URL(window.location.href);
      for (const key of ['payment_intent','payment_intent_client_secret','redirect_status']) url.searchParams.delete(key);
      window.history.replaceState(null,'',url.toString());
    }
    return () => window.clearTimeout(timer);
  }, [user?.id, stripeRecoveryKey, paymentRecoveryKey]);
  const [selectedGateway, setSelectedGateway] = useState<PaymentGateway>('paypal');
  const [deposits, setDeposits] = useState<UserDeposit[]>([]);
  const [depositPage, setDepositPage] = useState(1);
  const [withdrawPage, setWithdrawPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [cardsPage, setCardsPage] = useState(1);
  const [vouchersTab, setVouchersTab] = useState<'unused' | 'used' | 'inactive'>('unused');
  const ITEMS_PER_PAGE = 5;
  const CARDS_PER_PAGE = 6;
  const MARKETPLACE_PER_PAGE = 15;

  // Country / currency state
  const [userCountryCode, setUserCountryCode] = useState<string | null>(null);
  const [userCurrency, setUserCurrency]       = useState<string>('USD');
  const [profileCountry, setProfileCountry]   = useState<CountryInfo | null>(null);
  const [savingProfile, setSavingProfile]     = useState(false);
  const [activeVoucher, setActiveVoucher] = useState<Coupon | null>(null);
  const [visibleCodes, setVisibleCodes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!section) {
      navigate('/dashboard/marketplace', { replace: true });
      return;
    }

    if (!isUserSection(section)) {
      navigate('/dashboard/marketplace', { replace: true });
    }
  }, [navigate, section]);



  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    const syncWalletState = async () => {
      try {
        const profile = await getUserProfileData(userId);
        setWalletBalance(profile.wallet_balance);
        if (profile.paypal_email) {
          setWithdrawForm(prev => ({ ...prev, paypalEmail: profile.paypal_email! }));
        }
        // Load country / currency
        if (profile.country_code) {
          setUserCountryCode(profile.country_code);
          setUserCurrency(getCountryByCode(profile.country_code).currency);
          setSelectedGateway(getPreferredGateway(profile.country_code));
          setProfileCountry(getCountryByCode(profile.country_code));
        }
      } catch (err) {
        console.error("Failed to sync wallet state:", err);
      }
    };

    void syncWalletState();
  }, [userId]);

  async function refreshWalletBalance() {
    if (!user?.id) return;
    try {
      const profile = await getUserProfileData(user.id);
      setWalletBalance(profile.wallet_balance);
      if (profile.paypal_email) {
        setWithdrawForm(prev => ({ ...prev, paypalEmail: profile.paypal_email! }));
      }
    } catch (err: unknown) {
      console.warn("Could not fetch wallet balance:", err);
      toastError("Wallet refresh failed", "The displayed balance may be out of date. Refresh before trying again.");
    }
  }



  const toastErrorRef = useRef(toastError);
  useEffect(() => { toastErrorRef.current = toastError; }, [toastError]);

  const loadData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setLoadError(null);

      // Race the data loading against a 12-second timeout
      const loadTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Data loading timed out. Please try again.')), 12000)
      );

      const [cards, vouchers, userOrders, userRedemptions, userWithdrawals, userDeposits] = await Promise.race([
        Promise.all([
          getGiftCards(),
          getUserGiftCards(userId),
          getUserOrders(userId),
          getRedemptionTransactions(),
          getUserWithdrawals(userId),
          getUserDeposits(userId),
        ]),
        loadTimeout,
      ]);

      setGiftCards(cards);
      setUserVouchers(vouchers);
      setOrders(userOrders);
      setWithdrawals(userWithdrawals);
      setDeposits(userDeposits);

      const voucherIds = vouchers.map((voucher) => voucher.id);
      setRedemptions(userRedemptions.filter((redemption) => voucherIds.includes(redemption.coupon_id)));
    } catch (err: unknown) {
      const msg = getErrorMessage(err, 'Failed to load dashboard details.');
      toastErrorRef.current('Load error', msg);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const recoverStripePayment = async () => {
    if (!pendingStripeIntent) return;
    setStripeRecovering(true);
    try {
      const result = await recoverStripeOrder(pendingStripeIntent);
      if (result.state === 'resume' && result.orderId && result.clientSecret) {
        setStripeResumeOrder({orderId:result.orderId,clientSecret:result.clientSecret});
        setAddMoneyAmount(String(Number(result.amount) / 100));
        setSelectedGateway('stripe');
        setShowAddMoneyModal(true);
        setPendingStripeIntent(null);
        return;
      }
      if (result.state === 'processing') throw new Error('The bank is still processing this payment. Retry verification; do not pay again.');
      localStorage.removeItem(stripeRecoveryKey);
      setPendingStripeIntent(null);
      setStripeResumeOrder(null);
      if (result.state === 'cancelled') { success('Payment cancelled', 'No new charge was made. You can start a new payment.'); return; }
      await refreshWalletBalance();
      await loadData();
      success('Payment confirmed', `Your wallet was credited ${formatCurrency(result.amount ?? 0, result.currency ?? userCurrency)}.`);
    } catch (error) { toastError('Payment pending', getErrorMessage(error, 'Retry verification; do not pay again.')); }
    finally { setStripeRecovering(false); }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!userId) return;

    const syncDashboard = async () => {
      await loadData();
    };

    void syncDashboard();
  }, [authLoading, userId, loadData]);

  useEffect(() => {
    const isAnyModalOpen = !!activeVoucher || showWithdrawModal || showAddMoneyModal;
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden';
      document.body.classList.add('body-modal-open');
      window.scrollTo({ top: 0, behavior: 'instant' });
    } else {
      document.body.style.overflow = '';
      document.body.classList.remove('body-modal-open');
    }
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('body-modal-open');
    };
  }, [activeVoucher, showWithdrawModal, showAddMoneyModal]);

  // ── Razorpay payment handler ─────────────────────────────────────────────────
  const handleRazorpayPayment = async () => {
    if (!user?.id) return;
    const amountNum = parseFloat(addMoneyAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toastError('Invalid amount', 'Please enter a valid amount.');
      return;
    }
    setAddMoneyLoading(true);
    try {
      await loadRazorpayScript();

      // 1. Create order on server
      const orderData = await createPayment('razorpay', amountNum, 'INR');

      // 2. Open Razorpay popup
      const result = await openRazorpayCheckout({
        keyId:          import.meta.env.VITE_RAZORPAY_KEY_ID,
        orderId:        orderData.orderId,
        amountMinorUnit: orderData.amount,
        currency:       orderData.currency,
        name:           'Coupon Vault',
        description:    'Wallet top-up',
        prefillEmail:   user.email ?? '',
        theme:          '#6c63ff',
      });

      // 3. Verify server-side + credit wallet
      const verify = await verifyGatewayPayment(
        'razorpay',
        result.razorpay_order_id,
        result.razorpay_payment_id,
        result.razorpay_signature,
      );

      if (verify.verified) {
        await refreshWalletBalance();
        await loadData();
        const creditedAmount = verify.amount;
        if (!verify.verified || !Number.isFinite(creditedAmount)) throw new Error("Payment credit was not confirmed.");
        success('Funds added', `Successfully added ${formatCurrency(creditedAmount!, userCurrency)} to your wallet.`);
        setShowAddMoneyModal(false);
        setAddMoneyAmount('500');
      } else {
        toastError('Verification failed', 'Payment could not be verified. Contact support.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed.';
      if (!msg.includes('cancelled')) {
        toastError('Payment Error', msg);
      }
    } finally {
      setAddMoneyLoading(false);
    }
  };

  // ── Stripe Elements mount / unmount hook ─────────────────────────────────────
  const stripeElementsRef = useRef<any>(null);
  const [stripeLoading, setStripeLoading] = useState(false);

  useEffect(() => {
    if (!showAddMoneyModal || selectedGateway !== 'stripe' || pendingStripeIntent) {
      stripeElementsRef.current = null;
      return;
    }

    let active = true;
    const initStripe = async () => {
      const amountNum = parseFloat(addMoneyAmount);
      if (isNaN(amountNum) || amountNum <= 0) return;

      setStripeLoading(true);
      try {
        const stripe = await getStripe();
        if (!stripe || !active) return;

        // Clear any previous elements container content
        const container = document.getElementById('stripe-payment-element');
        if (container) container.innerHTML = '';

        const orderData = stripeResumeOrder ?? await createPayment('stripe', amountNum, userCurrency);
        if (!active) return;
        if (!orderData.clientSecret) {
          throw new Error('Stripe client secret not received.');
        }


        stripeOrderRef.current = orderData.orderId;

        // Mount Stripe elements
        setTimeout(() => {
          if (!active) return;
          try {
            const elements = stripe.elements({ clientSecret: orderData.clientSecret });
            const paymentElement = elements.create('payment');
            paymentElement.mount('#stripe-payment-element');
            stripeElementsRef.current = elements;
          } catch (mountErr) {
            console.error('Failed to mount Stripe elements:', mountErr);
          }
        }, 50);

      } catch (err: any) {
        console.error('Failed to init Stripe Elements:', err);
        toastError('Stripe Initialization Error', err.message || 'Could not load Stripe.');
      } finally {
        if (active) setStripeLoading(false);
      }
    };

    const initTimer = window.setTimeout(() => void initStripe(), 600);

    return () => {
      active = false;
      window.clearTimeout(initTimer);
      stripeOrderRef.current = null;
      stripeElementsRef.current = null;
      const el = document.getElementById('stripe-payment-element');
      if (el) el.innerHTML = '';
    };
  }, [showAddMoneyModal, selectedGateway, addMoneyAmount, toastError, userCurrency, pendingStripeIntent, stripeResumeOrder]);

  // ── Stripe payment handler ───────────────────────────────────────────────────
  const handleStripePayment = async () => {
    if (!user?.id || pendingStripeIntent) return;
    const elements = stripeElementsRef.current;
    if (!elements) {
      toastError('Stripe Error', 'Stripe payment card field is not loaded yet.');
      return;
    }

    setAddMoneyLoading(true);
    try {
      const stripe = await getStripe();
      if (!stripe) throw new Error('Stripe SDK not loaded.');

      const intentId = stripeOrderRef.current;
      if (!intentId) throw new Error('Payment order is not ready.');
      // Save before confirmation, so redirects and verification failures remain recoverable.
      localStorage.setItem(stripeRecoveryKey, intentId);
      // Confirm payment using the mounted elements instance
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });

      if (error) {
        throw new Error(error.message ?? 'Stripe payment failed.');
      }

      if (!paymentIntent || paymentIntent.status !== 'succeeded') {
        throw new Error(`Stripe payment not succeeded (status: ${paymentIntent?.status ?? 'unknown'}).`);
      }

      // Verify server-side + credit wallet
      const verify = await verifyGatewayPayment(
        'stripe',
        paymentIntent.id,
        paymentIntent.id,
      );

      if (verify.verified) {
        await refreshWalletBalance();
        await loadData();
        localStorage.removeItem(stripeRecoveryKey);
        setPendingStripeIntent(null);
        setStripeResumeOrder(null);
        success('Funds added', `Successfully added ${formatCurrency(verify.amount, verify.currency)} to your wallet.`);
        setShowAddMoneyModal(false);
        setAddMoneyAmount('500');
      } else {
        setPendingStripeIntent(localStorage.getItem(stripeRecoveryKey));
        toastError('Verification pending', 'Retry verification before making another payment.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed.';
      setPendingStripeIntent(localStorage.getItem(stripeRecoveryKey));
      toastError('Stripe verification pending', `${msg} Retry verification before making another payment.`);
    } finally {
      setAddMoneyLoading(false);
    }
  };


  // Step 1 submit: validate then show confirmation (step 0)
  const handleWithdrawalSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.id) return;
    const enteredAmount = parseFloat(withdrawForm.amount);
    const maxLocal = walletBalance;

    if (isNaN(enteredAmount) || enteredAmount <= 0 || enteredAmount > maxLocal + 0.01) {
      toastError('Invalid amount', `Enter an amount up to ${formatCurrency(maxLocal, userCurrency)}.`);
      return;
    }
    if (withdrawMethod === 'paypal') {
      if (!withdrawForm.paypalEmail || !withdrawForm.paypalEmail.includes('@')) {
        toastError('Invalid PayPal Email', 'Please enter a valid PayPal email address.');
        return;
      }
    } else {
      if (!withdrawForm.bankName.trim() || !withdrawForm.accountName.trim() || !withdrawForm.routing.trim() || !withdrawForm.bankAccount.trim()) {
        toastError('Incomplete Bank Details', 'Please fill in all bank account fields.');
        return;
      }
    }
    setWithdrawStep(0); // Show confirmation popup
  };

  // Step 0 confirm: actually submit the withdrawal
  const handleWithdrawalConfirm = async () => {
    if (!user?.id) return;
    const enteredAmount = parseFloat(withdrawForm.amount);

    setWithdrawLoading(true);
    setWithdrawStep(2); // Go to processing view

    await new Promise((resolve) => setTimeout(resolve, 1800));

    try {
      let routingStr = 'PAYPAL';
      let accountStr = withdrawForm.paypalEmail;

      if (withdrawMethod === 'paypal') {
        try {
          await updateUserPaypalEmail(user.id, withdrawForm.paypalEmail);
        } catch (err) {
          console.warn("Could not save paypal email:", err);
        }
      } else {
        routingStr = `${withdrawForm.bankName.trim()} (${withdrawForm.routing.trim()}) | ${withdrawForm.accountName.trim()}`;
        accountStr = withdrawForm.bankAccount.trim();
      }

      await createWithdrawal(user.id, enteredAmount, routingStr, accountStr, userCurrency);

      await refreshWalletBalance();
      await loadData();

      setWithdrawStep(3); // Go to success view
      success(
        'Payout requested',
        withdrawMethod === 'paypal'
          ? `PayPal Payout requested successfully.`
          : `Bank transfer of ${formatCurrency(enteredAmount, userCurrency)} to ${withdrawForm.bankName} requested successfully.`
      );
    } catch (err: unknown) {
      setWithdrawStep(1); // Return to form on error
      toastError('Withdrawal error', getErrorMessage(err, 'Failed to process payout.'));
    } finally {
      setWithdrawLoading(false);
    }
  };




  const combinedTransactions = useMemo(() => {
    const list: Array<{ date: string; brand: string; type: string; amount: string; status: string }> = [];

    orders.forEach((order) => {
      list.push({
        date: order.created_at,
        brand: order.company?.name || 'Marketplace purchase',
        type: 'Purchase',
        amount: `-${formatCurrency(order.amount, userCurrency)}`,
        status: 'Completed',
      });
    });

    redemptions.forEach((redemption) => {
      list.push({
        date: redemption.created_at,
        brand: redemption.company_name || 'Merchant',
        type: 'Redemption',
        amount: `-${formatCurrency(redemption.amount, userCurrency)}`,
        status: 'Settled',
      });
    });

    deposits.forEach((deposit) => {
      list.push({
        date: deposit.created_at,
        brand: cleanPaymentMethod(deposit.payment_method),
        type: 'Deposit',
        amount: `+${formatCurrency(deposit.amount, userCurrency)}`,
        status: deposit.status === 'completed' ? 'Completed' : deposit.status === 'failed' ? 'Failed' : 'Pending',
      });
    });

    withdrawals.forEach((w) => {
      list.push({
        date: w.created_at,
        brand: `Payout (${w.account_number ? '...' + w.account_number.slice(-4) : 'Bank'})`,
        type: 'Withdrawal',
        amount: `-${formatCurrency(w.amount, userCurrency)}`,
        status: w.status === 'completed' ? 'Completed' : w.status === 'rejected' ? 'Rejected' : 'Pending',
      });

      if (w.status === 'rejected') {
        list.push({
          date: w.updated_at || w.created_at,
          brand: `Refund (Rejected Payout)`,
          type: 'Refund',
          amount: `+${formatCurrency(w.amount, userCurrency)}`,
          status: 'Completed',
        });
      }
    });

    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [orders, redemptions, deposits, withdrawals, userCurrency]);

  const filteredCatalog = useMemo(() => {
    return giftCards.filter((card) => {
      // Hide lottery and gaming hub coupons from the marketplace page
      const dest = card.redemption_destination?.toLowerCase().trim();
      const compName = card.company_name?.toLowerCase().trim() || '';
      const cardTitle = card.title?.toLowerCase().trim() || '';

      const isHiddenMarketplaceCard =
        dest === 'gaming' ||
        dest === 'lottery' ||
        compName === 'gaminghub' ||
        compName.includes('gaming hub') ||
        compName.includes('gaminghub') ||
        compName.includes('lottery') ||
        cardTitle.includes('gaming') ||
        cardTitle.includes('lottery');

      if (isHiddenMarketplaceCard) return false;

      const matchesSearch =
        card.title.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        (card.company_name && card.company_name.toLowerCase().includes(catalogSearch.toLowerCase()));

      let matchesPrice = true;
      if (priceFilter === 'low') matchesPrice = card.price < 500;
      else if (priceFilter === 'mid') matchesPrice = card.price >= 500 && card.price <= 2000;
      else if (priceFilter === 'high') matchesPrice = card.price > 2000;

      return !!userCountryCode && card.country_code === userCountryCode && card.is_active !== false &&
        (!card.expiry_date || new Date(card.expiry_date).getTime() > now) && matchesSearch && matchesPrice;
    });
  }, [catalogSearch, giftCards, priceFilter, userCountryCode, now]);

  const totalDepositPages = Math.ceil(deposits.length / ITEMS_PER_PAGE);
  const slicedDeposits = deposits.slice(
    (depositPage - 1) * ITEMS_PER_PAGE,
    depositPage * ITEMS_PER_PAGE
  );

  const totalWithdrawalPages = Math.ceil(withdrawals.length / ITEMS_PER_PAGE);
  const slicedWithdrawals = withdrawals.slice(
    (withdrawPage - 1) * ITEMS_PER_PAGE,
    withdrawPage * ITEMS_PER_PAGE
  );

  const totalActivityPages = Math.ceil(combinedTransactions.length / ITEMS_PER_PAGE);
  const slicedActivity = combinedTransactions.slice(
    (activityPage - 1) * ITEMS_PER_PAGE,
    activityPage * ITEMS_PER_PAGE
  );

  const totalMarketplacePages = Math.ceil(filteredCatalog.length / MARKETPLACE_PER_PAGE);
  const slicedMarketplace = filteredCatalog.slice(
    (marketplacePage - 1) * MARKETPLACE_PER_PAGE,
    marketplacePage * MARKETPLACE_PER_PAGE
  );

  const activeVouchersList = userVouchers.filter(v => voucherState(v, now) === 'active');
  const inactiveVouchersList = userVouchers.filter(v => voucherState(v, now) === 'unavailable');
  const redeemedVouchersList = userVouchers.filter(v => voucherState(v, now) === 'used');

  const selectedCardsList = vouchersTab === 'unused' ? activeVouchersList : vouchersTab === 'inactive' ? inactiveVouchersList : redeemedVouchersList;
  const totalCardsPages = Math.ceil(selectedCardsList.length / CARDS_PER_PAGE);
  const slicedCards = selectedCardsList.slice(
    (cardsPage - 1) * CARDS_PER_PAGE,
    cardsPage * CARDS_PER_PAGE
  );
  const activeVoucherCount = activeVouchersList.length;
  const usedVoucherCount = redeemedVouchersList.length;

  const totalRedeemedAmount = useMemo(() => {
    const fromVouchers = userVouchers.reduce((acc, voucher) => {
      const gc = giftCards.find(card => card.id === voucher.gift_card_id);
      const faceValue = gc ? gc.value : (voucher.status === 'redeemed' || voucher.is_used ? (voucher.remaining_balance || 50) : (voucher.remaining_balance ?? 0));
      const remaining = voucher.remaining_balance ?? 0;

      if (voucher.is_used || voucher.status === 'redeemed') {
        return acc + faceValue;
      }
      return acc + Math.max(faceValue - remaining, 0);
    }, 0);
    const fromRedemptions = redemptions.reduce((acc, r) => acc + (r.amount ?? 0), 0);
    return Math.max(fromVouchers, fromRedemptions);
  }, [userVouchers, giftCards, redemptions]);

  const resolveVoucherMeta = useCallback((voucher: Coupon) => {
    const parentCard = giftCards.find((g) => g.id === voucher.gift_card_id);
    const bannerImage = voucher.card_banner || parentCard?.banner_image || DEFAULT_CARD_BACKGROUND;
    const title = voucher.card_title || parentCard?.title || `${voucher.company_name || 'Gift'} Voucher`;
    const companyName = voucher.company_name || parentCard?.company_name || 'Brand Partner';
    const description = voucher.card_description || parentCard?.description || '';
    const faceValue = voucher.card_value ?? parentCard?.value ?? voucher.amount;
    const address = voucher.company_address;
    const prefix = voucher.company_prefix;
    const logoUrl = voucher.company_logo_url;
    const terms = voucher.card_terms || parentCard?.terms;
    const redemptionDestination = voucher.redemption_destination || parentCard?.redemption_destination || null;

    return {
      parentCard,
      bannerImage,
      title,
      companyName,
      description,
      faceValue,
      address,
      prefix,
      logoUrl,
      terms,
      redemptionDestination,
    };
  }, [giftCards]);

  const copyVoucherCode = async (code: string) => {
    let successCopy = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        successCopy = true;
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = code;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        successCopy = document.execCommand('copy');
        textArea.remove();
      }
    } catch {
      // fallback
    }

    if (successCopy) {
      success('Copied coupon code', 'Code copied to clipboard.');
    } else {
      success('Code ready', 'Please select and copy the code manually.');
    }
  };

  return (
    <PayPalScriptProvider key={userCurrency} deferLoading={!userCountryCode || ["INR", "AED"].includes(userCurrency)} options={{ clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID || "test", currency: userCurrency, intent: "capture" }}>
      <div className="dashboard-container">
      {pendingStripeIntent && <div className="glass-card" role="status" style={{ padding:'1rem', marginBottom:'1rem' }}>
        <p>A Stripe payment needs verification. Check its status before paying again.</p>
        <button className="btn btn-secondary" disabled={stripeRecovering} onClick={() => void recoverStripePayment()}>
          {stripeRecovering ? 'Verifying payment…' : 'Verify pending Stripe payment'}
        </button>
      </div>}
      {loadError && currentSection !== 'marketplace' && <div role="alert" className="glass-card" style={{padding:'1rem'}}>
        <p>Financial history could not be refreshed: {loadError}</p>
        <button className="btn btn-secondary" onClick={() => void loadData()}>Retry loading history</button>
      </div>}


      {currentSection === 'marketplace' && (
        <div className="dashboard-section fade-in">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 300px', position: 'relative' }}>
              <SearchX size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
              <input
                className="input"
                style={{ width: '100%', borderRadius: '99px', padding: '0.8rem 1.25rem 0.8rem 2.8rem', background: 'var(--surface-soft)' }}
                placeholder="Search brand or card..."
                value={catalogSearch}
                onChange={(event) => { setCatalogSearch(event.target.value); setMarketplacePage(1); }}
              />
            </div>
            <select className="input" style={{ width: 'auto', borderRadius: '99px', padding: '0.8rem 1.25rem', backgroundColor: 'var(--surface-soft)' }} value={priceFilter} onChange={(event) => { setPriceFilter(event.target.value); setMarketplacePage(1); }}>
              <option value="All">All prices</option>
              <option value="low">Under 500</option>
              <option value="mid">500 - 2000</option>
              <option value="high">Over 2000</option>
            </select>
          </div>

          {loading ? (
            <LoadingPage message="Loading marketplace..." />
          ) : loadError ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon">
                <ShieldCheck size={28} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.15rem', fontWeight: 600 }}>Something went wrong</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem', maxWidth: '360px' }}>{loadError}</p>
              </div>
              <button className="btn btn-primary" onClick={() => loadData()} style={{ marginTop: '0.25rem' }}>
                Try again
              </button>
            </div>
          ) : filteredCatalog.length === 0 ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon">
                <SearchX size={28} />
              </div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.15rem', fontWeight: 600 }}>No gift cards found</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem', maxWidth: '320px' }}>We couldn't find any active gift cards matching your search right now.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setCatalogSearch(''); setPriceFilter('All'); }} style={{ marginTop: '0.25rem' }}>
                Clear search filters
              </button>
            </div>
          ) : (
            <div>
              <div className="responsive-grid-3 stagger-fade">
                {slicedMarketplace.map((card) => {
                  const val = card.value ?? 0;
                  const prc = card.price ?? 0;
                  const savings = val - prc;
                  const savingsPct = val > 0 ? Math.round((savings / val) * 100) : 0;

                  return (
                    <Link key={card.id} to={`/dashboard/marketplace/coupon/${card.id}`} aria-label={`View ${card.title} coupon details`} className="card card-hover card-lift marketplace-card" style={{ padding: '1rem', position: 'relative', textDecoration: 'none', color: 'inherit' }}>
                      <div className="img-zoom marketplace-card-banner"
                        style={{
                          minHeight: '220px',
                          borderRadius: '24px',
                          padding: '1.2rem',
                          color: '#fff',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          className="marketplace-card-img"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: `url(${JSON.stringify(normalizeCardBackground(card.banner_image) ?? DEFAULT_CARD_BACKGROUND)}) center/cover`,
                            zIndex: 0
                          }}
                        />
                        <div className="marketplace-card-overlay" />
                        <div className="marketplace-card-sheen" />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', position: 'relative', zIndex: 3 }}>
                          {card.redemption_destination ? (
                            <span className={`badge marketplace-card-dest-badge ${getDestinationMeta(card.redemption_destination)?.badgeClass || 'badge-cyan'}`} style={{ fontSize: '0.7rem' }}>
                              {getDestinationMeta(card.redemption_destination)?.icon} {getDestinationMeta(card.redemption_destination)?.shortLabel}
                            </span>
                          ) : (
                            <span className="badge marketplace-card-dest-badge badge-amber" style={{ fontSize: '0.7rem' }}>⚠️ Unclassified</span>
                          )}
                          <span className="badge marketplace-card-badge">
                            Save {savingsPct}%
                          </span>
                        </div>
                        <div style={{ position: 'relative', zIndex: 3 }}>
                          <div className="marketplace-card-title">{card.title}</div>
                          <div className="marketplace-card-subtitle">
                            <Zap size={14} /> {formatCurrency(prc, userCurrency)} now, value {formatCurrency(val, userCurrency)}
                          </div>
                        </div>
                      </div>

                      <div style={{ padding: '1rem 0.35rem 0 0.35rem' }}>
                        <p style={{ margin: '0 0 0.75rem', color: 'var(--text-2)', fontSize: '0.85rem' }}>Expires: {formatOfferDate(card.expiry_date)}</p>
                        <p style={{ margin: '0 0 0.85rem', color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.88rem' }}>{card.description}</p>

                        {card.issue_limit ? (() => {
                          const userPurchasedCount = userVouchers.filter(v => v.gift_card_id === card.id).length;
                          const totalIssued = Math.max(card.issued_count || 0, userPurchasedCount);
                          const remaining = card.issue_limit - totalIssued;
                          const isSoldOut = remaining <= 0;
                          return (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isSoldOut ? 'var(--red)' : 'var(--amber)' }}>
                                {isSoldOut ? 'Sold out!' : `Only ${remaining} left`}
                              </span>
                              <span className="btn btn-secondary btn-sm">View details</span>
                            </div>
                          );
                        })() : (
                          <span className="btn btn-secondary btn-sm">View details</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>

              {totalMarketplacePages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', padding: '0 0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                    Showing {(marketplacePage - 1) * MARKETPLACE_PER_PAGE + 1} - {Math.min(filteredCatalog.length, marketplacePage * MARKETPLACE_PER_PAGE)} of {filteredCatalog.length}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={marketplacePage === 1}
                      onClick={() => setMarketplacePage(p => Math.max(1, p - 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={marketplacePage === totalMarketplacePages}
                      onClick={() => setMarketplacePage(p => Math.min(totalMarketplacePages, p + 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {currentSection === 'wallet' && (
        <div className="dashboard-section fade-in">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              marginBottom: '2rem'
            }}
          >
            <div>
              <span className="section-label">Customer experience</span>
              <h2 style={{ margin: '0.45rem 0 0.35rem', fontSize: '2rem', letterSpacing: '0.02em', wordSpacing: '0.1em' }}>
                Welcome back, {user?.email?.split('@')[0] || 'guest'}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-3)', lineHeight: 1.6, letterSpacing: '0.01em', wordSpacing: '0.08em' }}>
                Browse new cards, manage active vouchers, and keep redemptions close at hand.
              </p>
            </div>
          </div>

          <div className="bento-grid fade-in-cards" style={{ marginBottom: '2rem' }}>
            <DashboardCard
              title="Wallet balance"
              value={formatCurrency(walletBalance, userCurrency)}

              variant="primary"
              icon={<Wallet size={20} />}
            />
            <DashboardCard title="Active cards" value={String(activeVoucherCount)} variant="emerald" icon={<CreditCard size={20} />} />
            <DashboardCard title="Transactions" value={String(combinedTransactions.length)} variant="violet" icon={<ArrowLeftRight size={20} />} />
            <DashboardCard
              title="Redeemed value"
              value={formatCurrency(totalRedeemedAmount, userCurrency)}
              variant="amber"
              icon={<Gift size={20} />}
            />
          </div>

          {/* Profile completion banner for users without country set */}
          {!userCountryCode && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0.9rem 1.2rem',
              marginBottom: '1.25rem',
              background: 'linear-gradient(135deg, rgba(99,91,255,0.08) 0%, rgba(0,199,146,0.08) 100%)',
              border: '1.5px solid rgba(99,91,255,0.2)',
              borderRadius: '14px',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}>
              <span style={{ fontSize: '1.4rem' }}>🌍</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-1)' }}>Complete your profile</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginTop: '0.15rem' }}>
                  Select your country to get country-specific coupons and payment methods.
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => navigate('/dashboard/wallet')}
                style={{ flexShrink: 0, borderRadius: '10px' }}
              >
                Set country
              </button>
            </div>
          )}

          <div className="responsive-grid-2">
            <div className="premium-gradient-card" style={{ padding: '1.6rem' }}>
              <div className="premium-gradient-card__bg" />
              <div className="premium-gradient-card__shimmer" />
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                  <span className="section-label" style={{ color: 'rgba(255,255,255,0.85)', letterSpacing: '0.15em' }}>
                    <Wallet size={14} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                    Wallet balance
                  </span>
                  <span className="glow-dot" />
                </div>
                <div style={{ fontSize: '2.8rem', fontWeight: 800, letterSpacing: '0.02em', wordSpacing: '0.08em', lineHeight: 1 }}>
                  {formatCurrency(walletBalance, userCurrency)}
                </div>
                {userCurrency !== 'USD' && (
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.9)',
                    background: 'rgba(255,255,255,0.15)',
                    backdropFilter: 'blur(8px)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: '99px',
                    marginTop: '0.65rem',
                    border: '1px solid rgba(255,255,255,0.22)',
                  }}>
                    <span>🌍</span>
                    <span>{profileCountry?.name} · {userCurrency}</span>
                  </div>
                )}
                <p style={{ color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, marginTop: '0.75rem', fontSize: '0.92rem' }}>
                  Use your stored balance for instant purchases, top up funds through verified payment gateways.
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setShowAddMoneyModal(true); }}
                    style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderColor: 'rgba(255,255,255,0.25)', backdropFilter: 'blur(8px)' }}
                  >
                    Add money
                  </button>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => { setWithdrawStep(1); setShowWithdrawModal(true); }}
                    style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', borderColor: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)' }}
                  >
                    Withdraw money
                  </button>
                </div>
              </div>
            </div>

            <div className="glass-card-strong" style={{ padding: '1.5rem' }}>
              <div className="section-label" style={{ marginBottom: '0.75rem' }}>Portfolio summary</div>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Owned cards</span>
                  <strong style={{ fontSize: '1.1rem' }}>{userVouchers.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Redeemed amount</span>
                  <strong style={{ fontSize: '1.1rem' }}>
                    {formatCurrency(totalRedeemedAmount, userCurrency)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.4)', borderRadius: '14px' }}>
                  <span style={{ color: 'var(--text-3)', fontSize: '0.9rem' }}>Recent orders</span>
                  <strong style={{ fontSize: '1.1rem' }}>{orders.length}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Deposit & Top-up History */}
          <div className="glass-card-strong" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div className="section-label" style={{ margin: 0 }}>Deposit & Top-up History</div>
              <span className="badge badge-green">{deposits.length} record{deposits.length === 1 ? '' : 's'}</span>
            </div>
            {deposits.length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', margin: '0.5rem 0' }}>
                No deposits yet. Top up your wallet or transfer winnings to see records here.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Method / Source</th>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slicedDeposits.map((d) => (
                      <tr key={d.id}>
                        <td className="mono" style={{ fontSize: '0.82rem' }}>{new Date(d.created_at).toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>{cleanPaymentMethod(d.payment_method)}</td>
                        <td className="mono text-muted" style={{ fontSize: '0.8rem' }}>{d.reference_id || d.id.slice(0, 10)}</td>
                        <td className="mono font-medium" style={{ color: 'var(--secondary)' }}>
                          +{formatCurrency(d.amount, userCurrency)}
                        </td>
                        <td>
                          <span className={`badge ${d.status === 'completed' ? 'badge-green' : d.status === 'failed' ? 'badge-red' : 'badge-amber'}`}>
                            {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {totalDepositPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', padding: '0 0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                      Showing {(depositPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(deposits.length, depositPage * ITEMS_PER_PAGE)} of {deposits.length}
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={depositPage === 1}
                        onClick={() => setDepositPage(p => Math.max(1, p - 1))}
                        style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={depositPage === totalDepositPages}
                        onClick={() => setDepositPage(p => Math.min(totalDepositPages, p + 1))}
                        style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {withdrawals.length > 0 && (
            <div className="glass-card-strong" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div className="section-label" style={{ marginBottom: '1rem' }}>Withdrawal History</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="premium-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slicedWithdrawals.map((w) => {
                      const isPaypal = w.routing_number === 'PAYPAL' || w.account_number.includes('@');
                      return (
                        <tr key={w.id}>
                          <td className="mono" style={{ fontSize: '0.82rem' }}>{new Date(w.created_at).toLocaleString()}</td>
                          <td className="mono font-medium">{formatCurrency(w.amount, userCurrency)}</td>
                          <td>
                            <span className={`badge ${w.status === 'completed' ? 'badge-green' : w.status === 'rejected' ? 'badge-red' : 'badge-amber'}`}>
                              {w.status.charAt(0).toUpperCase() + w.status.slice(1)}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span className={`badge ${isPaypal ? 'badge-blue' : 'badge-purple'}`} style={{ fontSize: '0.68rem' }}>
                                {isPaypal ? 'PayPal' : 'Bank Wire'}
                              </span>
                              <span className="mono text-muted" style={{ fontSize: '0.82rem' }}>
                                {isPaypal
                                  ? w.account_number
                                  : `${w.routing_number.split('|')[0] ?? ''} (••••${w.account_number.slice(-4)})`}
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {totalWithdrawalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', padding: '0 0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                      Showing {(withdrawPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(withdrawals.length, withdrawPage * ITEMS_PER_PAGE)} of {withdrawals.length}
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={withdrawPage === 1}
                        onClick={() => setWithdrawPage(p => Math.max(1, p - 1))}
                        style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                      >
                        Previous
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={withdrawPage === totalWithdrawalPages}
                        onClick={() => setWithdrawPage(p => Math.min(totalWithdrawalPages, p + 1))}
                        style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Country & Profile Settings */}
          <div className="glass-card-strong" style={{ padding: '1.5rem', marginTop: '1.5rem', position: 'relative', zIndex: 100 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <div>
                <div className="section-label">🌍 Country & Currency</div>
                <div style={{ fontSize: '0.88rem', color: 'var(--text-3)', marginTop: '0.25rem' }}>
                  {userCountryCode
                    ? `${profileCountry?.flag ?? ''} ${profileCountry?.name ?? userCountryCode} · ${userCurrency}`
                    : 'Not set — select your country to enable local currency'}
                </div>
              </div>
              {userCountryCode && (
                <span className="badge badge-green" style={{ fontSize: '0.72rem' }}>
                  ✓ {userCurrency}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label className="label" style={{ margin: 0 }}>
                {userCountryCode ? 'Account Country (Locked)' : 'Select your country'}
              </label>

              {userCountryCode && profileCountry ? (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.8rem 1rem',
                  borderRadius: '12px',
                  background: 'var(--surface-soft)',
                  border: '1.5px solid var(--border)',
                }}>
                  <span style={{ fontSize: '1.4rem' }}>{profileCountry.flag}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{profileCountry.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-3)' }}>
                      Currency: <strong>{profileCountry.currency}</strong> ({profileCountry.currencySymbol})
                    </div>
                  </div>
                  <span className="badge badge-yellow" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    🔒 Locked
                  </span>
                </div>
              ) : (
                <>
                  <CountrySelector
                    value={profileCountry?.code}
                    onChange={(c) => setProfileCountry(c)}
                    disabled={savingProfile}
                  />

                  {profileCountry && !userCountryCode && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                        Will set currency to <strong>{profileCountry.currency}</strong> ({profileCountry.currencySymbol})
                      </span>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={savingProfile}
                        onClick={async () => {
                          if (!user?.id || !profileCountry) return;
                          setSavingProfile(true);
                          try {
                            await updateUserProfile(user.id, {
                              country:            profileCountry.name,
                              country_code:       profileCountry.code,
                              currency:           profileCountry.currency,
                              timezone:           profileCountry.timezone,
                              phone_country_code: profileCountry.phoneCode,
                            });
                            setUserCountryCode(profileCountry.code);
                            setUserCurrency(profileCountry.currency);
                            setSelectedGateway(getPreferredGateway(profileCountry.code));
                            success('Profile updated', `Country set to ${profileCountry.name}. Currency: ${profileCountry.currency}`);
                          } catch (err) {
                            toastError('Update failed', err instanceof Error ? err.message : 'Could not update profile.');
                          } finally {
                            setSavingProfile(false);
                          }
                        }}
                        style={{ borderRadius: '10px' }}
                      >
                        {savingProfile ? <><span className="spinner" style={{ width: '14px', height: '14px' }} /> Saving…</> : 'Set country & lock'}
                      </button>
                    </div>
                  )}
                </>
              )}

              <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', fontStyle: 'italic', marginTop: '0.2rem' }}>
                ℹ️ Country is set during signup and cannot be changed under any circumstances. If you move to another country, please create a new account.
              </div>
            </div>
          </div>

          <div aria-live="polite" className="glass-card-strong" style={{ padding: '1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <span className="section-label">Quick actions</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.2rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Move between balance, activity, and active cards</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/cards')}>
                <CreditCard size={14} /> View cards
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/activity')}>
                <Activity size={14} /> Activity
              </button>
            </div>
          </div>
        </div>
      )}

      {currentSection === 'activity' && (
        <div className="glass-card-strong fade-in" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1.5px solid rgba(255,255,255,0.4)' }}>
            <span className="section-label"><Activity size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Timeline</span>
            <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.25rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>
              Transaction and settlement activity
            </h3>
          </div>
          {combinedTransactions.length === 0 ? (
            <div className="empty-state" style={{ padding: '2.5rem' }}>
              <div className="empty-state__icon"><Activity size={24} /></div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.05rem', fontWeight: 600 }}>No activity yet</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>Your purchases and redemptions will appear here.</p>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="premium-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Merchant</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {slicedActivity.map((transaction, index) => (
                    <tr key={`${transaction.date}-${index}`}>
                      <td className="mono" style={{ fontSize: '0.82rem' }}>{new Date(transaction.date).toLocaleString()}</td>
                      <td>{transaction.brand}</td>
                      <td>
                        <span className={`badge ${
                          transaction.type === 'Purchase' ? 'badge-purple' :
                          transaction.type === 'Redemption' ? 'badge-blue' :
                          transaction.type === 'Deposit' ? 'badge-green' :
                          transaction.type === 'Withdrawal' ? 'badge-amber' :
                          transaction.type === 'Refund' ? 'badge-cyan' :
                          'badge-gray'
                        }`}>
                          {transaction.type}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>{transaction.amount}</td>
                      <td>
                        <span className={`badge ${
                          transaction.status === 'Completed' || transaction.status === 'Settled' ? 'badge-green' :
                          transaction.status === 'Rejected' || transaction.status === 'Failed' ? 'badge-red' :
                          'badge-amber'
                        }`} style={{ fontSize: '0.65rem' }}>
                          {transaction.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {totalActivityPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem', padding: '1rem 1.25rem', flexWrap: 'wrap', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.4)' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                    Showing {(activityPage - 1) * ITEMS_PER_PAGE + 1} - {Math.min(combinedTransactions.length, activityPage * ITEMS_PER_PAGE)} of {combinedTransactions.length}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={activityPage === 1}
                      onClick={() => setActivityPage(p => Math.max(1, p - 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={activityPage === totalActivityPages}
                      onClick={() => setActivityPage(p => Math.min(totalActivityPages, p + 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {currentSection === 'cards' && (
        <div className="dashboard-section fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <span className="section-label"><CreditCard size={13} style={{ display: 'inline', marginRight: '0.3rem', verticalAlign: 'middle' }} /> Active vouchers</span>
              <h3 style={{ margin: '0.35rem 0 0', fontSize: '1.4rem', letterSpacing: '0.02em', wordSpacing: '0.08em', }}>Stored gift cards</h3>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dashboard/marketplace')}>
              <Gift size={14} /> Buy another card
            </button>
          </div>

          {userVouchers.length === 0 ? (
            <div className="glass-card-strong empty-state">
              <div className="empty-state__icon"><CreditCard size={26} /></div>
              <div>
                <h3 style={{ margin: '0 0 0.35rem', color: 'var(--text-1)', fontSize: '1.1rem', fontWeight: 600 }}>No vouchers yet</h3>
                <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>Buy a gift card from the marketplace to see your vouchers here.</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/dashboard/marketplace')} style={{ marginTop: '0.25rem' }}>
                <Gift size={14} /> Browse marketplace
              </button>
            </div>
          ) : (
            <>
              {/* Tab Selector */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                <button
                  className={`btn btn-sm ${vouchersTab === 'unused' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setVouchersTab('unused'); setCardsPage(1); }}
                  style={{ borderRadius: '99px', padding: '0.5rem 1.25rem' }}
                >
                  Unused ({activeVoucherCount})
                </button>
                <button
                  className={`btn btn-sm ${vouchersTab === 'used' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setVouchersTab('used'); setCardsPage(1); }}
                  style={{ borderRadius: '99px', padding: '0.5rem 1.25rem' }}
                >
                  Used ({usedVoucherCount})
                </button>
                <button className={`btn btn-sm ${vouchersTab === 'inactive' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => { setVouchersTab('inactive'); setCardsPage(1); }}>Unavailable ({inactiveVouchersList.length})</button>
              </div>

              {vouchersTab === 'unused' ? (
                <>
                  {slicedCards.length > 0 ? (
                    <div className="responsive-grid-3">
                      {slicedCards.map((voucher) => {
                        const meta = resolveVoucherMeta(voucher);
                        const isCodeVisible = !!visibleCodes[voucher.id];
                        return (
                          <div
                            key={voucher.id}
                            className="glass-card-glow voucher-card-item"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveVoucher(voucher)}
                            onClick={() => setActiveVoucher(voucher)}
                            style={{
                              borderRadius: '22px',
                              overflow: 'hidden',
                              display: 'flex',
                              flexDirection: 'column',
                              textAlign: 'left',
                              cursor: 'pointer',
                              border: '1.5px solid var(--border)',
                            }}
                          >
                            {/* Card Artwork & Brand Banner */}
                            <div
                              style={{
                                minHeight: '135px',
                                position: 'relative',
                                padding: '1rem',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                overflow: 'hidden',
                                color: '#fff',
                              }}
                            >
                              <div
                                className="voucher-card-bg"
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: `url(${JSON.stringify(normalizeCardBackground(meta.bannerImage) ?? DEFAULT_CARD_BACKGROUND)}) center/cover`,
                                  zIndex: 0,
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'linear-gradient(180deg, rgba(10,14,23,0.35) 0%, rgba(10,14,23,0.80) 100%)',
                                  zIndex: 1,
                                }}
                              />

                              {/* Top row: Brand Logo & Status */}
                              <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                                  {meta.logoUrl ? (
                                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#fff', padding: '3px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                      <img src={meta.logoUrl} alt={`${meta.companyName} logo`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        width: '36px',
                                        height: '36px',
                                        borderRadius: '10px',
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(220,230,250,0.88) 100%)',
                                        color: '#0f172a',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontWeight: 900,
                                        fontSize: '0.82rem',
                                        letterSpacing: '0.04em',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                                        border: '1px solid rgba(255,255,255,0.6)',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {getMonogram(meta.companyName)}
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                      <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', letterSpacing: '0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>
                                        {meta.companyName}
                                      </span>
                                      <ShieldCheck size={14} style={{ color: '#80f9c8', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))', flexShrink: 0 }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.1rem', flexWrap: 'wrap' }}>
                                      {meta.prefix && (
                                        <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'rgba(255,255,255,0.82)', textShadow: '0 1px 2px rgba(0,0,0,0.6)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                          Node: {meta.prefix}
                                        </span>
                                      )}
                                      {meta.redemptionDestination ? (
                                        <span className={`badge voucher-artwork-badge ${getDestinationMeta(meta.redemptionDestination)?.badgeClass || 'badge-cyan'}`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                                          {getDestinationMeta(meta.redemptionDestination)?.icon} {getDestinationMeta(meta.redemptionDestination)?.shortLabel}
                                        </span>
                                      ) : (
                                        <span className="badge voucher-artwork-badge badge-amber" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                                          ⚠️ Unclassified
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <span className="badge badge-green" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.25)', fontSize: '0.72rem', textTransform: 'uppercase', flexShrink: 0 }}>
                                  {voucher.status}
                                </span>
                              </div>

                              {/* Bottom row of banner: Coupon Title & Value */}
                              <div style={{ position: 'relative', zIndex: 2, marginTop: '0.65rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', letterSpacing: '0.01em', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {meta.title}
                                </h4>
                                {meta.faceValue != null && (
                                  <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.6)', fontWeight: 600 }}>
                                    Initial value: {formatCurrency(meta.faceValue, userCurrency)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Card Content & Details */}
                            <div style={{ padding: '0.9rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
                              {meta.address && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-3)', fontSize: '0.75rem' }}>
                                  <MapPin size={12} style={{ flexShrink: 0 }} />
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.address}</span>
                                </div>
                              )}

                              {/* Coupon Code Pill */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: 'var(--surface-soft)',
                                  border: '1.5px solid var(--border)',
                                  borderRadius: '12px',
                                  padding: '0.45rem 0.65rem',
                                  gap: '0.5rem',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    CODE:
                                  </span>
                                  <span style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.92rem', letterSpacing: '0.04em', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {isCodeVisible ? voucher.code : '••••••••••••'}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setVisibleCodes((prev) => ({ ...prev, [voucher.id]: !prev[voucher.id] }));
                                    }}
                                    aria-label={isCodeVisible ? "Hide coupon code" : "Reveal coupon code"}
                                    title={isCodeVisible ? "Hide code" : "Reveal code"}
                                    style={{
                                      background: 'var(--surface-elevated)',
                                      border: '1px solid var(--border)',
                                      cursor: 'pointer',
                                      color: 'var(--text-2)',
                                      padding: '5px',
                                      borderRadius: '8px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                    type="button"
                                  >
                                    {isCodeVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyVoucherCode(voucher.code);
                                    }}
                                    aria-label="Copy coupon code"
                                    title="Copy code"
                                    style={{
                                      background: 'var(--surface-elevated)',
                                      border: '1px solid var(--border)',
                                      cursor: 'pointer',
                                      color: 'var(--text-2)',
                                      padding: '5px',
                                      borderRadius: '8px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                    type="button"
                                  >
                                    <Copy size={13} />
                                  </button>
                                </div>
                              </div>

                              {/* Balance & Expiry */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'flex-end',
                                  paddingTop: '0.5rem',
                                  borderTop: '1px solid var(--border-subtle)',
                                }}
                              >
                                <div>
                                  <div style={{ color: 'var(--text-3)', fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                    Remaining
                                  </div>
                                  <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--cyan)' }}>
                                    {formatCurrency(voucher.remaining_balance ?? 0, userCurrency)}
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ color: 'var(--text-3)', fontSize: '0.74rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                                    Expires
                                  </div>
                                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-2)' }}>
                                    {new Date(voucher.expiry_date).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>

                              {/* Scan & View Action */}
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{
                                  width: '100%',
                                  marginTop: '0.25rem',
                                  borderRadius: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.4rem',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  padding: '0.45rem',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveVoucher(voucher);
                                }}
                              >
                                <QrCode size={14} /> Scan &amp; View Details
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="glass-card-strong empty-state" style={{ padding: '1.5rem' }}>
                      <div className="empty-state__icon" style={{ width: 44, height: 44 }}><CreditCard size={20} /></div>
                      <div>
                        <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>No active/unused vouchers in this page.</p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {slicedCards.length > 0 ? (
                    <div className="responsive-grid-3">
                      {slicedCards.map((voucher) => {
                        const meta = resolveVoucherMeta(voucher);
                        const isCodeVisible = !!visibleCodes[voucher.id];
                        const statusLabel = voucherState(voucher, now) === 'used' ? 'USED' : 'UNAVAILABLE';
                        return (
                          <div
                            key={voucher.id}
                            className="glass-card-strong voucher-card-item"
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === 'Enter' && setActiveVoucher(voucher)}
                            onClick={() => setActiveVoucher(voucher)}
                            style={{
                              borderRadius: '22px',
                              overflow: 'hidden',
                              display: 'flex',
                              flexDirection: 'column',
                              textAlign: 'left',
                              opacity: 0.85,
                              cursor: 'pointer',
                              border: '1.5px solid var(--border)',
                            }}
                          >
                            {/* Card Artwork & Brand Banner */}
                            <div
                              style={{
                                minHeight: '120px',
                                position: 'relative',
                                padding: '1rem',
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                overflow: 'hidden',
                                color: '#fff',
                              }}
                            >
                              <div
                                className="voucher-card-bg"
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: `url(${JSON.stringify(normalizeCardBackground(meta.bannerImage) ?? DEFAULT_CARD_BACKGROUND)}) center/cover`,
                                  filter: 'grayscale(60%)',
                                  zIndex: 0,
                                }}
                              />
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'linear-gradient(180deg, rgba(10,14,23,0.5) 0%, rgba(10,14,23,0.88) 100%)',
                                  zIndex: 1,
                                }}
                              />

                              <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                                  {meta.logoUrl ? (
                                    <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: '#fff', padding: '3px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                                      <img src={meta.logoUrl} alt={`${meta.companyName} logo`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                    </div>
                                  ) : (
                                    <div
                                      style={{
                                        width: '34px',
                                        height: '34px',
                                        borderRadius: '10px',
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(200,210,230,0.8) 100%)',
                                        color: '#0f172a',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontWeight: 900,
                                        fontSize: '0.8rem',
                                        letterSpacing: '0.04em',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                                        flexShrink: 0,
                                      }}
                                    >
                                      {getMonogram(meta.companyName)}
                                    </div>
                                  )}
                                  <div style={{ minWidth: 0 }}>
                                    <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', display: 'block' }}>
                                      {meta.companyName}
                                    </span>
                                    {meta.prefix && (
                                      <span style={{ fontSize: '0.64rem', fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        Node: {meta.prefix}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                <span className="badge badge-gray" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.25)', fontSize: '0.72rem', textTransform: 'uppercase', flexShrink: 0 }}>
                                  {statusLabel}
                                </span>
                              </div>

                              <div style={{ position: 'relative', zIndex: 2, marginTop: '0.65rem' }}>
                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {meta.title}
                                </h4>
                              </div>
                            </div>

                            {/* Card Content & Details */}
                            <div style={{ padding: '0.9rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', flex: 1 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  background: 'var(--surface-soft)',
                                  border: '1px solid var(--border)',
                                  borderRadius: '12px',
                                  padding: '0.45rem 0.65rem',
                                  gap: '0.5rem',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', minWidth: 0 }}>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    CODE:
                                  </span>
                                  <span style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.92rem', letterSpacing: '0.04em', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {isCodeVisible ? voucher.code : '••••••••••••'}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setVisibleCodes((prev) => ({ ...prev, [voucher.id]: !prev[voucher.id] }));
                                    }}
                                    aria-label={isCodeVisible ? "Hide coupon code" : "Reveal coupon code"}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--text-4)',
                                      padding: '4px',
                                      display: 'flex',
                                    }}
                                    type="button"
                                  >
                                    {isCodeVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void copyVoucherCode(voucher.code);
                                    }}
                                    aria-label="Copy coupon code"
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      color: 'var(--text-4)',
                                      padding: '4px',
                                      display: 'flex',
                                    }}
                                    type="button"
                                  >
                                    <Copy size={13} />
                                  </button>
                                </div>
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'flex-end',
                                  paddingTop: '0.5rem',
                                  borderTop: '1px solid var(--border-subtle)',
                                }}
                              >
                                <div>
                                  <div style={{ color: 'var(--text-4)', fontSize: '0.74rem' }}>Remaining</div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-3)' }}>{formatCurrency(voucher.remaining_balance ?? 0, userCurrency)}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ color: 'var(--text-4)', fontSize: '0.74rem' }}>Expires</div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-3)' }}>{new Date(voucher.expiry_date).toLocaleDateString()}</div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                style={{
                                  width: '100%',
                                  marginTop: '0.25rem',
                                  borderRadius: '10px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  gap: '0.4rem',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  padding: '0.45rem',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveVoucher(voucher);
                                }}
                              >
                                <QrCode size={14} /> View Details
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="glass-card-strong empty-state" style={{ padding: '1.5rem' }}>
                      <div className="empty-state__icon" style={{ width: 44, height: 44 }}><CreditCard size={20} /></div>
                      <div>
                        <p style={{ margin: 0, color: 'var(--text-3)', fontSize: '0.9rem' }}>No {vouchersTab === 'inactive' ? 'unavailable' : 'used/redeemed'} vouchers on this page.</p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {totalCardsPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', padding: '0 0.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                    Showing {(cardsPage - 1) * CARDS_PER_PAGE + 1} - {Math.min(selectedCardsList.length, cardsPage * CARDS_PER_PAGE)} of {selectedCardsList.length}
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={cardsPage === 1}
                      onClick={() => setCardsPage(p => Math.max(1, p - 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Previous
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={cardsPage === totalCardsPages}
                      onClick={() => setCardsPage(p => Math.min(totalCardsPages, p + 1))}
                      style={{ borderRadius: '8px', padding: '0.4rem 0.8rem' }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeVoucher && (() => {
        const activeMeta = resolveVoucherMeta(activeVoucher);
        const isCodeVisible = !!visibleCodes[activeVoucher.id];
        return createPortal(
          <div
            className="glass-modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setActiveVoucher(null);
            }}
          >
            <div
              className="glass-modal-panel glass-modal-panel--flush fade-in"
              style={{
                maxWidth: '420px',
                width: '100%',
                maxHeight: 'min(92dvh, 740px)',
                display: 'flex',
                flexDirection: 'column',
                padding: 0,
                overflow: 'hidden',
                borderRadius: '24px',
                boxShadow: '0 24px 64px rgba(0, 0, 0, 0.28)',
              }}
            >
              {/* Modal Brand Artwork Banner */}
              <div
                style={{
                  minHeight: '115px',
                  position: 'relative',
                  padding: '1rem 1.15rem 0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  overflow: 'hidden',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: `url(${JSON.stringify(normalizeCardBackground(activeMeta.bannerImage) ?? DEFAULT_CARD_BACKGROUND)}) center/cover`,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(10,14,23,0.7) 0%, rgba(10,14,23,0.92) 100%)',
                    zIndex: 1,
                  }}
                />

                <div style={{ position: 'relative', zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                    {activeMeta.logoUrl ? (
                      <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: '#fff', padding: '3px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
                        <img src={activeMeta.logoUrl} alt={`${activeMeta.companyName} logo`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: '38px',
                          height: '38px',
                          borderRadius: '11px',
                          background: 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(220,230,250,0.9) 100%)',
                          color: '#0f172a',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 900,
                          fontSize: '0.88rem',
                          letterSpacing: '0.04em',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          border: '1px solid rgba(255,255,255,0.6)',
                          flexShrink: 0,
                        }}
                      >
                        {getMonogram(activeMeta.companyName)}
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', overflow: 'hidden' }}>
                        <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {activeMeta.companyName}
                        </span>
                        <ShieldCheck size={14} style={{ color: '#80f9c8', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))', flexShrink: 0 }} />
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.1rem', flexWrap: 'wrap' }}>
                        {activeMeta.prefix && (
                          <span style={{ fontSize: '0.62rem', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Node: {activeMeta.prefix}
                          </span>
                        )}
                        <span style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.7)' }}>• ID: {activeVoucher.id.substring(0, 8).toUpperCase()}</span>
                        {activeMeta.redemptionDestination ? (
                          <span className={`badge voucher-artwork-badge ${getDestinationMeta(activeMeta.redemptionDestination)?.badgeClass || 'badge-cyan'}`} style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                            {getDestinationMeta(activeMeta.redemptionDestination)?.icon} {getDestinationMeta(activeMeta.redemptionDestination)?.shortLabel}
                          </span>
                        ) : (
                          <span className="badge voucher-artwork-badge badge-amber" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem' }}>
                            ⚠️ Unclassified
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveVoucher(null)}
                    aria-label="Close modal"
                    title="Close"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      background: 'rgba(0, 0, 0, 0.55)',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      flexShrink: 0,
                      transition: 'all 0.18s ease',
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>

                <div style={{ position: 'relative', zIndex: 2, marginTop: '0.6rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.7)', letterSpacing: '0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeMeta.title}
                  </h3>
                  {activeMeta.address && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'rgba(255,255,255,0.82)', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                      <MapPin size={12} style={{ flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeMeta.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Body */}
              <div style={{ padding: '0.95rem 1rem 1rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {/* Destination info notice */}
                <div style={{ background: 'var(--surface-soft)', padding: '0.55rem 0.75rem', borderRadius: '12px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem', flexShrink: 0, lineHeight: 1 }}>
                    {getDestinationMeta(activeMeta.redemptionDestination)?.icon || '⚠️'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-1)' }}>
                      {getDestinationMeta(activeMeta.redemptionDestination)?.label || 'Unclassified Voucher'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', lineHeight: 1.35 }}>
                      {getDestinationMeta(activeMeta.redemptionDestination)?.description || 'Unclassified coupons cannot be redeemed externally until assigned by an administrator.'}
                    </div>
                  </div>
                </div>

                {/* QR Code Container */}
                <div style={{ background: '#ffffff', borderRadius: '16px', padding: '0.85rem', display: 'grid', placeItems: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.06)' }}>
                  <QRCode value={activeVoucher.code} size={144} fgColor="#0f172a" style={{ height: 'auto', maxWidth: '100%', width: '144px' }} />
                  <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.5rem', fontWeight: 600, textAlign: 'center', lineHeight: 1.35 }}>
                    {activeMeta.redemptionDestination === 'gaming'
                      ? '🎮 Redeem directly inside the Gaming application'
                      : activeMeta.redemptionDestination === 'lottery'
                      ? '🎰 Redeem directly inside the Lottery application'
                      : 'Scan with merchant terminal to redeem'}
                  </span>
                </div>

                {/* Voucher Code Box */}
                <div className="glass-card-strong" style={{ borderRadius: '14px', padding: '0.75rem 0.85rem', marginTop: '0.75rem', border: '1.5px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <div className="mono" style={{ fontWeight: 800, letterSpacing: '0.06em', fontSize: '1.05rem', color: 'var(--text-1)' }}>
                      {isCodeVisible ? activeVoucher.code : '••••••••••••'}
                    </div>
                    <button
                      onClick={() => setVisibleCodes((prev) => ({ ...prev, [activeVoucher.id]: !prev[activeVoucher.id] }))}
                      aria-label={isCodeVisible ? "Hide voucher code" : "Reveal voucher code"}
                      title={isCodeVisible ? "Hide code" : "Reveal code"}
                      style={{
                        background: 'var(--surface-soft)',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        color: 'var(--text-2)',
                        padding: '5px',
                        borderRadius: '7px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      type="button"
                    >
                      {isCodeVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() => void copyVoucherCode(activeVoucher.code)}
                      aria-label="Copy voucher code"
                      title="Copy code"
                      style={{
                        background: 'var(--surface-soft)',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        color: 'var(--text-2)',
                        padding: '5px',
                        borderRadius: '7px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      type="button"
                    >
                      <Copy size={14} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', color: 'var(--text-3)', fontSize: '0.78rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
                    <span>
                      Available: <strong style={{ color: 'var(--cyan)' }}>{formatCurrency(activeVoucher.remaining_balance ?? 0, userCurrency)}</strong>
                      {activeMeta.faceValue != null && ` (of ${formatCurrency(activeMeta.faceValue, userCurrency)})`}
                    </span>
                    <span>Expires: {new Date(activeVoucher.expiry_date).toLocaleDateString()}</span>
                  </div>
                </div>

                {activeMeta.description && (
                  <p style={{ margin: '0.55rem 0 0', fontSize: '0.75rem', color: 'var(--text-3)', lineHeight: 1.45, textAlign: 'center' }}>
                    {activeMeta.description}
                  </p>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '0.75rem', padding: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.88rem', borderRadius: '12px' }}
                  onClick={() => void copyVoucherCode(activeVoucher.code)}
                >
                  <Copy size={15} /> Copy voucher code
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {showWithdrawModal && createPortal(
        <div
          className="glass-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !withdrawLoading) setShowWithdrawModal(false);
          }}
        >
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '460px', width: '100%', maxHeight: 'min(92dvh, 740px)', overflowY: 'auto' }}>
            {withdrawStep === 1 && (
              <form onSubmit={handleWithdrawalSubmit} style={{ display: 'grid', gap: '1.1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                      <ArrowDownLeft size={18} />
                    </div>
                    <div>
                      <span className="section-label" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>Payout request</span>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Withdraw funds</h3>
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowWithdrawModal(false)} style={{ borderRadius: '10px' }}>
                    Cancel
                  </button>
                </div>

                <div style={{ padding: '0.9rem 1rem', background: 'var(--surface-soft)', borderRadius: '14px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-3)' }}>Available balance</span>
                  <div style={{ textAlign: 'right' }}>
                    <strong style={{ fontSize: '1.1rem', color: 'var(--text-1)' }}>
                      {formatCurrency(walletBalance, userCurrency)}
                    </strong>

                  </div>
                </div>

                {/* Method selector */}
                <div>
                  <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.4rem' }}>Payout Method</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setWithdrawMethod('paypal')}
                      style={{
                        padding: '0.65rem',
                        borderRadius: '12px',
                        fontWeight: 600,
                        fontSize: '0.88rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        background: withdrawMethod === 'paypal' ? 'var(--primary-muted)' : 'var(--surface-soft)',
                        border: `1.5px solid ${withdrawMethod === 'paypal' ? 'var(--primary)' : 'var(--border)'}`,
                        color: withdrawMethod === 'paypal' ? 'var(--primary)' : 'var(--text-2)',
                      }}
                    >
                      <span>🅿️</span> PayPal
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setWithdrawMethod('bank')}
                      style={{
                        padding: '0.65rem',
                        borderRadius: '12px',
                        fontWeight: 600,
                        fontSize: '0.88rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        background: withdrawMethod === 'bank' ? 'var(--primary-muted)' : 'var(--surface-soft)',
                        border: `1.5px solid ${withdrawMethod === 'bank' ? 'var(--primary)' : 'var(--border)'}`,
                        color: withdrawMethod === 'bank' ? 'var(--primary)' : 'var(--text-2)',
                      }}
                    >
                      <Landmark size={15} /> Bank Transfer
                    </button>
                  </div>
                </div>

                {/* Amount input */}
                <div>
                  <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                    Amount ({userCurrency})
                  </label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.01"
                    max={walletBalance}
                    required
                    value={withdrawForm.amount}
                    onChange={(event) => setWithdrawForm({ ...withdrawForm, amount: event.target.value })}
                    placeholder="0.00"
                    style={{ width: '100%', fontSize: '1.1rem', padding: '0.65rem 0.9rem' }}
                  />

                </div>

                {/* Dynamic fields based on method */}
                {withdrawMethod === 'paypal' ? (
                  <div>
                    <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>PayPal Email Address</label>
                    <input className="input mono" type="email" required value={withdrawForm.paypalEmail} onChange={(event) => setWithdrawForm({ ...withdrawForm, paypalEmail: event.target.value })} placeholder="your-paypal@example.com" style={{ width: '100%', padding: '0.65rem 0.9rem' }} />
                  </div>
                ) : (() => {
                    const bankCfg = getCountryBankConfig(userCountryCode);
                    return (
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <div>
                          <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.25rem' }}>Bank Name</label>
                          <input className="input" type="text" required value={withdrawForm.bankName} onChange={(event) => setWithdrawForm({ ...withdrawForm, bankName: event.target.value })} placeholder={bankCfg.bankPlaceholder} style={{ width: '100%', padding: '0.6rem 0.85rem', fontSize: '0.9rem' }} />
                        </div>
                        <div>
                          <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.25rem' }}>Account Holder Full Name</label>
                          <input className="input" type="text" required value={withdrawForm.accountName} onChange={(event) => setWithdrawForm({ ...withdrawForm, accountName: event.target.value })} placeholder="Full name as on bank account" style={{ width: '100%', padding: '0.6rem 0.85rem', fontSize: '0.9rem' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '0.6rem' }}>
                          <div>
                            <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.25rem' }}>{bankCfg.routingLabel}</label>
                            <input className="input mono" type="text" required value={withdrawForm.routing} onChange={(event) => setWithdrawForm({ ...withdrawForm, routing: event.target.value })} placeholder={bankCfg.routingPlaceholder} style={{ width: '100%', padding: '0.6rem 0.85rem', fontSize: '0.88rem' }} />
                          </div>
                          <div>
                            <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.25rem' }}>{bankCfg.accountLabel}</label>
                            <input className="input mono" type="text" required value={withdrawForm.bankAccount} onChange={(event) => setWithdrawForm({ ...withdrawForm, bankAccount: event.target.value })} placeholder={bankCfg.accountPlaceholder} style={{ width: '100%', padding: '0.6rem 0.85rem', fontSize: '0.88rem' }} />
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                <button className="btn btn-primary" disabled={withdrawLoading} type="submit" style={{ padding: '0.85rem', fontSize: '0.95rem', fontWeight: 700, borderRadius: '12px', marginTop: '0.25rem' }}>
                  Review Payout Details
                </button>
              </form>
            )}

            {/* ── Step 0: Confirmation popup ─────────────────────────── */}
            {withdrawStep === 0 && (
              <div style={{ display: 'grid', gap: '1.2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <ArrowDownLeft size={20} color="white" />
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--primary)' }}>Confirm Withdrawal</span>
                    <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Review your payout</h3>
                  </div>
                </div>

                <div style={{ textAlign: 'center', padding: '1.3rem 1rem', background: 'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.06))', borderRadius: '18px', border: '1.5px solid rgba(99,102,241,0.18)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>Withdrawal Amount</div>
                  <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'monospace', lineHeight: 1 }}>
                    {formatCurrency(parseFloat(withdrawForm.amount || '0'), userCurrency)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', marginTop: '0.4rem' }}>
                    {'The requested amount is deducted without conversion'}
                  </div>
                </div>

                {/* Account details box */}
                <div style={{ padding: '0.9rem 1.1rem', background: 'var(--surface-soft)', borderRadius: '14px', border: '1px solid var(--border)', display: 'grid', gap: '0.4rem' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {withdrawMethod === 'paypal' ? 'PayPal Account' : 'Bank Transfer Account'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.88rem', wordBreak: 'break-all' }}>
                      {withdrawMethod === 'paypal'
                        ? withdrawForm.paypalEmail
                        : `${withdrawForm.bankName} · ${withdrawForm.accountName} (${withdrawForm.routing})`}
                    </span>
                  </div>
                  {withdrawMethod === 'bank' && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-3)', fontFamily: 'monospace', paddingLeft: '1.5rem' }}>
                      Account #: ••••{withdrawForm.bankAccount.slice(-4)}
                    </div>
                  )}
                </div>

                {/* Info notice */}
                <div style={{ padding: '0.9rem 1rem', background: 'rgba(245,158,11,0.07)', borderRadius: '14px', border: '1px solid rgba(245,158,11,0.22)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>⏱️</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text-1)', marginBottom: '0.2rem' }}>
                      Processing time: {withdrawMethod === 'paypal' ? '2–3 hours' : '1–2 business days'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', lineHeight: 1.5 }}>
                      {withdrawMethod === 'paypal'
                        ? <>Funds will be sent to your PayPal account <strong>{withdrawForm.paypalEmail}</strong>.</>
                        : <>Wire transfer will be issued to <strong>{withdrawForm.bankName}</strong> for <strong>{withdrawForm.accountName}</strong>.</>}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: '0.75rem' }}>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => setWithdrawStep(1)}
                    style={{ borderRadius: '12px', padding: '0.85rem', fontWeight: 600 }}
                  >
                    ← Go Back
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={withdrawLoading}
                    onClick={handleWithdrawalConfirm}
                    style={{ borderRadius: '12px', padding: '0.85rem', fontWeight: 700, fontSize: '0.95rem' }}
                  >
                    {withdrawLoading ? <><span className="spinner" /> Processing…</> : 'Confirm & Request'}
                  </button>
                </div>
              </div>
            )}

            {withdrawStep === 2 && (
              <div style={{ textAlign: 'center', display: 'grid', gap: '1.2rem', padding: '2rem 0' }}>
                <span className="spinner" style={{ margin: '0 auto', width: '48px', height: '48px', borderWidth: '4px', borderColor: 'var(--primary) transparent transparent transparent' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>
                    {withdrawMethod === 'paypal' ? 'Connecting to PayPal...' : 'Submitting Bank Wire Request...'}
                  </h3>
                  <p style={{ margin: '0.4rem 0 0', color: 'var(--text-3)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    Securing transaction details and logging payout request.
                  </p>
                </div>
              </div>
            )}

            {withdrawStep === 3 && (
              <div style={{ textAlign: 'center', display: 'grid', gap: '1.2rem', padding: '1rem 0' }}>
                <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'var(--green-muted)', border: '1px solid var(--green-border)', display: 'grid', placeItems: 'center', margin: '0 auto', color: 'var(--green)' }}>
                  <CheckCircle2 size={28} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>Payout Requested</h3>
                  <p style={{ margin: '0.5rem 0 0', color: 'var(--text-3)', lineHeight: 1.6, fontSize: '0.92rem' }}>
                    Your payout of <strong>
                      {formatCurrency(parseFloat(withdrawForm.amount || '0'), userCurrency)}
                    </strong> via {withdrawMethod === 'paypal' ? 'PayPal' : 'Bank Transfer'} has been logged and is being processed.
                  </p>
                </div>
                <button className="btn btn-secondary" onClick={() => setShowWithdrawModal(false)} style={{ borderRadius: '12px', padding: '0.75rem' }}>
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showAddMoneyModal && createPortal(
        <div
          className="glass-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !addMoneyLoading) setShowAddMoneyModal(false);
          }}
        >
          <div className="glass-modal-panel fade-in" style={{ maxWidth: '460px', width: '100%', maxHeight: 'min(92dvh, 740px)', overflowY: 'auto' }}>
            <div style={{ display: 'grid', gap: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--primary-soft)', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                    <ArrowUpRight size={18} />
                  </div>
                  <div>
                    <span className="section-label" style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>Top-up wallet</span>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Add funds</h3>
                  </div>
                </div>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowAddMoneyModal(false)} style={{ borderRadius: '10px' }}>
                  Close
                </button>
              </div>

              <div>
                <label className="label" style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.35rem' }}>
                  Amount ({userCurrency})
                </label>
                <input className="input mono" type="number" min="1" required value={addMoneyAmount} disabled={!!stripeResumeOrder || addMoneyLoading} onChange={(event) => setAddMoneyAmount(event.target.value)} style={{ width: '100%', fontSize: '1.2rem', padding: '0.75rem 1rem', marginBottom: '1rem' }} />
              </div>

              {/* Quick top-up chips */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {(selectedGateway === 'razorpay' ? ['500', '1000', '2000', '5000'] : ['10', '25', '50', '100']).map((val) => (
                  <button
                    key={val}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!!stripeResumeOrder || addMoneyLoading}
                    onClick={() => setAddMoneyAmount(val)}
                    style={{
                      background: addMoneyAmount === val ? 'var(--primary-muted)' : 'var(--surface-soft)',
                      borderColor: addMoneyAmount === val ? 'var(--primary)' : 'var(--border)',
                      color: addMoneyAmount === val ? 'var(--primary)' : 'var(--text-2)',
                      fontWeight: 600,
                      borderRadius: '10px'
                    }}
                  >
                    {profileCountry?.currencySymbol ?? userCurrency}{val}
                  </button>
                ))}
              </div>

              {/* Payment method selector — country-aware */}
              <PaymentMethodSelector
                selected={selectedGateway}
                onSelect={setSelectedGateway}
                disabled={!!stripeResumeOrder || addMoneyLoading}
                countryCode={userCountryCode}
                userCurrency={userCurrency}
              />

              {/* Wallet currency */}
              <p className="text-sm">Wallet deposits use {userCurrency}. Amounts are never converted.</p>

              <div style={{ position: 'relative', zIndex: 0 }}>
                {addMoneyLoading && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)', zIndex: 10, display: 'grid', placeItems: 'center', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
                      <span className="spinner" style={{ width: '2rem', height: '2rem', borderTopColor: 'var(--primary)' }} />
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-2)', fontWeight: 600 }}>Processing…</span>
                    </div>
                  </div>
                )}

                {/* ── Razorpay UI ── */}
                {selectedGateway === 'razorpay' && (
                  <button
                    id="razorpay-pay-btn"
                    type="button"
                    className="btn btn-primary"
                    disabled={addMoneyLoading}
                    onClick={handleRazorpayPayment}
                    style={{
                      width: '100%',
                      padding: '0.85rem 1.5rem',
                      borderRadius: '12px',
                      fontWeight: 700,
                      fontSize: '1rem',
                      background: 'linear-gradient(135deg, #072654 0%, #1e78ff 100%)',
                      border: 'none',
                      color: '#fff',
                      cursor: addMoneyLoading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      transition: 'opacity 0.18s',
                      opacity: addMoneyLoading ? 0.6 : 1,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="white" strokeWidth="2"/>
                      <path d="M8 12L11 15L16 10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Pay ₹{parseFloat(addMoneyAmount || '0').toFixed(0)} with Razorpay
                  </button>
                )}

                {/* ── Stripe UI ── */}
                {selectedGateway === 'stripe' && !pendingStripeIntent && (
                  <div style={{ width: '100%', marginBottom: '1.25rem' }}>
                    {stripeLoading && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1.5rem 0', gap: '0.75rem', color: '#635bff' }}>
                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', border: '3px solid rgba(99,91,255,0.2)', borderTopColor: '#635bff', animation: 'spin 0.8s linear infinite' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Loading secure card field...</span>
                        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      </div>
                    )}
                    <div id="stripe-payment-element" style={{ display: stripeLoading ? 'none' : 'block' }} />
                    <button
                      id="stripe-pay-btn"
                      type="button"
                      className="btn btn-primary"
                      disabled={addMoneyLoading || stripeLoading}
                      onClick={handleStripePayment}
                      style={{
                        width: '100%',
                        padding: '0.85rem 1.5rem',
                        borderRadius: '12px',
                        fontWeight: 700,
                        fontSize: '1rem',
                        background: 'linear-gradient(135deg, #635bff 0%, #9f98ff 100%)',
                        border: 'none',
                        color: '#fff',
                        cursor: (addMoneyLoading || stripeLoading) ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        transition: 'opacity 0.18s',
                        opacity: (addMoneyLoading || stripeLoading) ? 0.6 : 1,
                        marginTop: '1rem',
                      }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="5" width="20" height="14" rx="2" stroke="white" strokeWidth="2"/>
                        <path d="M2 10H22" stroke="white" strokeWidth="2"/>
                      </svg>
                      Pay {formatCurrency(parseFloat(addMoneyAmount || '0'), userCurrency)} with Stripe
                    </button>
                  </div>
                )}

                {/* ── PayPal UI (original flow preserved) ── */}
                {pendingPayPalOrder && <button className="btn btn-secondary" disabled={addMoneyLoading} onClick={async () => {
                  setAddMoneyLoading(true);
                  try {
                    const result = await verifyPayPalPayment(pendingPayPalOrder);
                    if (!result.verified) throw new Error('Wallet credit is still pending.');
                    await refreshWalletBalance();
                    await loadData();
                    setPendingPayPalOrder(null);
                    success('Payment confirmed', 'Your wallet has been credited.');
                    setShowAddMoneyModal(false);
                  } catch (err) { toastError('Credit pending', getErrorMessage(err, 'Retry verification later; do not pay again.')); }
                  finally { setAddMoneyLoading(false); }
                }}>Retry payment verification</button>}
                {selectedGateway === 'paypal' && !pendingPayPalOrder && (
                <PayPalButtons
                  style={{ layout: "vertical", color: "blue", shape: "rect", label: "pay" }}
                  createOrder={async () => {
                    const amount = Number(addMoneyAmount);
                    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Enter a valid amount up to 100,000 in your wallet currency.');
                    const order = await createPayPalOrder({ amount, currency: userCurrency });
                    return order.id;
                  }}
                  onApprove={async (data) => {
                    setPendingPayPalOrder(data.orderID);
                    setAddMoneyLoading(true);
                    try {
                      const result = await verifyPayPalPayment(data.orderID);
                      if (!result.verified || !result.amount) throw new Error('Wallet credit is pending. Retry verification with this order.');
                      await refreshWalletBalance();
                      await loadData();
                      setPendingPayPalOrder(null);
                      success('Funds added', `Successfully added ${formatCurrency(result.amount, userCurrency)} to your wallet.`);
                      setShowAddMoneyModal(false);
                    } catch (err: unknown) {
                      toastError('Deposit pending', getErrorMessage(err, 'Please retry payment verification; do not pay again.'));
                    } finally {
                      setAddMoneyLoading(false);
                    }
                  }}
                  onError={() => toastError('PayPal unavailable', 'Payment was not confirmed. Please retry.')}

                />
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
    </PayPalScriptProvider>
  );
}
