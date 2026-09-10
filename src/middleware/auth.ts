// ─── Auth Middleware ───────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const hydraKey = process.env.HYDRA_API_KEY;

  // If no key configured, allow all (dev mode)
  if (!hydraKey) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { message: 'Missing Authorization header', type: 'auth_error' } });
    return;
  }

  const key = authHeader.slice(7);
  if (key !== hydraKey) {
    res.status(401).json({ error: { message: 'Invalid API key', type: 'auth_error' } });
    return;
  }

  next();
}
