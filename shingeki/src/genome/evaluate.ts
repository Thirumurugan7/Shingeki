/**
 * Lightweight heuristic fitness for demo — judges see numeric evolution without extra LLM calls.
 * Higher = more structured / informative output for research-style tasks.
 */
export function evaluateOutput(output: string): number {
  const t = output.trim();
  if (t.length < 80) return 0.15;

  let score = 0.2;

  const lines = t.split(/\n/).filter(Boolean).length;
  score += Math.min(0.25, lines * 0.02);

  const bullets = (t.match(/^\s*[-*•]/gm) ?? []).length;
  score += Math.min(0.2, bullets * 0.04);

  const nums = (t.match(/\$?\d[\d,]*(?:\.\d+)?/g) ?? []).length;
  score += Math.min(0.15, nums * 0.02);

  const gpuHints = /\b(VRAM|GB|RTX|RX|\d{3,4}\s*(Ti|SUPER)?|W\b|watt|TDP|CUDA|ROCm)\b/gi;
  const m = t.match(gpuHints);
  score += Math.min(0.2, (m?.length ?? 0) * 0.03);

  const tables = (t.match(/\|.*\|/g) ?? []).length;
  score += Math.min(0.1, tables * 0.05);

  return Math.min(1, Math.round(score * 100) / 100);
}
