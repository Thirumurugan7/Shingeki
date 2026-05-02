/**
 * Worker process — registers with hub, runs NodeRuntime on TASK_ASSIGN, returns STEP_RESULT.
 */
import WebSocket from 'ws';
import { encodeMessage, parseMessage } from './protocol.js';
import type { Genome } from '../genome/schema.js';
import type { Step } from '../types.js';
import { NodeRuntime } from '../node-runtime/runtime.js';

function nodeJoinPayload(nodeId: string, capabilities: string[]) {
  const t = process.env.SHINGEKI_HUB_TOKEN;
  return t
    ? { nodeId, capabilities, token: t }
    : { nodeId, capabilities };
}

export function runWorkerHost(
  hubUrl: string,
  nodeId: string,
  genome: Genome,
  capabilities: string[] = ['llm'],
  log: (s: string) => void = console.log,
): WebSocket {
  const ws = new WebSocket(hubUrl);

  ws.on('open', () => {
    ws.send(encodeMessage('NODE_JOIN', nodeJoinPayload(nodeId, capabilities)));
    log(`[${nodeId}] registered with hub`);
  });

  ws.on('message', async (buf: WebSocket.RawData) => {
    const msg = parseMessage(buf.toString());
    if (msg?.type !== 'TASK_ASSIGN') return;

    const p = msg.payload as {
      stepId: string;
      title?: string;
      description: string;
      genome?: Genome;
    };
    const g = p.genome ?? genome;
    const step: Step = {
      id: p.stepId,
      description: p.description,
    };

    log(`[${nodeId}] executing step: ${p.title ?? p.stepId}`);
    log(`[${nodeId}] calling 0G Compute (${g.model})`);

    const t0 = Date.now();
    try {
      const runtime = new NodeRuntime({ nodeId }, g);
      const r = await runtime.executeStep(step);
      log(`[${nodeId}] result received (latency: ${(r.latencyMs / 1000).toFixed(1)}s)`);
      ws.send(
        encodeMessage('STEP_RESULT', {
          stepId: r.stepId,
          output: r.output,
          latencyMs: r.latencyMs,
          teeTrace: r.teeTrace,
        }),
      );
      log(`[${nodeId}] STEP_RESULT sent (${Date.now() - t0}ms wall) → orchestrator`);
    } catch (e: unknown) {
      log(`[${nodeId}] error: ${(e as Error).message}`);
      ws.send(
        encodeMessage('STEP_RESULT', {
          stepId: p.stepId,
          output: '',
          latencyMs: Date.now() - t0,
          error: (e as Error).message,
        }),
      );
    }
  });

  ws.on('close', () => log(`[${nodeId}] disconnected`));
  ws.on('error', err => log(`[${nodeId}] ws error: ${err.message}`));

  return ws;
}
