// ─── Anthropic / Claude Adapter ───────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { ChatCompletionRequest } from '../types';
import { BaseAdapter, AdapterResponse, StreamChunk } from './base';

export class AnthropicAdapter extends BaseAdapter {
  readonly provider = 'anthropic';
  private client: Anthropic;

  constructor() {
    super();
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(model: string, req: ChatCompletionRequest): Promise<AdapterResponse> {
    const systemMsg = req.messages.find(m => m.role === 'system');
    const userMessages = req.messages.filter(m => m.role !== 'system');

    const response = await this.client.messages.create({
      model,
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature,
      system: systemMsg?.content ?? undefined,
      messages: userMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content ?? '',
      })),
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    return {
      content,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      model: response.model,
      finishReason: response.stop_reason ?? 'stop',
    };
  }

  async stream(
    model: string,
    req: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<{ promptTokens: number; completionTokens: number }> {
    const systemMsg = req.messages.find(m => m.role === 'system');
    const userMessages = req.messages.filter(m => m.role !== 'system');

    let promptTokens = 0;
    let completionTokens = 0;

    const stream = await this.client.messages.create({
      model,
      max_tokens: req.max_tokens ?? 4096,
      temperature: req.temperature,
      system: systemMsg?.content ?? undefined,
      messages: userMessages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content ?? '',
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onChunk({ delta: event.delta.text, done: false, model });
      }
      if (event.type === 'message_delta' && event.usage) {
        completionTokens = event.usage.output_tokens;
      }
      if (event.type === 'message_start' && event.message.usage) {
        promptTokens = event.message.usage.input_tokens;
      }
    }

    onChunk({ delta: '', done: true });
    return { promptTokens, completionTokens };
  }
}
