import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

export type ExternalApplication = 'gaming' | 'lottery';

export interface ApplicationAuthOptions {
  gamingKey?: string;
  lotteryKey?: string;
  fallbackKey?: string;
  allowedApps?: ExternalApplication[];
}

/**
 * Validates calling application credentials using constant-time comparison.
 * Binds the verified application name strictly to res.locals.callingApp.
 * NEVER trusts any caller-supplied application parameter from request body or headers.
 */
export function applicationAuthentication(options: ApplicationAuthOptions = {}): RequestHandler {
  return (req, res, next) => {
    let rawKey = req.headers['x-api-key'];
    if (!rawKey && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
      rawKey = req.headers.authorization.slice(7).trim();
    }
    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const gamingKey = options.gamingKey ?? process.env.GAMING_API_KEY;
    const lotteryKey = options.lotteryKey ?? process.env.LOTTERY_API_KEY;
    const fallbackKey = options.fallbackKey ?? process.env.API_KEY;

    const checkMatch = (secret?: string): boolean => {
      if (!secret || typeof secret !== 'string') return false;
      const keyBuf = Buffer.from(rawKey);
      const secretBuf = Buffer.from(secret);
      return keyBuf.length === secretBuf.length && timingSafeEqual(keyBuf, secretBuf);
    };

    let callingApp: ExternalApplication | null = null;
    if (gamingKey && checkMatch(gamingKey)) {
      callingApp = 'gaming';
    } else if (lotteryKey && checkMatch(lotteryKey)) {
      callingApp = 'lottery';
    } else if (!gamingKey && !lotteryKey && fallbackKey && checkMatch(fallbackKey)) {
      // If separate keys are not yet configured in env, fallback to 'gaming' for backward compatibility
      callingApp = 'gaming';
    }

    if (!callingApp) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    if (options.allowedApps && !options.allowedApps.includes(callingApp)) {
      res.status(403).json({ success: false, message: `Access denied for application: ${callingApp}` });
      return;
    }

    // Set verified identity from credentials ONLY — client-supplied application parameter is never trusted
    res.locals.callingApp = callingApp;
    next();
  };
}

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
