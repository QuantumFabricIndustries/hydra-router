// ─── Base Adapter Interface ───────────────────────────────────────────────────

import { ChatCompletionRequest, ChatMessage } from '../types';

export interface AdapterResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  finishReason: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  model?: string;
}

export abstract class BaseAdapter {
  abstract readonly provider: string;

  abstract complete(
    model: string,
    req: ChatCompletionRequest,
  ): Promise<AdapterResponse>;

  abstract stream(
    model: string,
    req: ChatCompletionRequest,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<{ promptTokens: number; completionTokens: number }>;

  protected buildMessages(req: ChatCompletionRequest): ChatMessage[] {
    return req.messages;
  }
}
