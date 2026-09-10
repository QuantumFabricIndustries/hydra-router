// ─── Cost Tracker + Usage Ledger ─────────────────────────────────────────────

import { UsageRecord, ModelTarget } from './types';
import { randomUUID } from 'crypto';

export class CostTracker {
  private records: UsageRecord[] = [];
  private maxRecords = 10000;

  newRequestId(): string {
    return randomUUID();
  }

  calcCost(model: ModelTarget, promptTokens: number, completionTokens: number): number {
    return (
      (promptTokens / 1_000_000) * model.costPerMInputTokens +
      (completionTokens / 1_000_000) * model.costPerMOutputTokens
    );
  }

  record(entry: Omit<UsageRecord, 'timestamp'>): UsageRecord {
    const record: UsageRecord = { ...entry, timestamp: Date.now() };
    this.records.unshift(record);
    // Trim oldest
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(0, this.maxRecords);
    }
    return record;
  }

  getRecords(limit = 100): UsageRecord[] {
    return this.records.slice(0, limit);
  }

  getStats() {
    const total = this.records.length;
    const totalCost = this.records.reduce((s, r) => s + r.costUSD, 0);
    const successCount = this.records.filter(r => r.success).length;

    const byModel: Record<string, { count: number; cost: number; tokens: number }> = {};
    for (const r of this.records) {
      if (!byModel[r.modelAlias]) byModel[r.modelAlias] = { count: 0, cost: 0, tokens: 0 };
      byModel[r.modelAlias].count++;
      byModel[r.modelAlias].cost += r.costUSD;
      byModel[r.modelAlias].tokens += r.promptTokens + r.completionTokens;
    }

    const byRule: Record<string, { count: number; cost: number }> = {};
    for (const r of this.records) {
      if (!byRule[r.rule]) byRule[r.rule] = { count: 0, cost: 0 };
      byRule[r.rule].count++;
      byRule[r.rule].cost += r.costUSD;
    }

    const avgLatency = total > 0
      ? this.records.reduce((s, r) => s + r.latencyMs, 0) / total
      : 0;

    return {
      totalRequests: total,
      successRate: total > 0 ? successCount / total : 1,
      totalCostUSD: totalCost,
      avgLatencyMs: Math.round(avgLatency),
      byModel,
      byRule,
    };
  }

  /** Estimate savings vs. always using the most expensive model */
  estimateSavings(expensiveAlias: string): number {
    const expensive = this.records.find(r => r.modelAlias === expensiveAlias);
    if (!expensive) return 0;
    // Rough: compare actual cost to hypothetical all-expensive cost
    const actualCost = this.records.reduce((s, r) => s + r.costUSD, 0);
    const hypotheticalCost = this.records.reduce((s, r) => {
      const ratio = expensive.costUSD / Math.max(r.costUSD, 0.000001);
      return s + r.costUSD * ratio;
    }, 0);
    return Math.max(0, hypotheticalCost - actualCost);
  }
}

export const tracker = new CostTracker();
