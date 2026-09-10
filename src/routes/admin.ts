// ─── Admin API Routes ─────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { HydraRouter } from '../router';
import { tracker } from '../tracker';

export function buildAdminRouter(hydra: HydraRouter): Router {
  const router = Router();

  /** GET /hydra/stats — cost + usage summary */
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(tracker.getStats());
  });

  /** GET /hydra/logs — recent routing decisions */
  router.get('/logs', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(tracker.getRecords(limit));
  });

  /** GET /hydra/config — current routing config */
  router.get('/config', (_req: Request, res: Response) => {
    res.json(hydra.getConfig());
  });

  /** POST /hydra/config/reload — hot-reload routing.json */
  router.post('/config/reload', (_req: Request, res: Response) => {
    try {
      hydra.reload();
      res.json({ ok: true, message: 'Config reloaded' });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  /** POST /hydra/classify — dry-run: classify a request without sending it */
  router.post('/classify', (req: Request, res: Response) => {
    try {
      const decision = hydra.decide(req.body);
      res.json({
        routing: {
          rule: decision.rule,
          modelAlias: decision.modelAlias,
          model: decision.model.model,
          provider: decision.model.provider,
          reasoning: decision.reasoning,
        },
        classified: decision.classified,
        estimatedCost: {
          min: parseFloat((decision.model.costPerMInputTokens * decision.classified.estimatedTokens / 1_000_000).toFixed(6)),
          note: 'Input tokens only — completion cost depends on response length',
        },
      });
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /** GET /hydra/models — list configured models */
  router.get('/models', (_req: Request, res: Response) => {
    const config = hydra.getConfig();
    res.json({
      models: config.models,
      defaultModel: config.defaultModel,
    });
  });

  return router;
}
