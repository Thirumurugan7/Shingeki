/**
 * Two-path fitness evaluator.
 *
 * Path A (heuristic, synchronous): fast structural signals — used for parallel-leg
 *   competition scoring and as a pre-filter gate.
 *
 * Path B (verifiable, async): LLM judge via 0G Router with verify_tee: true —
 *   triggered only when heuristic score < threshold, so the extra call is rare.
 */
import type { EvaluationResult } from '../types.js';

const JUDGE_SYSTEM = `You are an evaluation judge. Score the following agent response from 0.0 to 1.0 based on: accuracy, completeness, structure, and relevance to the task. Return ONLY a JSON object: { "score": number, "reason": string }`;

/** Synchronous heuristic scorer — no LLM call, used for competition ranking. */
export function heuristicScore(output: string): number {
  const t = output.trim();
  if (t.length < 80) return 0.15;

  let score = 0.2;

  const lines = t.split(/\n/).filter(Boolean).length;
  score += Math.min(0.25, lines * 0.02);

  const bullets = (t.match(/^\s*[-*•]/gm) ?? []).length;
  score += Math.min(0.2, bullets * 0.04);

  const nums = (t.match(/\$?\d[\d,]*(?:\.\d+)?/g) ?? []).length;
  score += Math.min(0.15, nums * 0.02);

  const domainHints = /\b(VRAM|GB|RTX|RX|TDP|CUDA|ROCm|watt|ETH|USDC|USD|swap|liquidity|gas|gwei|APY|route|flight|hotel|budget|itinerary|yen|schedule)\b|\$\d|\d+%/gi;
  const m = t.match(domainHints);
  score += Math.min(0.2, (m?.length ?? 0) * 0.03);

  const tables = (t.match(/\|.*\|/g) ?? []).length;
  score += Math.min(0.1, tables * 0.05);

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Two-path evaluator.
 *
 * Fast path: heuristic ≥ threshold → return immediately (no network call).
 * Slow path: heuristic < threshold → LLM judge with verify_tee.
 *
 * Falls back to heuristic on any LLM / parse failure so the evolution loop is never blocked.
 */
export async function evaluateOutput(
  output: string,
  taskContext = '',
  threshold = 0.55,
): Promise<EvaluationResult> {
  const quick = heuristicScore(output);

  if (quick >= threshold) {
    return { score: quick, path: 'heuristic' };
  }

  try {
    const { routerInfer } = await import('../og/compute-router.js');
    const userContent = taskContext
      ? `Task: ${taskContext.slice(0, 800)}\n\nAgent response:\n${output.slice(0, 3000)}`
      : `Agent response:\n${output.slice(0, 3000)}`;

    const result = await routerInfer(userContent, JUDGE_SYSTEM, {
      max_tokens: 128,
      temperature: 0,
      verify_tee: true,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*?\}/);
    const parsed = jsonMatch
      ? (JSON.parse(jsonMatch[0]) as { score?: unknown; reason?: unknown })
      : {};
    const score =
      typeof parsed.score === 'number' ? Math.min(1, Math.max(0, parsed.score)) : quick;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : undefined;
    const tee_verified =
      (result.trace as { tee_verified?: boolean } | undefined)?.tee_verified;

    return { score, reason, tee_verified, path: 'llm' };
  } catch {
    return { score: quick, path: 'heuristic' };
  }
}
