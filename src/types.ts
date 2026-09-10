// ─── HYDRA Core Types ────────────────────────────────────────────────────────

export type ModelProvider = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export interface ModelTarget {
  provider: ModelProvider;
  model: string;
  /** Cost per 1M input tokens in USD */
  costPerMInputTokens: number;
  /** Cost per 1M output tokens in USD */
  costPerMOutputTokens: number;
  /** Max context window in tokens */
  maxContextTokens: number;
  /** Typical latency class */
  latencyClass: 'fast' | 'medium' | 'slow';
}

export interface RoutingRule {
  name: string;
  priority: number; // lower = higher priority
  conditions: RuleCondition[];
  target: string; // model alias key
  fallback?: string; // model alias key if target fails
}

export interface RuleCondition {
  field: 'complexity' | 'token_count' | 'tag' | 'cost_budget' | 'keyword';
  operator: 'lt' | 'gt' | 'lte' | 'gte' | 'eq' | 'contains' | 'not_contains';
  value: string | number;
}

export interface RoutingConfig {
  models: Record<string, ModelTarget>;
  rules: RoutingRule[];
  defaultModel: string;
  /** Global max cost per request in USD (optional) */
  maxCostPerRequest?: number;
}

export interface ClassifiedRequest {
  complexity: number; // 0–100
  estimatedTokens: number;
  tags: string[];
  keywords: string[];
}

export interface RoutingDecision {
  rule: string | 'default';
  modelAlias: string;
  model: ModelTarget;
  reasoning: string;
  classified: ClassifiedRequest;
}

// OpenAI-compatible message format
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string | null;
  name?: string;
}

export interface ChatCompletionRequest {
  model: string; // ignored by HYDRA — we decide
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  user?: string;
  /** HYDRA extensions */
  hydra?: {
    tags?: string[];
    costBudget?: number; // max USD for this request
    forceModel?: string; // override routing
  };
}

export interface UsageRecord {
  timestamp: number;
  requestId: string;
  rule: string;
  modelAlias: string;
  provider: ModelProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUSD: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}
