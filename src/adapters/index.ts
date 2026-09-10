// ─── Adapter Registry ─────────────────────────────────────────────────────────

import { ModelProvider } from '../types';
import { BaseAdapter } from './base';
import { AnthropicAdapter } from './anthropic';
import { OpenAIAdapter } from './openai';
import { GeminiAdapter } from './gemini';
import { OllamaAdapter } from './ollama';

export { BaseAdapter };

const registry: Partial<Record<ModelProvider, BaseAdapter>> = {};

export function getAdapter(provider: ModelProvider): BaseAdapter {
  if (!registry[provider]) {
    switch (provider) {
      case 'anthropic': registry[provider] = new AnthropicAdapter(); break;
      case 'openai':    registry[provider] = new OpenAIAdapter();    break;
      case 'gemini':    registry[provider] = new GeminiAdapter();    break;
      case 'ollama':    registry[provider] = new OllamaAdapter();    break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
  return registry[provider]!;
}
