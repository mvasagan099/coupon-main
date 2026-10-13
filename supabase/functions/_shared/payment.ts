import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.5';
import { corsHeaders } from './cors.ts';

export function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}
export async function clients(req: Request) {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !secret) throw new Error('Server configuration is incomplete.');
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Authentication required.');
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) throw new Error('Authentication required.');
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  const { data: active, error: accountError } = await admin.rpc('is_account_active', { p_user_id: data.user.id });
  if (accountError) throw new Error('Unable to verify account access.');
  if (!active) throw new Error('Account is locked.');
  return { user: data.user, userClient, admin };
}
export function failure(req: Request, error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  const status = message === 'Authentication required.' ? 401 : message === 'Account is locked.' ? 403 : 400;
  return json(req, { verified: false, error: message }, status);
}
export async function paypal(path: string, method = 'GET', body?: unknown, requestId?: string) {
  const id = Deno.env.get('PAYPAL_CLIENT_ID');
  const secret = Deno.env.get('PAYPAL_SECRET');
  if (!id || !secret) throw new Error('PayPal server credentials are not configured.');
  const base = Deno.env.get('PAYPAL_MODE') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials', signal: AbortSignal.timeout(10000),
  });
  if (!tokenResponse.ok) throw new Error('PayPal authentication is unavailable.');
  const token = await tokenResponse.json();
  const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json',
      ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('PayPal could not confirm this order. Retry verification; do not pay again.');
  return response.json();
}
