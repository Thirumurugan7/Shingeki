/**
 * Orchestrator WebSocket client — TASK_ASSIGN / STEP_RESULT with single routed listener.
 */
import WebSocket from 'ws';
import { encodeMessage, parseMessage, type NodeCapabilities } from './protocol.js';
import type { Genome } from '../genome/schema.js';
import type { StepResult } from '../types.js';
import type { StepExecutor } from '../orchestrator/orchestrator.js';
import { orchConnectRetries } from '../config/runtime-config.js';

export function hubUrlFromEnv(): string {
  const port = process.env.SHINGEKI_HUB_PORT ?? '8765';
  return process.env.SHINGEKI_HUB_URL ?? `ws://127.0.0.1:${port}`;
}

/** Include hub shared secret when SHINGEKI_HUB_TOKEN is set */
export function orchJoinPayload(): Record<string, unknown> {
  const t = process.env.SHINGEKI_HUB_TOKEN;
  return t ? { token: t } : {};
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function waitForWorkersRegistered(
  ws: WebSocket,
  minWorkers: number,
  timeoutMs: number,
  log: (s: string) => void,
): Promise<{ workerIds: string[]; capabilities: Record<string, NodeCapabilities | undefined> }> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const failTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.off('message', onMsg);
      reject(new Error(`timeout: waited ${timeoutMs}ms for ${minWorkers} workers`));
    }, timeoutMs);

    const onMsg = (buf: WebSocket.RawData) => {
      const msg = parseMessage(buf.toString());
      if (msg?.type === 'ORCH_WORKERS') {
        const p = msg.payload as { workerIds?: string[]; capabilities?: Record<string, NodeCapabilities | undefined> };
        const ids = p.workerIds ?? [];
        const caps = p.capabilities ?? {};
        log(`[Orchestrator] workers online: ${ids.join(', ') || '(none)'}`);
        if (ids.length >= minWorkers && !settled) {
          settled = true;
          clearTimeout(failTimer);
          ws.off('message', onMsg);
          resolve({ workerIds: ids, capabilities: caps });
        }
      }
    };

    ws.on('message', onMsg);
    ws.send(encodeMessage('ORCH_JOIN', orchJoinPayload()));
  });
}

export interface OrchestratorSession {
  ws: WebSocket;
  /** Node IDs that were registered at the hub when the session was opened. */
  workerIds: string[];
  /** Capabilities keyed by node ID (may be absent if worker didn't advertise). */
  capabilities: Record<string, NodeCapabilities | undefined>;
}

/**
 * Connect (with TCP retries), attach ORCH_WORKERS listener, send ORCH_JOIN, wait until enough workers register.
 * Returns both the WebSocket and the list of worker IDs so callers can build NodeCapability[] from real registrations.
 */
export async function openOrchestratorSession(
  hubUrl: string,
  minWorkers: number,
  timeoutMs: number,
  log: (s: string) => void,
): Promise<OrchestratorSession> {
  const attempts = orchConnectRetries();
  let lastErr: Error | undefined;

  for (let c = 0; c < attempts; c++) {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(hubUrl);
      await new Promise<void>((res, rej) => {
        ws!.once('open', () => res());
        ws!.once('error', rej);
      });
      const { workerIds, capabilities } = await waitForWorkersRegistered(ws, minWorkers, timeoutMs, log);
      return { ws, workerIds, capabilities };
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      log(`[Orchestrator] hub connect/session attempt ${c + 1}/${attempts} failed: ${lastErr.message}`);
      try {
        ws?.terminate();
      } catch {
        /* ignore */
      }
      if (c < attempts - 1) await sleep(400 * (c + 1));
    }
  }

  throw lastErr ?? new Error('openOrchestratorSession failed');
}

type Pending = {
  resolve: (r: StepResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pending = new Map<string, Pending>();

function attachListener(ws: WebSocket) {
  if ((ws as unknown as { _orch?: boolean })._orch) return;
  (ws as unknown as { _orch: boolean })._orch = true;

  ws.on('message', (buf: WebSocket.RawData) => {
    const msg = parseMessage(buf.toString());
    if (msg?.type === 'STEP_RESULT') {
      const p = msg.payload as {
        stepId: string;
        output?: string;
        latencyMs?: number;
        teeTrace?: Record<string, unknown>;
        error?: string;
        nodeId?: string;
      };
      const slot = pending.get(p.stepId);
      if (!slot) return;
      clearTimeout(slot.timer);
      pending.delete(p.stepId);
      const logicalStepId = p.stepId.includes('|') ? (p.stepId.split('|')[0] ?? p.stepId) : p.stepId;
      if (p.error) slot.reject(new Error(p.error));
      else
        slot.resolve({
          stepId: logicalStepId,
          nodeId: p.nodeId ?? '',
          output: p.output ?? '',
          latencyMs: p.latencyMs ?? 0,
          teeTrace: p.teeTrace,
        });
    }
    if (msg?.type === 'NODE_FAIL') {
      for (const [stepId, slot] of pending) {
        clearTimeout(slot.timer);
        pending.delete(stepId);
        slot.reject(new Error((msg.payload as { reason?: string }).reason ?? 'NODE_FAIL'));
      }
    }
  });
}

export function createMeshStepExecutor(
  ws: WebSocket,
  getGenome: () => Genome,
  options?: { stepTimeoutMs?: number },
): StepExecutor {
  const timeoutMs = options?.stepTimeoutMs ?? 240_000;
  attachListener(ws);

  return async ({ node, step }) => {
    /** Unique wire id so parallel legs (same logical step) don't collide in pending map */
    const wireStepId = `${step.id}|${node.id}`;
    const envelope = {
      stepId: wireStepId,
      title: (step as { title?: string }).title,
      description: step.description,
      genome: getGenome(),
    };

    const resultPromise = new Promise<StepResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(wireStepId);
        reject(new Error(`step timeout (${timeoutMs}ms)`));
      }, timeoutMs);
      pending.set(wireStepId, { resolve, reject, timer });
    });

    ws.send(
      encodeMessage('TASK_ASSIGN', {
        targetNodeId: node.id,
        envelope,
      }),
    );

    return resultPromise;
  };
}
