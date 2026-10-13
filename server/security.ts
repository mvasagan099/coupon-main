import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Verify with the project's Auth server, then check the persisted account lock. */
export function userAuthentication(client: SupabaseClient): RequestHandler {
  return async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, message: 'Authentication required.' });
      return;
    }
    const token = authorization.slice(7).trim();
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user || data.user.is_anonymous) {
        res.status(401).json({ success: false, message: 'Invalid or expired session.' });
        return;
      }
      const { data: active, error: accountError } = await client.rpc('is_account_active', {
        p_user_id: data.user.id,
      });
      if (accountError) throw accountError;
      if (!active) {
        res.status(403).json({ success: false, message: 'This account is locked.' });
        return;
      }
      res.locals.userId = data.user.id;
      res.locals.userToken = token;
      next();
    } catch {
      res.status(503).json({ success: false, message: 'Unable to verify your session. Please retry.' });
    }
  };
}
