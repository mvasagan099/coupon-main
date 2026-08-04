// src/lib/supabase.ts
import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || "https://placeholder.supabase.co";
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "placeholder-anon-key";

export const isSupabaseConfigured =
  !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!isSupabaseConfigured) {
  console.warn(
    "[CouponVault] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.\n" +
    "Copy .env.example to .env and add your Supabase credentials."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  global: { headers: {} },
  db: { schema: 'public' },
});

/**
 * Race a promise against a timeout so it never hangs forever.
 * Rejects with a TimeoutError after `ms` milliseconds.
 */
class TimeoutError extends Error {
  constructor(ms: number) { super(`Request timed out after ${ms}ms`); this.name = 'TimeoutError'; }
}
const hasTimedOut = false;

function withTimeout<T>(promise: PromiseLike<T>, ms = 15000): Promise<T> {
  if (!isSupabaseConfigured) {
    return Promise.reject(new Error("Supabase is not configured, failing fast."));
  }
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => setTimeout(() => {
      reject(new TimeoutError(ms));
    }, ms)),
  ]);
}

// ---- Interfaces --------------------------------------------------

export interface Company {
  id: string;
  name: string;
  prefix: string;
  coupon_limit: number;
  created_at: string;
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
  gstin?: string;
  pan?: string;
  address?: string;
  bank_name?: string;
  account_number?: string;
  ifsc_code?: string;
  document_url?: string;
  owner_id?: string;
}

export interface Withdrawal {
  id: string;
  user_id: string;
  amount: number;
  routing_number: string;
  account_number: string;
  status: 'pending' | 'completed' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface UserDeposit {
  id: string;
  user_id: string;
  amount: number;
  payment_method: string;
  reference_id?: string;
  status: 'completed' | 'pending' | 'failed';
  created_at: string;
}

export interface GiftCard {
  id: string;
  company_id: string;
  company_name?: string;
  title: string;
  description: string;
  value: number;
  price: number;
  expiry_date: string;
  banner_image: string;
  terms: string;
  issue_limit?: number | null;
  created_at: string;
  issued_count?: number;
}

export interface Coupon {
  id: string;
  company_id: string;
  company_name?: string;
  gift_card_id?: string;
  code: string;
  is_used: boolean;
  issued_to: string | null;
  created_at: string;
  remaining_balance: number;
  expiry_date: string;
  status: 'active' | 'redeemed' | 'expired';
  redeemed_at?: string;
  country_code?: string;
}

export interface RedemptionTransaction {
  id: string;
  coupon_id: string;
  coupon_code?: string;
  company_name?: string;
  amount: number;
  remaining_balance_after: number;
  created_at: string;
}

export interface Order {
  id: string;
  user_id: string;
  company_id: string;
  coupon_id: string | null;
  gift_card_id?: string;
  status: "pending" | "paid" | "failed";
  amount: number;
  payment_details?: any;
  created_at: string;
  company?: { name: string; prefix: string };
  coupon?: { code: string; is_used: boolean; remaining_balance: number; status: string } | null;
}

export interface CouponValidation {
  company_name: string;
  coupon_code: string;
  is_used: boolean;
  issued_at: string;
  remaining_balance: number;
  expiry_date: string;
  status: string;
  coupon_id: string;
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  role: string;
}

export interface AdminPurchasedCoupon {
  coupon_id: string;
  coupon_code: string;
  company_name: string;
  is_used: boolean;
  purchased_at: string;
  user_id: string;
  user_email: string;
  redeemed_at?: string;
  remaining_balance: number;
  status: string;
  price?: number;
  value?: number;
}

export interface Settlement {
  id: string;
  company_id: string;
  period_month: string;
  total_redemptions: number;
  amount_due: number;
  status: 'pending' | 'paid';
  created_at: string;
  paid_at?: string;
  company?: { name: string; prefix: string };
}

export interface CompanyStats {
  company: Company;
  issued: number;
  remaining: number;
}

// ---- LocalStorage Fallback Database Mock -------------------------

function getLocal<T>(key: string, def: T): T {
  const v = localStorage.getItem(key);
  if (!v) return def;
  try { return JSON.parse(v); } catch { return def; }
}

function setLocal<T>(key: string, val: T): void {
  localStorage.setItem(key, JSON.stringify(val));
}

const INIT_COMPANIES: Company[] = [];

const INIT_GIFT_CARDS: GiftCard[] = [];

export function initializeLocalStorageDB() {
  if (!localStorage.getItem("cv_companies")) {
    setLocal("cv_companies", INIT_COMPANIES);
  }
  if (!localStorage.getItem("cv_gift_cards")) {
    setLocal("cv_gift_cards", INIT_GIFT_CARDS);
  }
  if (!localStorage.getItem("cv_coupons")) {
    setLocal("cv_coupons", []);
  }
  if (!localStorage.getItem("cv_redemptions")) {
    setLocal("cv_redemptions", []);
  }
  if (!localStorage.getItem("cv_orders")) {
    setLocal("cv_orders", []);
  }
}

// Ensure the local storage mock DB is primed
initializeLocalStorageDB();

// ---- Company / Onboarding API ------------------------------------

export async function getCompanies(): Promise<Company[]> {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false }),
      8000
    );
    if (error) throw error;
    return data ?? [];
  } catch (err: any) {
    console.warn("[CouponVault] getCompanies failed, falling back to LocalStorage:", err.message);
    return getLocal<Company[]>("cv_companies", []);
  }
}

export async function getCompanyByOwner(ownerId: string): Promise<Company | null> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from("companies")
        .select("*")
        .eq("owner_id", ownerId)
        .maybeSingle(),
      8000
    );
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.warn("[CouponVault] getCompanyByOwner failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    return companies.find(c => c.owner_id === ownerId) ?? null;
  }
}

export async function submitOnboarding(companyData: Partial<Company>): Promise<Company> {
  const insertPayload = {
    name: companyData.name,
    prefix: (companyData.prefix ?? "MCH").toUpperCase().replace(/[^A-Z]/g, '').padEnd(3, 'X').substring(0, 3),
    coupon_limit: companyData.coupon_limit ?? 100,
    status: "pending",
    gstin: companyData.gstin,
    pan: companyData.pan,
    address: companyData.address,
    bank_name: companyData.bank_name,
    account_number: companyData.account_number,
    ifsc_code: companyData.ifsc_code,
    document_url: companyData.document_url || "cert_incorporation.pdf",
    owner_id: companyData.owner_id,
  };

  try {
    let response;
    if (companyData.owner_id) {
      const existingCompany = await getCompanyByOwner(companyData.owner_id);
      if (existingCompany) {
        response = await supabase
          .from("companies")
          .update(insertPayload)
          .eq("id", existingCompany.id)
          .select()
          .single();
      }
    }

    if (!response) {
      response = await supabase
        .from("companies")
        .insert(insertPayload)
        .select()
        .single();
    }

    const { data, error } = response;
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.error("[CouponVault] submitOnboarding failed on the live database:", err.message);
    throw new Error(err.message || "Database rejected the company profile. Check constraints or RLS policies.");
  }
}

export async function createCompany(
  companyData: Partial<Company>
): Promise<Company> {
  try {
    const { data, error } = await supabase
      .from("companies")
      .insert({
        ...companyData,
        prefix: companyData.prefix?.toUpperCase(),
        status: 'approved'
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.warn("[CouponVault] createCompany failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    const newCompany: Company = {
      id: "co_" + Math.random().toString(36).substr(2, 9),
      name: companyData.name || "Unknown",
      prefix: companyData.prefix?.toUpperCase() || "UNK",
      coupon_limit: companyData.coupon_limit || 100,
      gstin: companyData.gstin,
      pan: companyData.pan,
      bank_name: companyData.bank_name,
      account_number: companyData.account_number,
      ifsc_code: companyData.ifsc_code,
      status: 'approved',
      created_at: new Date().toISOString()
    };
    companies.push(newCompany);
    setLocal("cv_companies", companies);
    return newCompany;
  }
}

export async function deleteCompany(id: string): Promise<void> {
  try {
    const { error: ordersErr } = await supabase.from("orders").delete().eq("company_id", id);
    if (ordersErr) throw ordersErr;
    const { error: couponsErr } = await supabase.from("coupons").delete().eq("company_id", id);
    if (couponsErr) throw couponsErr;
    const { error } = await supabase.from("companies").delete().eq("id", id);
    if (error) throw error;
  } catch (err: any) {
    console.warn("[CouponVault] deleteCompany failed, falling back to LocalStorage:", err.message);
    let companies = getLocal<Company[]>("cv_companies", []);
    companies = companies.filter(c => c.id !== id);
    setLocal("cv_companies", companies);

    let cards = getLocal<GiftCard[]>("cv_gift_cards", []);
    cards = cards.filter(c => c.company_id !== id);
    setLocal("cv_gift_cards", cards);

    let coupons = getLocal<Coupon[]>("cv_coupons", []);
    coupons = coupons.filter(c => c.company_id !== id);
    setLocal("cv_coupons", coupons);
  }
}

export async function updateCompanyLimit(id: string, limit: number): Promise<Company> {
  try {
    const { data, error } = await supabase
      .from("companies")
      .update({ coupon_limit: limit })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.warn("[CouponVault] updateCompanyLimit failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    const co = companies.find(c => c.id === id);
    if (!co) throw new Error("Company not found");
    co.coupon_limit = limit;
    setLocal("cv_companies", companies);
    return co;
  }
}

export async function adminApproveCompany(id: string): Promise<Company> {
  try {
    const { data, error } = await supabase
      .from("companies")
      .update({ status: "approved" })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.warn("[CouponVault] adminApproveCompany failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    const co = companies.find(c => c.id === id);
    if (!co) throw new Error("Company not found");
    co.status = "approved";
    setLocal("cv_companies", companies);
    return co;
  }
}

export async function adminRejectCompany(id: string): Promise<Company> {
  try {
    const { data, error } = await supabase
      .from("companies")
      .update({ status: "rejected" })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  } catch (err: any) {
    console.warn("[CouponVault] adminRejectCompany failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    const co = companies.find(c => c.id === id);
    if (!co) throw new Error("Company not found");
    co.status = "rejected";
    setLocal("cv_companies", companies);
    return co;
  }
}

export async function getCompanyStats(): Promise<CompanyStats[]> {
  try {
    const { data: companies, error: ce } = await supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: false });
    if (ce) throw ce;

    const { data: counts, error: cnte } = await supabase
      .from("coupons")
      .select("company_id");
    if (cnte) throw cnte;

    const issuedMap: Record<string, number> = {};
    (counts ?? []).forEach((c) => {
      issuedMap[c.company_id] = (issuedMap[c.company_id] ?? 0) + 1;
    });

    return (companies ?? []).map((co) => ({
      company: co,
      issued: issuedMap[co.id] ?? 0,
      remaining: co.coupon_limit - (issuedMap[co.id] ?? 0),
    }));
  } catch (err: any) {
    console.warn("[CouponVault] getCompanyStats failed, falling back to LocalStorage:", err.message);
    const companies = getLocal<Company[]>("cv_companies", []);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    return companies.map(co => {
      const issued = coupons.filter(c => c.company_id === co.id).length;
      return {
        company: co,
        issued,
        remaining: co.coupon_limit - issued
      };
    });
  }
}

// ---- Gift Card API -----------------------------------------------

export async function getGiftCards(companyId?: string): Promise<GiftCard[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    
    // First, try the new RPC which bypasses RLS to get global counts
    let { data, error } = await supabase.rpc('get_gift_cards_with_counts');
    
    // If the RPC doesn't exist yet, fallback to the standard select
    if (error) {
      let query = supabase.from("gift_cards").select("*, companies(name)");
      if (companyId) {
        query = query.eq("company_id", companyId);
      }
      const res = await withTimeout(query.order("created_at", { ascending: false }), 8000);
      data = res.data;
      error = res.error;
    } else if (companyId && data) {
      // If RPC succeeded but we need to filter by company
      data = data.filter((d: any) => d.company_id === companyId);
    }
    
    if (error) throw error;
    const localCards = getLocal<GiftCard[]>("cv_gift_cards", []);
    const localFiltered = companyId ? localCards.filter(c => c.company_id === companyId) : localCards;
    
    const issuedCounts = getLocal<Record<string, number>>("cv_issued_counts", {});

    return [
      ...localFiltered.map(c => ({ ...c, issued_count: Math.max(c.issued_count || 0, issuedCounts[c.id] || 0) })),
      ...(data ?? []).map((d: any) => ({
        ...d,
        company_name: d.company_name || d.companies?.name,
        // Use the global count if available, otherwise fallback to local trackers
        issued_count: Math.max(d.issued_count || 0, issuedCounts[d.id] || 0)
      }))
    ];
  } catch (err: any) {
    console.warn("[CouponVault] getGiftCards failed, falling back to LocalStorage:", err.message);
    const cards = getLocal<GiftCard[]>("cv_gift_cards", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const filtered = companyId ? cards.filter(c => c.company_id === companyId) : cards;
    const issuedCounts = getLocal<Record<string, number>>("cv_issued_counts", {});
    
    return filtered.map(c => {
      const co = companies.find(comp => comp.id === c.company_id);
      return { ...c, company_name: co ? co.name : "Unknown Brand", issued_count: Math.max(c.issued_count || 0, issuedCounts[c.id] || 0) };
    });
  }
}

export async function createGiftCard(giftCardData: Omit<GiftCard, 'id' | 'created_at'>): Promise<GiftCard> {
  const { data, error } = await supabase
    .from("gift_cards")
    .insert(giftCardData)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGiftCard(id: string): Promise<void> {
  const { data, error } = await supabase.from("gift_cards").delete().eq("id", id).select("id");
  
  if (error) {
    console.error("[CouponVault] deleteGiftCard failed:", error);
    if (error.code === '23503') { // foreign_key_violation
      throw new Error("Cannot delete this campaign because customers have already purchased vouchers from it.");
    }
    throw new Error(error.message);
  }
  
  if (!data || data.length === 0) {
    throw new Error("Deletion blocked by database security policy. The campaign either doesn't exist or you don't have permission.");
  }
}

// ---- Coupon Purchase Flow (RPC issue_gift_card_coupon equivalent) ----

export async function purchaseGiftCard(
  giftCardId: string,
  userId: string,
  _userEmail: string,
  amountPaid: number
): Promise<{ coupon_code: string; order_id: string; coupon_id: string }> {
  const { data, error } = await supabase.rpc("issue_gift_card_coupon", {
    p_gift_card_id: giftCardId,
    p_user_id: userId,
    p_amount: amountPaid
  });
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Failed to issue coupon");
  
  // Increment local issued count for UI updates
  const counts = getLocal<Record<string, number>>("cv_issued_counts", {});
  counts[giftCardId] = (counts[giftCardId] || 0) + 1;
  setLocal("cv_issued_counts", counts);

  return {
    coupon_code: data[0].coupon_code,
    order_id: data[0].order_id,
    coupon_id: data[0].coupon_id
  };
}

export async function getUserOrders(userId: string) {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from("orders")
        .select(`
          *,
          company:companies(name, prefix),
          coupon:coupons(code, is_used, remaining_balance, status)
        `)
        .eq("user_id", userId)
        .eq("status", "paid")
        .order("created_at", { ascending: false }),
      8000
    );
    if (error) throw error;
    
    const dbOrders = data ?? [];

    const ordersRaw = getLocal<Order[]>("cv_orders", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const userLocalOrders = ordersRaw.filter(o => o.user_id === userId && o.status === "paid");
    
    const dbIds = new Set(dbOrders.map((o: any) => o.id));
    
    const uniqueLocalOrders = userLocalOrders
      .filter(o => !dbIds.has(o.id))
      .map(o => {
        const co = companies.find(comp => comp.id === o.company_id);
        const cp = coupons.find(coup => coup.id === o.coupon_id);
        return {
          ...o,
          company: co ? { name: co.name, prefix: co.prefix } : { name: "Unknown", prefix: "MCH" },
          coupon: cp ? { code: cp.code, is_used: cp.is_used, remaining_balance: cp.remaining_balance, status: cp.status } : null
        };
      });

    return [...uniqueLocalOrders, ...dbOrders].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err: any) {
    console.warn("[CouponVault] getUserOrders failed, falling back to LocalStorage:", err.message);
    const orders = getLocal<Order[]>("cv_orders", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const userOrders = orders.filter(o => o.user_id === userId && o.status === "paid");
    
    return userOrders.map(o => {
      const co = companies.find(comp => comp.id === o.company_id);
      const cp = coupons.find(coup => coup.id === o.coupon_id);
      return {
        ...o,
        company: co ? { name: co.name, prefix: co.prefix } : { name: "Unknown", prefix: "MCH" },
        coupon: cp ? { code: cp.code, is_used: cp.is_used, remaining_balance: cp.remaining_balance, status: cp.status } : null
      };
    });
  }
}

export async function getUserGiftCards(userId: string): Promise<Coupon[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from("coupons")
        .select("*, companies(name)")
        .eq("issued_to", userId)
        .order("created_at", { ascending: false }),
      8000
    );
    if (error) throw error;
    
    const dbCoupons = (data ?? []).map(d => ({
      ...d,
      company_name: d.companies?.name
    }));

    // Merge with LocalStorage in case some purchases fell back due to RPC failures
    const localCouponsRaw = getLocal<Coupon[]>("cv_coupons", []);
    const localCompanies = getLocal<Company[]>("cv_companies", []);
    const userLocalCoupons = localCouponsRaw.filter(c => c.issued_to === userId);
    
    const dbIds = new Set(dbCoupons.map(c => c.id));
    const uniqueLocalCoupons = userLocalCoupons
      .filter(c => !dbIds.has(c.id))
      .map(c => {
        const co = localCompanies.find(comp => comp.id === c.company_id);
        return {
          ...c,
          company_name: co ? co.name : "Unknown Brand"
        };
      });

    return [...uniqueLocalCoupons, ...dbCoupons].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err: any) {
    console.warn("[CouponVault] getUserGiftCards failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const userCoupons = coupons.filter(c => c.issued_to === userId);
    return userCoupons.map(c => {
      const co = companies.find(comp => comp.id === c.company_id);
      return {
        ...c,
        company_name: co ? co.name : "Unknown Brand"
      };
    });
  }
}

export async function getCompanyCoupons(companyId: string): Promise<Coupon[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from("coupons")
        .select("*, companies(name)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }),
      8000
    );
    if (error) throw error;
    return (data ?? []).map(d => ({
      ...d,
      company_name: d.companies?.name
    }));
  } catch (err: any) {
    console.warn("[CouponVault] getCompanyCoupons failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const companyCoupons = coupons.filter(c => c.company_id === companyId);
    return companyCoupons.map(c => {
      const co = companies.find(comp => comp.id === c.company_id);
      return {
        ...c,
        company_name: co ? co.name : "Unknown Brand"
      };
    });
  }
}

// ---- Scanner / Validation / Redemption API -----------------------

export async function validateCoupon(code: string): Promise<CouponValidation> {
  try {
    const { data, error } = await supabase.rpc("validate_coupon", {
      p_code: code.toUpperCase().trim(),
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Invalid coupon code");
    return data[0] as CouponValidation;
  } catch (err: any) {
    console.warn("[CouponVault] validateCoupon failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const cp = coupons.find(c => c.code.toUpperCase().trim() === code.toUpperCase().trim());
    if (!cp) throw new Error("Invalid coupon code");
    
    const co = companies.find(comp => comp.id === cp.company_id);
    return {
      coupon_id: cp.id,
      coupon_code: cp.code,
      company_name: co ? co.name : "Unknown Brand",
      is_used: cp.is_used,
      issued_at: cp.created_at,
      remaining_balance: cp.remaining_balance,
      expiry_date: cp.expiry_date,
      status: cp.status
    };
  }
}

export async function validateCouponById(id: string): Promise<CouponValidation> {
  try {
    const { data, error } = await supabase.rpc("validate_coupon_by_id", {
      p_coupon_id: id,
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Invalid coupon link");
    return data[0] as CouponValidation;
  } catch (err: any) {
    console.warn("[CouponVault] validateCouponById failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const cp = coupons.find(c => c.id === id);
    if (!cp) throw new Error("Invalid coupon link");
    
    const co = companies.find(comp => comp.id === cp.company_id);
    return {
      coupon_id: cp.id,
      coupon_code: cp.code,
      company_name: co ? co.name : "Unknown Brand",
      is_used: cp.is_used,
      issued_at: cp.created_at,
      remaining_balance: cp.remaining_balance,
      expiry_date: cp.expiry_date,
      status: cp.status
    };
  }
}

export async function redeemCouponAmount(couponId: string, amount: number): Promise<{ remaining_balance: number; status: string }> {
  try {
    const { data, error } = await supabase.rpc("redeem_coupon_amount", {
      p_coupon_id: couponId,
      p_amount: amount
    });
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("Redemption failed");
    return {
      remaining_balance: data[0].remaining_balance,
      status: data[0].status
    };
  } catch (err: any) {
    console.warn("[CouponVault] redeemCouponAmount RPC failed, attempting direct table update:", err.message);
    try {
      const { data: cp, error: updateErr } = await supabase
        .from("coupons")
        .update({ is_used: true, status: "redeemed", remaining_balance: 0 })
        .eq("id", couponId)
        .select()
        .single();
      if (!updateErr && cp) {
        return { remaining_balance: 0, status: "redeemed" };
      }
    } catch {
      // Ignore direct update error and proceed to local fallback
    }

    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const idx = coupons.findIndex(c => c.id === couponId);
    if (idx !== -1) {
      coupons[idx] = { ...coupons[idx], is_used: true, status: "redeemed", remaining_balance: 0 };
      setLocal("cv_coupons", coupons);
      return { remaining_balance: 0, status: "redeemed" };
    }
    throw err;
  }
}

export async function markCouponUsedById(id: string): Promise<string> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");

    // 1. Get current coupon balance
    const { data: currentCoupon, error: fetchError } = await supabase
      .from("coupons")
      .select("remaining_balance, code")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    const prevBalance = currentCoupon.remaining_balance;

    // 2. Update coupon
    const { data: cp, error } = await supabase
      .from("coupons")
      .update({ is_used: true, status: "redeemed", remaining_balance: 0 })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;

    // 3. Log redemption transaction if there was a balance to redeem
    if (prevBalance > 0) {
      const { error: redemptionError } = await supabase
        .from("redemptions")
        .insert({
          coupon_id: id,
          amount: prevBalance,
          remaining_balance_after: 0
        });
      if (redemptionError) {
        console.error("[CouponVault] Failed to log redemption transaction:", redemptionError.message);
      }
    }

    return cp.code;
  } catch (err: any) {
    console.warn("[CouponVault] markCouponUsedById failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const idx = coupons.findIndex(c => c.id === id);
    if (idx === -1) throw new Error("Coupon not found in local storage");

    const prevBalance = coupons[idx].remaining_balance;
    coupons[idx] = {
      ...coupons[idx],
      is_used: true,
      status: "redeemed",
      remaining_balance: 0
    };
    setLocal("cv_coupons", coupons);

    if (prevBalance > 0) {
      const redemptions = getLocal<RedemptionTransaction[]>("cv_redemptions", []);
      redemptions.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        coupon_id: id,
        amount: prevBalance,
        remaining_balance_after: 0,
        created_at: new Date().toISOString()
      });
      setLocal("cv_redemptions", redemptions);
    }

    return coupons[idx].code;
  }
}

export async function getRedemptionTransactions(couponId?: string, companyId?: string): Promise<RedemptionTransaction[]> {
  try {
    let dbList: (RedemptionTransaction & { company_id?: string })[] = [];
    if (isSupabaseConfigured && !hasTimedOut) {
      // Attempt standard read
      const query = supabase.from("redemptions").select("*, coupons(code, company_id, companies(name))");
      const { data, error } = await withTimeout(query.order("created_at", { ascending: false }), 8000);
      if (!error && data) {
        dbList = data.map(d => ({
          id: d.id,
          coupon_id: d.coupon_id,
          coupon_code: d.coupons?.code,
          company_name: d.coupons?.companies?.name,
          company_id: d.coupons?.company_id,
          amount: Number(d.amount),
          remaining_balance_after: Number(d.remaining_balance_after),
          created_at: d.created_at
        }));
      }
    }

    // Get local redemptions
    const redemptions = getLocal<RedemptionTransaction[]>("cv_redemptions", []);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);

    const localList = redemptions.map(r => {
      const cp = coupons.find(c => c.id === r.coupon_id);
      const co = cp ? companies.find(comp => comp.id === cp.company_id) : null;
      return {
        ...r,
        coupon_code: cp ? cp.code : "Unknown Code",
        company_name: co ? co.name : "Unknown Brand",
        company_id: cp ? cp.company_id : undefined,
        amount: Number(r.amount),
        remaining_balance_after: Number(r.remaining_balance_after)
      };
    });

    const dbIds = new Set(dbList.map(r => r.id));
    const uniqueLocal = localList.filter(r => !dbIds.has(r.id));

    let combined = [...dbList, ...uniqueLocal];

    if (couponId) {
      combined = combined.filter(l => l.coupon_id === couponId);
    }
    if (companyId) {
      combined = combined.filter(l => l.company_id === companyId);
    }

    return combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err: any) {
    console.warn("[CouponVault] getRedemptionTransactions failed, falling back to LocalStorage:", err.message);
    const redemptions = getLocal<RedemptionTransaction[]>("cv_redemptions", []);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);

    let list = redemptions.map(r => {
      const cp = coupons.find(c => c.id === r.coupon_id);
      const co = cp ? companies.find(comp => comp.id === cp.company_id) : null;
      return {
        ...r,
        coupon_code: cp ? cp.code : "Unknown Code",
        company_name: co ? co.name : "Unknown Brand",
        company_id: cp ? cp.company_id : undefined,
        amount: Number(r.amount),
        remaining_balance_after: Number(r.remaining_balance_after)
      };
    });

    if (couponId) {
      list = list.filter(l => l.coupon_id === couponId);
    }
    if (companyId) {
      list = list.filter(l => l.company_id === companyId);
    }

    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

// Deprecated old coupon methods kept for compatibility with existing tests/shims
export async function markCouponUsed(code: string): Promise<void> {
  const validation = await validateCoupon(code);
  await redeemCouponAmount(validation.coupon_id, validation.remaining_balance);
}

export async function issueCoupon(
  companyId: string,
  userId: string
): Promise<{ coupon_code: string; order_id: string; coupon_id: string }> {
  // Legacy method fallback: Create a default ₹50 gift card for that company if it exists
  try {
    const { data: giftCards, error } = await supabase
      .from("gift_cards")
      .select("id")
      .eq("company_id", companyId)
      .limit(1);
    if (!error && giftCards && giftCards.length > 0) {
      return purchaseGiftCard(giftCards[0].id, userId, "legacy_user@couponvault.com", 50);
    }
  } catch {
    // Ignore and fallback
  }
  
  // Fallback storage fallback
  const cards = getLocal<GiftCard[]>("cv_gift_cards", []);
  let gc = cards.find(c => c.company_id === companyId);
  if (!gc) {
    gc = {
      id: "gc_temp_" + companyId,
      company_id: companyId,
      title: "Promotional Gift Card",
      description: "Default voucher",
      value: 50,
      price: 45,
      expiry_date: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
      banner_image: "",
      terms: "Legacy support",
      created_at: new Date().toISOString()
    };
    cards.push(gc);
    setLocal("cv_gift_cards", cards);
  }
  return purchaseGiftCard(gc.id, userId, "legacy_user@couponvault.com", 50);
}

// ---- Admin Management helpers ------------------------------------

export async function adminGetUsers(page: number = 0, pageSize: number = 20): Promise<AdminUser[]> {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const { data, error } = await withTimeout(supabase.rpc("admin_get_users").range(from, to), 8000);
  if (error) throw error;
  return data ?? [];
}

export async function adminGetPurchasedCoupons(page: number = 0, pageSize: number = 20): Promise<AdminPurchasedCoupon[]> {
  try {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase.rpc("admin_get_purchased_coupons").range(from, to);
    if (error) throw error;
    return data ?? [];
  } catch (err: any) {
    console.warn("[CouponVault] adminGetPurchasedCoupons failed, falling back to LocalStorage:", err.message);
    const coupons = getLocal<Coupon[]>("cv_coupons", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    const giftCards = getLocal<GiftCard[]>("cv_gift_cards", []);
    return coupons.map(c => {
      const co = companies.find(comp => comp.id === c.company_id);
      const gc = giftCards.find(card => card.id === c.gift_card_id);
      return {
        coupon_id: c.id,
        coupon_code: c.code,
        company_name: co ? co.name : "Unknown Brand",
        is_used: c.is_used,
        purchased_at: c.created_at,
        user_id: c.issued_to || "anonymous",
        user_email: c.issued_to === "usr_101" ? "customer@demo.com" : "customer@demo.com",
        redeemed_at: c.redeemed_at,
        remaining_balance: c.remaining_balance,
        status: c.status,
        price: gc ? gc.price : c.remaining_balance * 0.9,
        value: gc ? gc.value : c.remaining_balance
      };
    });
  }
}

export async function adminSuspendCompany(companyId: string): Promise<Company> {
  const { data, error } = await supabase
    .from("companies")
    .update({ status: "suspended" })
    .eq("id", companyId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserProfileData(userId: string): Promise<{
  wallet_balance: number;
  paypal_email: string | null;
  country: string | null;
  country_code: string | null;
  currency: string | null;
  timezone: string | null;
  phone_country_code: string | null;
}> {
  let data, error;
  
  // Try fetching all profile fields including country/currency
  const res1 = await withTimeout(
    supabase
      .from("profiles")
      .select("wallet_balance, paypal_email, country, country_code, currency, timezone, phone_country_code")
      .eq("id", userId)
      .maybeSingle(),
    6000
  );
  
  data = res1.data;
  error = res1.error;

  // If it fails (e.g. missing columns), fallback to just wallet_balance
  if (error) {
    console.warn("Could not fetch full profile, falling back to wallet_balance only:", error.message);
    const res2 = await withTimeout(
      supabase
        .from("profiles")
        .select("wallet_balance")
        .eq("id", userId)
        .maybeSingle(),
      6000
    );
    data = res2.data;
    error = res2.error;
  }

  const localEmail = localStorage.getItem(`cv_paypal_email_${userId}`);

  if (error) throw error;

  // Helper to extract user_metadata fallback if country_code is null in DB
  const getAuthMetadataFallback = async () => {
    try {
      const { data: authUserData } = await supabase.auth.getUser();
      const meta = authUserData?.user?.user_metadata;
      if (meta?.country_code || meta?.country) {
        return {
          country:            meta.country ?? null,
          country_code:       meta.country_code ?? null,
          currency:           meta.currency ?? null,
          timezone:           meta.timezone ?? null,
          phone_country_code: meta.phone_country_code ?? null,
        };
      }
    } catch {
      // Ignore auth metadata fetch error
    }
    return null;
  };

  if (data) {
    let country            = (data as any).country ?? null;
    let countryCode        = (data as any).country_code ?? null;
    let currency           = (data as any).currency ?? null;
    let timezone           = (data as any).timezone ?? null;
    let phoneCountryCode   = (data as any).phone_country_code ?? null;

    if (!countryCode) {
      const metaFallback = await getAuthMetadataFallback();
      if (metaFallback?.country_code) {
        country          = metaFallback.country;
        countryCode      = metaFallback.country_code;
        currency         = metaFallback.currency;
        timezone         = metaFallback.timezone;
        phoneCountryCode = metaFallback.phone_country_code;

        // Sync to profiles table in background
        void updateUserProfile(userId, {
          country:            country ?? undefined,
          country_code:       countryCode ?? undefined,
          currency:           currency ?? undefined,
          timezone:           timezone ?? undefined,
          phone_country_code: phoneCountryCode ?? undefined,
        }).catch(() => {});
      }
    }

    return {
      wallet_balance:     (data as any).wallet_balance ?? 0,
      paypal_email:       (data as any).paypal_email ?? localEmail ?? null,
      country,
      country_code:       countryCode,
      currency,
      timezone,
      phone_country_code: phoneCountryCode,
    };
  }
  
  // If no profile exists, create one with 0 balance
  const metaFallback = await getAuthMetadataFallback();
  const { data: newProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id:                 userId,
      wallet_balance:     0,
      country:            metaFallback?.country ?? null,
      country_code:       metaFallback?.country_code ?? null,
      currency:           metaFallback?.currency ?? null,
      timezone:           metaFallback?.timezone ?? null,
      phone_country_code: metaFallback?.phone_country_code ?? null,
    })
    .select("wallet_balance")
    .single();
    
  if (insertError) throw insertError;
  return {
    wallet_balance:     newProfile?.wallet_balance ?? 0,
    paypal_email:       localEmail,
    country:            metaFallback?.country ?? null,
    country_code:       metaFallback?.country_code ?? null,
    currency:           metaFallback?.currency ?? null,
    timezone:           metaFallback?.timezone ?? null,
    phone_country_code: metaFallback?.phone_country_code ?? null,
  };
}

export async function getUserWalletBalance(userId: string): Promise<number> {
  const profile = await getUserProfileData(userId);
  return profile.wallet_balance;
}

/** Update user's country, currency, and related locale fields */
export async function updateUserProfile(
  userId: string,
  data: {
    country?: string;
    country_code?: string;
    currency?: string;
    timezone?: string;
    phone_country_code?: string;
    paypal_email?: string;
  }
): Promise<void> {
  const { error } = await withTimeout(
    supabase
      .from('profiles')
      .update(data)
      .eq('id', userId),
    8000
  );
  if (error) throw error;
}

export async function updateUserPaypalEmail(userId: string, email: string): Promise<void> {
  // Save to localStorage as a fallback
  localStorage.setItem(`cv_paypal_email_${userId}`, email);
  
  try {
    const { error } = await supabase
      .from("profiles")
      .update({ paypal_email: email })
      .eq("id", userId);
    if (error) throw error;
  } catch (err) {
    console.warn("Failed to update paypal_email in Supabase, but saved to localStorage:", err);
  }
}

// DEPRECATED: Do not use for financial transactions on the frontend
export async function updateBalances(newBalance: number): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id) {
    await supabase.from("profiles").update({ wallet_balance: newBalance }).eq("id", session.user.id);
  }
}

// DEPRECATED & DISABLED: Direct client-side wallet funding is disabled for security.
// Funds must be added via verified server-side Edge Functions or the API server.
export async function addFunds(_userId: string, _amount: number, _paymentMethod: string = 'Wallet Top-up', _referenceId?: string): Promise<number> {
  throw new Error("Direct client-side fund addition is disabled for security. Use verified payment gateways.");
}

export async function getUserDeposits(userId: string): Promise<UserDeposit[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");

    const depositsQuery = supabase
      .from('deposits')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const transfersQuery = supabase
      .from('wallet_transfers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const [depRes, trfRes] = await Promise.all([
      withTimeout(depositsQuery, 8000).catch(() => ({ data: null, error: null })),
      withTimeout(transfersQuery, 8000).catch(() => ({ data: null, error: null })),
    ]);

    const dbDeposits: UserDeposit[] = ((depRes as any)?.data ?? []).map((d: any) => ({
      id: d.id,
      user_id: d.user_id,
      amount: Number(d.amount),
      payment_method: d.payment_method || 'Wallet Top-up',
      reference_id: d.reference_id || d.id,
      status: (d.status?.toLowerCase() === 'success' ? 'completed' : d.status?.toLowerCase()) || 'completed',
      created_at: d.created_at,
    }));

    const dbTransfers: UserDeposit[] = ((trfRes as any)?.data ?? []).map((t: any) => ({
      id: t.id,
      user_id: t.user_id,
      amount: Number(t.amount),
      payment_method: 'Lottery Winnings Transfer',
      reference_id: t.transaction_id || t.reference_id || t.id,
      status: (t.status?.toLowerCase() === 'success' ? 'completed' : t.status?.toLowerCase()) || 'completed',
      created_at: t.created_at,
    }));

    const localDeposits = getLocal<UserDeposit[]>("cv_deposits", []).filter(d => d.user_id === userId);

    const existingIds = new Set([...dbDeposits.map(d => d.id), ...dbTransfers.map(t => t.id)]);
    const uniqueLocal = localDeposits.filter(d => !existingIds.has(d.id));

    const allCombined = [...dbDeposits, ...dbTransfers, ...uniqueLocal];
    return allCombined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } catch (err: any) {
    const localDeposits = getLocal<UserDeposit[]>("cv_deposits", []);
    return localDeposits.filter(d => d.user_id === userId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

/**
 * CRIT-05: This function has been intentionally disabled.
 * Wallet balance MUST only be modified by server-side Supabase RPCs or the backend API.
 * Direct client-side updates allow any user to set their balance to any value.
 *
 * All callers should be refactored to use server-side RPCs with RLS enforcement.
 * The Supabase migration also REVOKEs direct UPDATE on wallet_balance from the
 * authenticated role, so any remaining direct calls will fail at the database level.
 */
export async function updateUserWalletBalance(_userId: string, _amount: number): Promise<void> {
  // Balance is managed server-side only. This is intentionally a no-op.
  // After a balance-changing operation, always call refreshWalletBalance() to
  // re-read the authoritative value from the server.
  console.warn(
    '[CouponVault] updateUserWalletBalance() is deprecated and has no effect. ' +
    'Use server-side RPCs for all balance modifications.'
  );
}

export async function ensureUserProfile(userId: string): Promise<void> {
  // Non-critical: silently attempt to create/verify the profile row.
  // The wallet falls back to localStorage on any failure, so we never
  // surface errors or log noisy warnings to the console.
  try {
    const { data, error } = await withTimeout(
      supabase
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle(),
      3000 // short timeout — fail fast, fall back to localStorage
    );

    if (error) return; // RLS error, table missing, etc. — all non-fatal
    if (data) return;

    // Profile row doesn't exist yet — create it
    await withTimeout(
      supabase
        .from("profiles")
        .insert({ id: userId, wallet_balance: 0 }),
      3000
    );
  } catch {
    // Swallow all errors silently — this is a best-effort operation
  }
}

async function readFunctionsInvokeErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context as Response;
    try {
      const clone = res.clone();
      const ct = clone.headers.get("Content-Type") ?? "";
      if (ct.includes("application/json")) {
        const json = (await clone.json()) as { error?: string; message?: string };
        if (json?.error) return json.error;
        if (json?.message) return json.message;
      } else {
        const text = await clone.text();
        if (text) return text.slice(0, 500);
      }
    } catch {
      /* ignore */
    }
    return `${error.message} (HTTP ${(error.context as Response)?.status ?? "?"})`;
  }
  return error instanceof Error ? error.message : String(error);
}

// Razorpay deposits removed — PayPal is the only supported deposit method.
// If Razorpay is reintroduced later, verify-razorpay-payment must fetch the
// captured amount from Razorpay's Payments API server-side and credit via
// add_funds_secure, exactly like verify-paypal-payment does. Do not restore
// a client-side wallet-crediting call for it.



// ---- PayPal API --------------------------------------------------------

export async function createPayPalOrder(input: {
  amount: number;
  currency?: string;
}): Promise<{ id: string }> {
  const { data, error } = await supabase.functions.invoke("create-paypal-order", {
    body: {
      amount: input.amount,
      currency: input.currency ?? "INR",
      receipt: `wallet_topup_${Date.now()}`,
    },
  });

  if (error) {
    const msg = await readFunctionsInvokeErrorMessage(error);
    throw new Error(`Failed to create PayPal order: ${msg}`);
  }
  
  if (!data?.id) {
    throw new Error("PayPal order response was incomplete.");
  }
  
  return data as { id: string };
}

export async function verifyPayPalPayment(orderId: string): Promise<{ verified: boolean; amount?: number }> {
  if (!orderId) {
    throw new Error('Payment verification requires a PayPal orderId.');
  }

  const { data, error } = await supabase.functions.invoke('verify-paypal-payment', {
    body: { order_id: orderId },
  });

  if (error) {
    const msg = await readFunctionsInvokeErrorMessage(error);
    throw new Error(`Payment verification failed: ${msg}`);
  }

  const isVerified = !!data?.verified;
  const capturedAmount = data?.amount ? Number(data.amount) : undefined;

  if (isVerified && capturedAmount && capturedAmount > 0) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        // Execute backup wallet credit RPC to ensure balance is always updated
        await supabase.rpc('add_funds_secure', {
          p_user_id: user.id,
          p_amount: capturedAmount,
        });

        // Record deposit log if table exists
        try {
          await supabase.from('deposits').insert({
            user_id: user.id,
            amount: capturedAmount,
            payment_method: 'PayPal',
            reference_id: orderId,
            status: 'completed',
          });
        } catch {
          // Ignore missing deposits table error
        }
      }
    } catch (backupErr) {
      console.warn('Backup wallet credit RPC notice:', backupErr);
    }
  }

  return { verified: isVerified, amount: capturedAmount };
}

// ---- Withdrawal API ----------------------------------------------------

export async function createWithdrawal(userId: string, amount: number, routing: string, account: string) {
  const { data, error } = await withTimeout(
    supabase
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        routing_number: routing,
        account_number: account,
        status: 'pending'
      })
      .select()
      .single()
  );

  if (error) throw error;
  return data;
}

export async function getUserWithdrawals(userId: string) {
  const { data, error } = await withTimeout(
    supabase
      .from('withdrawals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );

  if (error) throw error;
  return data as Withdrawal[];
}

// ---- Settlements API ----

export async function adminGenerateSettlements(year: number, month: number, companyId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('generate_monthly_settlements', {
    p_year: year,
    p_month: month,
    p_company_id: companyId || null
  });
  if (error) throw error;
  return data as number;
}

export async function adminGetSettlements(): Promise<Settlement[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from('settlements')
        .select('*, company:companies(name, prefix)')
        .order('period_month', { ascending: false })
        .order('created_at', { ascending: false })
    );
    if (error) throw error;
    
    // Merge with LocalStorage
    const localSettlements = getLocal<Settlement[]>("cv_settlements", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    
    const dbIds = new Set((data ?? []).map(s => s.id));
    const uniqueLocal = localSettlements.filter(s => !dbIds.has(s.id)).map(s => {
      const co = companies.find(c => c.id === s.company_id);
      return { ...s, company: co ? { name: co.name, prefix: co.prefix } : undefined };
    });
    
    return [...uniqueLocal, ...(data ?? [])] as Settlement[];
  } catch (err: any) {
    console.warn("[CouponVault] adminGetSettlements fallback:", err.message);
    const settlements = getLocal<Settlement[]>("cv_settlements", []);
    const companies = getLocal<Company[]>("cv_companies", []);
    
    return settlements.map(s => {
      const co = companies.find(c => c.id === s.company_id);
      return { ...s, company: co ? { name: co.name, prefix: co.prefix } : undefined };
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function merchantGetSettlements(companyId: string): Promise<Settlement[]> {
  try {
    if (!isSupabaseConfigured || hasTimedOut) throw new Error("Failing fast for local mock");
    const { data, error } = await withTimeout(
      supabase
        .from('settlements')
        .select('*, company:companies(name, prefix)')
        .eq('company_id', companyId)
        .order('period_month', { ascending: false })
    );
    if (error) throw error;
    
    const localSettlements = getLocal<Settlement[]>("cv_settlements", []).filter(s => s.company_id === companyId);
    const companies = getLocal<Company[]>("cv_companies", []);
    
    const dbIds = new Set((data ?? []).map(s => s.id));
    const uniqueLocal = localSettlements.filter(s => !dbIds.has(s.id)).map(s => {
      const co = companies.find(c => c.id === s.company_id);
      return { ...s, company: co ? { name: co.name, prefix: co.prefix } : undefined };
    });
    
    return [...uniqueLocal, ...(data ?? [])] as Settlement[];
  } catch (err: any) {
    console.warn("[CouponVault] merchantGetSettlements fallback:", err.message);
    const settlements = getLocal<Settlement[]>("cv_settlements", []).filter(s => s.company_id === companyId);
    const companies = getLocal<Company[]>("cv_companies", []);
    
    return settlements.map(s => {
      const co = companies.find(c => c.id === s.company_id);
      return { ...s, company: co ? { name: co.name, prefix: co.prefix } : undefined };
    }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function adminMarkSettlementPaid(settlementId: string): Promise<void> {
  const { error } = await supabase
    .from('settlements')
    .update({ 
      status: 'paid',
      paid_at: new Date().toISOString()
    })
    .eq('id', settlementId);
    
  if (error) throw error;
}

// ---- Admin Withdrawal Management ----

export interface AdminWithdrawal {
  id: string;
  user_id: string;
  email: string;
  country?: string | null;
  country_code?: string | null;
  currency?: string | null;
  amount: number;
  routing_number: string;
  account_number: string;
  status: 'pending' | 'completed' | 'rejected';
  created_at: string;
}

export async function adminGetWithdrawals(): Promise<AdminWithdrawal[]> {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc('admin_get_withdrawals'),
      8000
    );
    if (error) throw error;
    
    let rawList = (data ?? []) as AdminWithdrawal[];
    if (rawList.length > 0) {
      const userIds = Array.from(new Set(rawList.map(w => w.user_id)));
      try {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, country, country_code, currency')
          .in('id', userIds);
        
        if (profiles && profiles.length > 0) {
          const profileMap = new Map(profiles.map(p => [p.id, p]));
          rawList = rawList.map(w => {
            const prof = profileMap.get(w.user_id);
            return {
              ...w,
              country: w.country ?? prof?.country ?? null,
              country_code: w.country_code ?? prof?.country_code ?? null,
              currency: w.currency ?? prof?.currency ?? 'USD',
            };
          });
        }
      } catch (profErr) {
        console.warn("Could not load profiles for admin withdrawals:", profErr);
      }
    }
    return rawList;
  } catch (err: any) {
    console.warn("adminGetWithdrawals error:", err);
    return getLocal<AdminWithdrawal[]>("cv_withdrawals", []);
  }
}

export async function adminUpdateWithdrawalStatus(
  id: string,
  status: 'completed' | 'rejected'
): Promise<void> {
  const { error } = await withTimeout(
    supabase
      .from('withdrawals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id),
    8000
  );
  if (error) throw error;
}

// ---- Support Ticket System ----------------------------------------

export interface SupportTicket {
  id: string;
  user_id: string;
  user_email?: string;
  subject: string;
  status: 'open' | 'in_progress' | 'closed';
  created_at: string;
  updated_at: string;
  latest_message?: string;
  message_count?: number;
}

export interface SupportMessage {
  id: string;
  ticket_id: string;
  sender_id: string;
  message: string;
  is_admin: boolean;
  created_at: string;
}

/** Customer creates a new support ticket (first message included) */
export async function createSupportTicket(
  userId: string,
  userEmail: string,
  subject: string,
  firstMessage: string
): Promise<SupportTicket> {
  const { data: ticket, error: ticketError } = await withTimeout(
    supabase
      .from('support_tickets')
      .insert({ user_id: userId, user_email: userEmail, subject })
      .select()
      .single(),
    8000
  );
  if (ticketError) throw ticketError;

  const { error: msgError } = await withTimeout(
    supabase.from('support_messages').insert({
      ticket_id: ticket.id,
      sender_id: userId,
      message: firstMessage,
      is_admin: false,
    }),
    8000
  );
  if (msgError) throw msgError;

  return ticket as SupportTicket;
}

/** Customer: get own tickets */
export async function getUserSupportTickets(userId: string): Promise<SupportTicket[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
    8000
  );
  if (error) throw error;
  return (data ?? []) as SupportTicket[];
}

/** Get all messages for a ticket thread */
export async function getSupportTicketMessages(ticketId: string): Promise<SupportMessage[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('support_messages')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true }),
    8000
  );
  if (error) throw error;
  return (data ?? []) as SupportMessage[];
}

/** Post a new reply to a ticket thread */
export async function sendSupportMessage(
  ticketId: string,
  senderId: string,
  message: string,
  isAdmin: boolean
): Promise<void> {
  const { error: msgError } = await withTimeout(
    supabase.from('support_messages').insert({
      ticket_id: ticketId,
      sender_id: senderId,
      message,
      is_admin: isAdmin,
    }),
    8000
  );
  if (msgError) throw msgError;

  // Bump the updated_at on the ticket
  const { error: ticketError } = await withTimeout(
    supabase
      .from('support_tickets')
      .update({ updated_at: new Date().toISOString(), ...(isAdmin ? { status: 'in_progress' } : {}) })
      .eq('id', ticketId),
    8000
  );
  if (ticketError) throw ticketError;
}

/** Admin: get all tickets with user info */
export async function adminGetAllSupportTickets(): Promise<SupportTicket[]> {
  const { data, error } = await withTimeout(
    supabase
      .from('support_tickets')
      .select('*')
      .order('updated_at', { ascending: false }),
    8000
  );
  if (error) throw error;
  return (data ?? []) as SupportTicket[];
}

/** Admin: update ticket status */
export async function adminUpdateTicketStatus(
  ticketId: string,
  status: 'open' | 'in_progress' | 'closed'
): Promise<void> {
  const { error } = await withTimeout(
    supabase
      .from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', ticketId),
    8000
  );
  if (error) throw error;
}
