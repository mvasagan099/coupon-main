// @ts-nocheck
// HIGH-03: Use shared CORS module — no wildcard origins
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

async function getPayPalAccessToken(clientId: string, secret: string, baseUrl: string): Promise<string> {
  const credentials = btoa(`${clientId}:${secret}`);
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PayPal Auth failed: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Verify JWT caller
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!jwt) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authError } = await supabaseUserClient.auth.getUser();
  if (authError || !user) {
    return jsonResponse({ error: "Invalid or expired session" }, 401);
  }

  try {
    const paypalClientId = Deno.env.get("PAYPAL_CLIENT_ID") ?? "";
    const paypalSecret = Deno.env.get("PAYPAL_SECRET") ?? "";
    const paypalMode = Deno.env.get("PAYPAL_MODE") ?? "sandbox";

    if (!paypalClientId || !paypalSecret) {
      return jsonResponse(
        {
          error:
            "Missing PayPal server credentials. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET in Supabase Edge Function secrets.",
        },
        500,
      );
    }

    const paypalBaseUrl = paypalMode === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400);
    }

    const { order_id } = body as {
      order_id?: unknown;
    };

    if (typeof order_id !== "string" || !order_id) {
      return jsonResponse({ error: "order_id is required." }, 400);
    }

    // Get the Access Token
    let accessToken: string;
    try {
      accessToken = await getPayPalAccessToken(paypalClientId, paypalSecret, paypalBaseUrl);
    } catch (err: any) {
      return jsonResponse({ error: err.message || "Failed to authenticate with PayPal." }, 500);
    }

    // Capture the Order on PayPal
    const response = await fetch(`${paypalBaseUrl}/v2/checkout/orders/${order_id}/capture`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    const payload = await response.json();

    if (!response.ok) {
      return jsonResponse(
        {
          verified: false,
          error: payload?.message || "Failed to capture PayPal order.",
          details: payload,
        },
        response.status,
      );
    }

    const isCompleted = payload.status === "COMPLETED";

    if (isCompleted) {
      // Extract authoritative captured amount from PayPal response
      const captureObj = payload.purchase_units?.[0]?.payments?.captures?.[0];
      const rawAmount = captureObj?.amount?.value || payload.purchase_units?.[0]?.amount?.value || "0";
      const capturedAmount = parseFloat(rawAmount);

      if (capturedAmount > 0 && supabaseServiceKey) {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        // Securely credit wallet via add_funds_secure (service_role only)
        const { error: creditError } = await supabaseAdmin.rpc("add_funds_secure", {
          p_user_id: user.id,
          p_amount: capturedAmount,
        });

        if (creditError) {
          console.error("Failed to credit wallet:", creditError);
        } else {
          // Record deposit audit entry
          await supabaseAdmin.from("deposits").insert({
            user_id: user.id,
            amount: capturedAmount,
            payment_method: "PayPal",
            reference_id: order_id,
            status: "completed",
            created_at: new Date().toISOString(),
          });
        }
      }

      return jsonResponse(
        {
          verified: true,
          amount: capturedAmount,
          status: payload.status,
          details: payload,
        },
        200,
      );
    }

    return jsonResponse(
      {
        verified: false,
        status: payload.status,
        details: payload,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ verified: false, error: message }, 500);
  }
});
