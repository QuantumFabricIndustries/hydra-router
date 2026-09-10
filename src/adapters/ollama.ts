// ─── Ollama (Local) Adapter ───────────────────────────────────────────────────
// Ollama also exposes an OpenAI-compatible API on localhost.

import OpenAI from 'openai';
import { ChatCompletionRequest } from '../types';
import { BaseAdapter, AdapterResponse, StreamChunk } from './base';

export class OllamaAdapter extends BaseAdapter {
  readonly provider = 'ollama';
  private client: OpenAI;

  constructor() {
    super();
    this.client = new OpenAI({
      apiKey: 'ollama', // required but unused by Ollama
      baseURL: process.env.OLLAMA_BASE_URL
        ? `${process.env.OLLAMA_BASE_URL}/v1`
        : 'http://localhost:11434/v1',
    });
  }

  async complete(model: string, req: ChatCompletionRequest): Promise<AdapterResponse> {
    const response = await this.client.chat.completions.create({
      model,
      messages: req.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      stream: false,
    });

    const choice = response.choices[0];
    return {
      content: choice.message.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model,
      finishReason: choice.finish_reason ?? 'stop',
    };
  }

  async stream(
    model: string,
    req: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<{ promptTokens: number; completionTokens: number }> {
    const stream = await this.client.chat.completions.create({
      model,
      messages: req.messages as OpenAI.ChatCompletionMessageParam[],
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      stream: true,
    });

    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        onChunk({ delta, done: false, model });
      }
      if (chunk.usage) {
        promptTokens = chunk.usage.prompt_tokens;
        completionTokens = chunk.usage.completion_tokens;
      }
    }

    onChunk({ delta: '', done: true });
    return { promptTokens, completionTokens };
  }
}
