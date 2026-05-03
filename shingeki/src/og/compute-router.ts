/**
 * 0G Compute via Router — LLM + optional TEE verification.
 * Production: bounded timeouts, retries on transient failures, circuit breaker.
 */
import 'dotenv/config';

import {
  routerMaxRetries,
  routerTimeoutMs,
} from '../config/runtime-config.js';
import { createLogger } from '../infra/logger.js';

const log = createLogger('compute-router');

const MODEL = 'qwen/qwen-2.5-7b-instruct';

export interface InferOptions {
  max_tokens?: number;
  temperature?: number;
  verify_tee?: boolean;
  /** Override the default model. Passed directly to the Router. */
  model?: string;
}

export interface InferResult {
  text: string;
  latencyMs: number;
  trace?: Record<string, unknown>;
}

/** Sliding failure window → brief open circuit to protect upstream */
let circuitFailures = 0;
let circuitOpenUntil = 0;
const CIRCUIT_THRESHOLD = 6;
const CIRCUIT_COOLDOWN_MS = 45_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function isTransientFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429') ||
    msg.includes('504') ||
    msg.includes('fetch failed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('AbortError') ||
    msg.includes('aborted')
  );
}

async function routerInferOnce(
  userPrompt: string,
  systemPrompt: string | undefined,
  opt: InferOptions,
): Promise<InferResult> {
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

  const timeoutMs = routerTimeoutMs();
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opt.model ?? MODEL,
        messages,
        max_tokens: opt.max_tokens ?? 512,
        temperature: opt.temperature ?? 0.3,
        verify_tee: opt.verify_tee ?? true,
        provider: { sort: 'latency' },
      }),
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer);
  }
}

export async function routerInfer(
  userPrompt: string,
  systemPrompt?: string,
  opt: InferOptions = {},
): Promise<InferResult> {
  if (Date.now() < circuitOpenUntil) {
    throw new Error(
      `Router circuit breaker open — retry after ${Math.ceil((circuitOpenUntil - Date.now()) / 1000)}s`,
    );
  }

  const maxRetries = routerMaxRetries();
  let last: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await routerInferOnce(userPrompt, systemPrompt, opt);
      circuitFailures = 0;
      return r;
    } catch (e: unknown) {
      last = e instanceof Error ? e : new Error(String(e));
      circuitFailures += 1;
      if (circuitFailures >= CIRCUIT_THRESHOLD) {
        circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        circuitFailures = 0;
        log.warn('router circuit opened', { cooldown_ms: CIRCUIT_COOLDOWN_MS });
      }
      const retry = attempt < maxRetries && isTransientFailure(last);
      log.warn('router request failed', {
        attempt: attempt + 1,
        retries_left: maxRetries - attempt,
        retry,
        err: last.message.slice(0, 200),
      });
      if (!retry) throw last;
      await sleep(400 * (attempt + 1));
    }
  }

  throw last ?? new Error('routerInfer failed');
}
