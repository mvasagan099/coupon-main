// @ts-nocheck
// HIGH-03: Use shared CORS module — no wildcard origins
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

    const { amount, currency = "USD", receipt, notes = {} } = body as {
      amount: unknown;
      currency?: string;
      receipt: unknown;
      notes?: Record<string, string>;
    };

    const amountNum = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return jsonResponse({ error: "Amount must be a positive number." }, 400);
    }

    if (!receipt || typeof receipt !== "string") {
      return jsonResponse({ error: "Receipt is required." }, 400);
    }

    // Get the Access Token
    let accessToken: string;
    try {
      accessToken = await getPayPalAccessToken(paypalClientId, paypalSecret, paypalBaseUrl);
    } catch (err: any) {
      return jsonResponse({ error: err.message || "Failed to authenticate with PayPal." }, 500);
    }

    // Create the Order on PayPal
    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: receipt,
          amount: {
            currency_code: currency,
            value: amountNum.toFixed(2),
          },
          custom_id: JSON.stringify(notes),
        },
      ],
    };

    const response = await fetch(`${paypalBaseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    const payload = await response.json();

    if (!response.ok) {
      return jsonResponse(
        {
          error: payload?.message || "Failed to create PayPal order.",
          details: payload,
        },
        response.status,
      );
    }

    return jsonResponse(
      {
        id: payload.id,
        amount: amountNum,
        currency,
        receipt,
        status: payload.status,
        client_id: paypalClientId,
      },
      200,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
});
