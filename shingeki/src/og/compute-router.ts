/**
 * 0G Compute via Router — LLM + optional TEE verification (same path as scripts/9).
 * Loads parent .env when run from repo root, or shingeki/.env.
 */
import 'dotenv/config';

const MODEL = 'qwen/qwen-2.5-7b-instruct';

export interface InferOptions {
  max_tokens?: number;
  temperature?: number;
  verify_tee?: boolean;
}

export interface InferResult {
  text: string;
  latencyMs: number;
  trace?: Record<string, unknown>;
}

export async function routerInfer(userPrompt: string, systemPrompt?: string, opt: InferOptions = {}): Promise<InferResult> {
  const key = process.env.ROUTER_API_KEY;
  const base = process.env.ROUTER_BASE_URL?.replace(/\/$/, '') ?? 'https://router-api.0g.ai/v1';
  if (!key) throw new Error('ROUTER_API_KEY missing — fund Router on pc.0g.ai / pc.testnet.0g.ai');

  const messages =
    systemPrompt != null
      ? [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userPrompt },
        ]
      : [{ role: 'user' as const, content: userPrompt }];

  const t0 = Date.now();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: opt.max_tokens ?? 512,
      temperature: opt.temperature ?? 0.3,
      verify_tee: opt.verify_tee ?? true,
      provider: { sort: 'latency' },
    }),
  });

  const latencyMs = Date.now() - t0;
  const raw = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Router non-JSON (${res.status}): ${raw.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`Router ${res.status}: ${JSON.stringify(data)}`);

  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content ?? '';
  const trace = data.x_0g_trace as Record<string, unknown> | undefined;
  return { text, latencyMs, trace };
}
