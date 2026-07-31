// @ts-nocheck
// supabase/functions/redeem-coupon/index.ts
// Edge Function: Validate and redeem a coupon code on behalf of an authenticated user.
// SECURITY FIX (CRIT-08): Requires a valid Bearer JWT; verifies coupon ownership before redeeming.
// Deploy: supabase functions deploy redeem-coupon

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Restrict CORS to known origins — never use wildcard for authenticated endpoints
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map(o => o.trim()).filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? "");
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    // ── CRIT-08: Authenticate the caller ─────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const userToken = authHeader.replace("Bearer ", "").trim();

    // Supabase client scoped to the authenticated user
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${userToken}` } },
      },
    );

    // Verify the JWT and get the calling user
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // ── Parse & validate input ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { coupon_code, amount } = body as { coupon_code?: unknown; amount?: unknown };

    if (!coupon_code || typeof coupon_code !== "string" || !coupon_code.trim()) {
      return new Response(
        JSON.stringify({ error: "coupon_code is required" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const redeemAmount = amount !== undefined ? parseFloat(String(amount)) : null;
    if (redeemAmount !== null && (isNaN(redeemAmount) || redeemAmount <= 0 || redeemAmount > 1_000_000)) {
      return new Response(
        JSON.stringify({ error: "Invalid amount" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // Service-role client for privileged operations
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // ── Lookup coupon ─────────────────────────────────────────────────────────
    const { data: coupon, error: lookupError } = await supabaseAdmin
      .from("coupons")
      .select("id, code, is_used, status, remaining_balance, user_id")
      .eq("code", coupon_code.trim().toUpperCase())
      .maybeSingle();

    if (lookupError || !coupon) {
      return new Response(
        JSON.stringify({ error: "Coupon not found" }),
        { status: 404, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // ── CRIT-08: Ownership check ──────────────────────────────────────────────
    if (coupon.user_id && coupon.user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    if (coupon.is_used || coupon.status === "redeemed") {
      return new Response(
        JSON.stringify({ error: "Coupon already fully redeemed" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const amountToRedeem = redeemAmount !== null ? redeemAmount : coupon.remaining_balance;

    if (amountToRedeem <= 0 || amountToRedeem > coupon.remaining_balance) {
      return new Response(
        JSON.stringify({ error: "Invalid redeem amount" }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    // ── Redeem ────────────────────────────────────────────────────────────────
    const { data: redeemResult, error: redeemError } = await supabaseAdmin
      .rpc("redeem_coupon_amount", {
        p_coupon_id: coupon.id,
        p_amount: amountToRedeem,
      });

    if (redeemError) {
      return new Response(
        JSON.stringify({ error: redeemError.message }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    const resultRow = Array.isArray(redeemResult) ? redeemResult[0] : redeemResult;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Coupon redeemed successfully",
        redeemed_amount: amountToRedeem,
        remaining_balance: resultRow?.remaining_balance ?? 0,
        status: resultRow?.status ?? "redeemed",
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("redeem-coupon error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
