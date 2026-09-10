// ─── HYDRA Router — Core Decision Engine ─────────────────────────────────────

import fs from 'fs';
import path from 'path';
import {
  ChatCompletionRequest,
  ClassifiedRequest,
  ModelTarget,
  RoutingConfig,
  RoutingDecision,
  RuleCondition,
} from './types';
import { classify } from './classifiers/complexity';

export class HydraRouter {
  private config: RoutingConfig;

  constructor(configPath?: string) {
    const cfgPath = configPath
      || process.env.ROUTING_CONFIG
      || path.join(__dirname, '..', 'config', 'routing.json');
    this.config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }

  /** Reload config without restarting (for hot-reload) */
  reload(configPath?: string) {
    const cfgPath = configPath || process.env.ROUTING_CONFIG || path.join(__dirname, '..', 'config', 'routing.json');
    this.config = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  }

  getConfig(): RoutingConfig {
    return this.config;
  }

  /** Main entry: classify request, evaluate rules, return routing decision */
  decide(req: ChatCompletionRequest): RoutingDecision {
    // Force override from client
    if (req.hydra?.forceModel) {
      const model = this.config.models[req.hydra.forceModel];
      if (!model) throw new Error(`Unknown model alias: ${req.hydra.forceModel}`);
      return {
        rule: 'force-override',
        modelAlias: req.hydra.forceModel,
        model,
        reasoning: `Client forced model: ${req.hydra.forceModel}`,
        classified: classify(req.messages),
      };
    }

    const classified = classify(req.messages);

    // Inject client-provided tags
    if (req.hydra?.tags) {
      classified.tags.push(...req.hydra.tags);
    }

    // Evaluate rules by priority (ascending)
    const sortedRules = [...this.config.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      if (this.evaluateConditions(rule.conditions, classified, req)) {
        const modelAlias = rule.target;
        const model = this.config.models[modelAlias];
        if (!model) continue;

        return {
          rule: rule.name,
          modelAlias,
          model,
          reasoning: this.buildReasoning(rule.name, rule.conditions, classified),
          classified,
        };
      }
    }

    // Default
    const defaultAlias = this.config.defaultModel;
    const defaultModel = this.config.models[defaultAlias];
    return {
      rule: 'default',
      modelAlias: defaultAlias,
      model: defaultModel,
      reasoning: `No rule matched — using default model (${defaultAlias})`,
      classified,
    };
  }

  /** Get fallback model for a given decision */
  getFallback(decision: RoutingDecision): ModelTarget | null {
    const rule = this.config.rules.find(r => r.name === decision.rule);
    if (!rule?.fallback) return null;
    return this.config.models[rule.fallback] || null;
  }

  private evaluateConditions(
    conditions: RuleCondition[],
    classified: ClassifiedRequest,
    req: ChatCompletionRequest,
  ): boolean {
    return conditions.every(cond => this.evalCondition(cond, classified, req));
  }

  private evalCondition(
    cond: RuleCondition,
    classified: ClassifiedRequest,
    req: ChatCompletionRequest,
  ): boolean {
    let actual: number | string;

    switch (cond.field) {
      case 'complexity':
        actual = classified.complexity;
        break;
      case 'token_count':
        actual = classified.estimatedTokens;
        break;
      case 'tag':
        actual = classified.tags.join(' ');
        break;
      case 'keyword':
        actual = classified.keywords.join(' ');
        break;
      case 'cost_budget':
        actual = req.hydra?.costBudget ?? Infinity;
        break;
      default:
        return false;
    }

    const val = cond.value;

    switch (cond.operator) {
      case 'lt':  return (actual as number) < (val as number);
      case 'lte': return (actual as number) <= (val as number);
      case 'gt':  return (actual as number) > (val as number);
      case 'gte': return (actual as number) >= (val as number);
      case 'eq':  return actual === val;
      case 'contains':
        return typeof actual === 'string' && actual.includes(val as string);
      case 'not_contains':
        return typeof actual === 'string' && !actual.includes(val as string);
      default:
        return false;
    }
  }

  private buildReasoning(
    ruleName: string,
    conditions: RuleCondition[],
    classified: ClassifiedRequest,
  ): string {
    const condStr = conditions
      .map(c => `${c.field} ${c.operator} ${c.value}`)
      .join(' AND ');
    return `Rule "${ruleName}" matched [${condStr}] — complexity=${classified.complexity}, tokens≈${classified.estimatedTokens}, tags=[${classified.tags.join(',')}]`;
  }
}
