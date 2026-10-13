import { clients, failure, json } from '../_shared/payment.ts';
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(req, {});
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);
  try {
    const { user, userClient } = await clients(req);
    const { gift_card_id } = await req.json();
    if (typeof gift_card_id !== 'string') throw new Error('A gift_card_id is required.');
    const { data, error } = await userClient.rpc('issue_gift_card_coupon', {
      p_gift_card_id: gift_card_id, p_user_id: user.id, p_amount: 0,
    });
    if (error || !data?.[0]) throw new Error(error?.message ?? 'Purchase was not confirmed.');
    return json(req, data[0]);
  } catch (error) { return failure(req, error); }
});
