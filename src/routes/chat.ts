// ─── /v1/chat/completions — OpenAI-compatible endpoint ───────────────────────

import { Router, Request, Response } from 'express';
import { HydraRouter } from '../router';
import { getAdapter } from '../adapters';
import { tracker } from '../tracker';
import { ChatCompletionRequest } from '../types';

export function buildChatRouter(hydra: HydraRouter): Router {
  const router = Router();

  router.post('/chat/completions', async (req: Request, res: Response) => {
    const body = req.body as ChatCompletionRequest;
    const requestId = tracker.newRequestId();
    const start = Date.now();

    // ── Route the request ─────────────────────────────────────────────────
    let decision;
    try {
      decision = hydra.decide(body);
    } catch (err: unknown) {
      res.status(400).json({ error: { message: (err as Error).message, type: 'routing_error' } });
      return;
    }

    const { model, modelAlias } = decision;
    const adapter = getAdapter(model.provider);

    // ── Stream path ───────────────────────────────────────────────────────
    if (body.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Hydra-Rule', decision.rule);
      res.setHeader('X-Hydra-Model', modelAlias);

      // Send routing metadata as first SSE comment
      res.write(`: hydra-routing rule=${decision.rule} model=${modelAlias}\n\n`);

      let completionTokens = 0;
      let promptTokens = 0;

      try {
        const usage = await adapter.stream(model.model, body, (chunk) => {
          if (chunk.done) {
            // Final chunk — send [DONE]
            res.write('data: [DONE]\n\n');
            return;
          }

          const ssePayload = {
            id: requestId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: model.model,
            choices: [{
              index: 0,
              delta: { content: chunk.delta },
              finish_reason: null,
            }],
            // HYDRA extension
            hydra: { rule: decision.rule, modelAlias },
          };
          res.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
        });

        promptTokens = usage.promptTokens;
        completionTokens = usage.completionTokens;
      } catch (err: unknown) {
        // Try fallback
        const fallbackModel = hydra.getFallback(decision);
        if (fallbackModel) {
          const fallbackAdapter = getAdapter(fallbackModel.provider);
          try {
            const usage = await fallbackAdapter.stream(fallbackModel.model, body, (chunk) => {
              if (chunk.done) { res.write('data: [DONE]\n\n'); return; }
              const ssePayload = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: fallbackModel.model,
                choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null }],
                hydra: { rule: `${decision.rule}:fallback`, modelAlias: 'fallback' },
              };
              res.write(`data: ${JSON.stringify(ssePayload)}\n\n`);
            });
            promptTokens = usage.promptTokens;
            completionTokens = usage.completionTokens;
          } catch (fallbackErr) {
            res.write(`data: ${JSON.stringify({ error: (fallbackErr as Error).message })}\n\n`);
          }
        } else {
          res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
        }
      }

      const costUSD = tracker.calcCost(model, promptTokens, completionTokens);
      tracker.record({
        requestId,
        rule: decision.rule,
        modelAlias,
        provider: model.provider,
        model: model.model,
        promptTokens,
        completionTokens,
        costUSD,
        latencyMs: Date.now() - start,
        success: true,
      });

      res.end();
      return;
    }

    // ── Non-stream path ───────────────────────────────────────────────────
    try {
      const result = await adapter.complete(model.model, body);
      const costUSD = tracker.calcCost(model, result.promptTokens, result.completionTokens);

      tracker.record({
        requestId,
        rule: decision.rule,
        modelAlias,
        provider: model.provider,
        model: model.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        costUSD,
        latencyMs: Date.now() - start,
        success: true,
      });

      res.json({
        id: requestId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: result.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: result.finishReason,
        }],
        usage: {
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          total_tokens: result.promptTokens + result.completionTokens,
        },
        // HYDRA routing metadata
        hydra: {
          rule: decision.rule,
          modelAlias,
          reasoning: decision.reasoning,
          classified: decision.classified,
          costUSD: parseFloat(costUSD.toFixed(6)),
        },
      });
    } catch (err: unknown) {
      // Try fallback
      const fallbackModel = hydra.getFallback(decision);
      if (fallbackModel) {
        try {
          const fallbackAdapter = getAdapter(fallbackModel.provider);
          const result = await fallbackAdapter.complete(fallbackModel.model, body);
          const costUSD = tracker.calcCost(fallbackModel, result.promptTokens, result.completionTokens);

          tracker.record({
            requestId,
            rule: `${decision.rule}:fallback`,
            modelAlias: 'fallback',
            provider: fallbackModel.provider,
            model: fallbackModel.model,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            costUSD,
            latencyMs: Date.now() - start,
            success: true,
          });

          res.json({
            id: requestId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: result.model,
            choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: result.finishReason }],
            usage: { prompt_tokens: result.promptTokens, completion_tokens: result.completionTokens, total_tokens: result.promptTokens + result.completionTokens },
            hydra: { rule: `${decision.rule}:fallback`, modelAlias: 'fallback', costUSD: parseFloat(costUSD.toFixed(6)) },
          });
          return;
        } catch (fallbackErr) {
          // Fall through to error
        }
      }

      tracker.record({
        requestId,
        rule: decision.rule,
        modelAlias,
        provider: model.provider,
        model: model.model,
        promptTokens: 0,
        completionTokens: 0,
        costUSD: 0,
        latencyMs: Date.now() - start,
        success: false,
        error: (err as Error).message,
      });

      res.status(500).json({ error: { message: (err as Error).message, type: 'provider_error' } });
    }
  });

  return router;
}
