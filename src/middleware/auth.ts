// ─── Auth Middleware ───────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

/**
 * Load the set of valid API keys from environment variables.
 *
 * Priority:
 *  1. HYDRA_API_KEYS — comma-separated list of keys (supports multiple callers)
 *  2. HYDRA_API_KEY  — single key (backwards-compatible)
 *
 * If neither is set AND HYDRA_AUTH_DISABLED=true is explicitly set, auth is
 * bypassed (dev/test mode). Without that explicit opt-in, missing keys are
 * treated as a misconfiguration and all requests are rejected.
 */
function loadValidKeys(): Set<string> | null {
  const multi = process.env.HYDRA_API_KEYS;
  if (multi) {
    const keys = multi.split(',').map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) return new Set(keys);
  }
  const single = process.env.HYDRA_API_KEY;
  if (single?.trim()) return new Set([single.trim()]);
  return null; // No keys configured
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const validKeys = loadValidKeys();

  // BUG 4 FIX: require explicit opt-in to disable auth, not "no key = open".
  if (!validKeys) {
    if (process.env.HYDRA_AUTH_DISABLED === 'true') {
      next();
      return;
    }
    // Keys not configured and auth not explicitly disabled — reject.
    res.status(401).json({
      error: {
        message: 'Server is not configured with API keys. Set HYDRA_API_KEYS or HYDRA_AUTH_DISABLED=true.',
        type: 'auth_error',
      },
    });
    return;
  }

  // BUG 4 FIX: accept both Authorization: Bearer <key> and X-API-Key: <key>.
  let suppliedKey: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    suppliedKey = authHeader.slice(7).trim();
  } else {
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string') {
      suppliedKey = xApiKey.trim();
    }
  }

  if (!suppliedKey) {
    res.status(401).json({
      error: {
        message: 'Missing API key. Provide Authorization: Bearer <key> or X-API-Key: <key>.',
        type: 'auth_error',
      },
    });
    return;
  }

  // BUG 4 FIX: return 403 (forbidden) for a recognised-but-invalid key,
  // distinct from 401 (no credentials provided at all).
  if (!validKeys.has(suppliedKey)) {
    res.status(403).json({ error: { message: 'Invalid API key.', type: 'auth_error' } });
    return;
  }

  next();
}
