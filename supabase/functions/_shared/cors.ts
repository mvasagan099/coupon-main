/**
 * Shared CORS headers for all CouponVault Supabase Edge Functions
 *
 * HIGH-03 Security fix:
 * All Edge Functions previously used "Access-Control-Allow-Origin": "*" (wildcard),
 * which allows ANY website to trigger these functions from a user's browser,
 * enabling CSRF-style cross-origin attacks on authenticated users.
 *
 * The ALLOWED_ORIGIN environment variable must be set in the Supabase Edge Function
 * environment (Dashboard → Edge Functions → Secrets) to your production domain,
 * e.g. "https://couponvault.app"
 *
 * For local development, set ALLOWED_ORIGIN="http://localhost:5173" or
 * "http://localhost:5174" in your .env.local file.
 */

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN") || "https://couponvault.app";

export const corsHeaders: Record<string, string> = {
  // HIGH-03: Restrict to known origin, not wildcard
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // Vary: Origin tells caches not to serve the same CORS response to all origins
  "Vary": "Origin",
};

/**
 * Standard preflight (OPTIONS) response handler.
 * Call this at the top of every Edge Function handler:
 *
 *   if (req.method === "OPTIONS") {
 *     return new Response("ok", { headers: corsHeaders });
 *   }
 */
export function handleCorsPreflightRequest(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }
  return null;
}
