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
      // BUG 1 FIX: track whether any content chunks have been sent to the client.
      // If a stream failure happens after content has been flushed, we cannot
      // silently switch to a fallback — that would splice two responses together.
      let contentChunksSent = 0;
      // BUG 3 FIX: track the model that actually served the request for accurate pricing.
      let actualModel = model;
      let actualModelAlias = modelAlias;
      let actualRule = decision.rule;
      // BUG 2 FIX: track whether the response ended in an error.
      let streamSuccess = false;

      try {
        const usage = await adapter.stream(model.model, body, (chunk) => {
          if (chunk.done) {
            // Final chunk — send [DONE]
            res.write('data: [DONE]\n\n');
            return;
          }

          contentChunksSent++;
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
        streamSuccess = true;
      } catch (err: unknown) {
        // BUG 1 FIX: Only attempt fallback if no content has been sent yet.
        // If content was already flushed, splicing a fallback response would
        // corrupt the client's view — send an error event instead.
        if (contentChunksSent > 0) {
          // Content already sent — cannot retry cleanly; signal error and close.
          res.write(`data: ${JSON.stringify({ error: { message: (err as Error).message, type: 'stream_error' } })}\n\n`);
          res.write('data: [DONE]\n\n');
        } else {
          // No content sent yet — safe to try fallback transparently.
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
              // BUG 3 FIX: use fallback model for pricing
              actualModel = fallbackModel;
              actualModelAlias = 'fallback';
              actualRule = `${decision.rule}:fallback`;
              streamSuccess = true;
            } catch (fallbackErr) {
              // BUG 2 FIX: send a proper SSE error event and [DONE] before ending
              res.write(`data: ${JSON.stringify({ error: { message: (fallbackErr as Error).message, type: 'provider_error' } })}\n\n`);
              res.write('data: [DONE]\n\n');
            }
          } else {
            // BUG 2 FIX: send a proper SSE error event and [DONE] before ending
            res.write(`data: ${JSON.stringify({ error: { message: (err as Error).message, type: 'provider_error' } })}\n\n`);
            res.write('data: [DONE]\n\n');
          }
        }
      }

      // BUG 3 FIX: price against the model that actually served the request.
      // BUG 2 FIX: record accurate success/failure status.
      const costUSD = tracker.calcCost(actualModel, promptTokens, completionTokens);
      tracker.record({
        requestId,
        rule: actualRule,
        modelAlias: actualModelAlias,
        provider: actualModel.provider,
        model: actualModel.model,
        promptTokens,
        completionTokens,
        costUSD,
        latencyMs: Date.now() - start,
        success: streamSuccess,
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
