// ─── Complexity Classifier ────────────────────────────────────────────────────
// Scores 0–100 based on linguistic and structural signals.
// No external calls — pure heuristic, runs in <1ms.

import { ChatMessage, ClassifiedRequest } from '../types';

const CODE_PATTERNS = [
  /```[\s\S]*?```/g,
  /\b(function|class|interface|async|await|import|export|const|let|var)\b/g,
  /\b(algorithm|implement|debug|refactor|optimize|architecture)\b/gi,
];

const REASONING_KEYWORDS = [
  'explain', 'analyze', 'compare', 'evaluate', 'critique', 'design',
  'why', 'how does', 'tradeoff', 'pros and cons', 'difference between',
  'step by step', 'comprehensive', 'detailed', 'in depth', 'thorough',
  'research', 'strategy', 'plan', 'complex', 'nuanced',
];

const SIMPLE_KEYWORDS = [
  'translate', 'summarize', 'list', 'what is', 'define', 'spell',
  'hello', 'hi', 'thanks', 'yes', 'no', 'ok', 'sure',
  'convert', 'format', 'extract', 'find', 'search',
];

const DOMAIN_TAGS: Record<string, string[]> = {
  code: ['function', 'class', 'bug', 'error', 'compile', 'runtime', 'debug', 'typescript', 'python', 'rust', 'javascript'],
  math: ['equation', 'calculate', 'solve', 'integral', 'derivative', 'proof', 'theorem', 'formula'],
  creative: ['write', 'story', 'poem', 'creative', 'fiction', 'narrative', 'character', 'plot'],
  analysis: ['analyze', 'evaluate', 'assess', 'review', 'audit', 'critique', 'compare'],
  factual: ['what is', 'who is', 'when did', 'where is', 'define', 'explain what'],
};

function countTokensApprox(text: string): number {
  // ~4 chars per token for English
  return Math.ceil(text.length / 4);
}

function extractText(messages: ChatMessage[]): string {
  return messages
    .map(m => (typeof m.content === 'string' ? m.content : ''))
    .join('\n');
}

function detectTags(text: string): string[] {
  const lower = text.toLowerCase();
  const tags: string[] = [];
  for (const [tag, keywords] of Object.entries(DOMAIN_TAGS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      tags.push(tag);
    }
  }
  return tags;
}

function detectKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  return [...REASONING_KEYWORDS, ...SIMPLE_KEYWORDS].filter(kw => lower.includes(kw));
}

export function classify(messages: ChatMessage[]): ClassifiedRequest {
  const text = extractText(messages);
  const lower = text.toLowerCase();
  const tokens = countTokensApprox(text);

  let score = 0;

  // ── Length signal (0–20 pts) ──────────────────────────────────────────────
  if (tokens > 2000) score += 20;
  else if (tokens > 500) score += 10;
  else if (tokens > 100) score += 5;

  // ── Code presence (0–20 pts) ──────────────────────────────────────────────
  const hasCodeBlock = /```/.test(text);
  const hasInlineCode = /`[^`]+`/.test(text);
  const codeKeywordMatches = CODE_PATTERNS[1].exec(lower);
  if (hasCodeBlock) score += 20;
  else if (hasInlineCode || codeKeywordMatches) score += 10;

  // ── Reasoning keywords (0–25 pts) ─────────────────────────────────────────
  const reasoningMatches = REASONING_KEYWORDS.filter(kw => lower.includes(kw));
  score += Math.min(reasoningMatches.length * 5, 25);

  // ── Simple keywords (penalty, 0–15 pts off) ───────────────────────────────
  const simpleMatches = SIMPLE_KEYWORDS.filter(kw => lower.includes(kw));
  score -= Math.min(simpleMatches.length * 5, 15);

  // ── Multi-turn depth (0–15 pts) ───────────────────────────────────────────
  const userTurns = messages.filter(m => m.role === 'user').length;
  if (userTurns >= 5) score += 15;
  else if (userTurns >= 3) score += 8;
  else if (userTurns >= 2) score += 3;

  // ── Sentence complexity (0–10 pts) ────────────────────────────────────────
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const avgSentenceLen = sentences.length > 0
    ? sentences.reduce((a, s) => a + s.split(' ').length, 0) / sentences.length
    : 0;
  if (avgSentenceLen > 25) score += 10;
  else if (avgSentenceLen > 15) score += 5;

  // ── Question count (0–10 pts) ─────────────────────────────────────────────
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount >= 3) score += 10;
  else if (questionCount >= 2) score += 5;

  // Clamp 0–100
  score = Math.max(0, Math.min(100, score));

  return {
    complexity: score,
    estimatedTokens: tokens,
    tags: detectTags(text),
    keywords: detectKeywords(text),
  };
}
