/**
 * AXL-based orchestrator session — P2P alternative to mesh-orchestrator-ws.ts.
 * Requires the AXL sidecar to be running (see axl/README.md).
 */
import type { Step, StepResult } from '../types.js';
import type { Genome } from '../genome/schema.js';
import type { NodeCapability } from '../types.js';
import { AxlTransport } from './axl-transport.js';

type Logger = ReturnType<typeof import('../infra/logger.js').createLogger>;

export interface AxlOrchestratorSessionOptions {
  workerPeerIds: string[];
  nodeId: string;
  log: Logger;
  axlBaseUrl?: string;
}

export interface AxlOrchestratorSession {
  transport: AxlTransport;
  ourPeerId: string;
  workerIds: string[];
  /** Map from logical nodeId → AXL peer ID */
  workerPeerIdMap: Map<string, string>;
}

export async function runAxlOrchestratorSession(
  options: AxlOrchestratorSessionOptions,
): Promise<AxlOrchestratorSession> {
  const { workerPeerIds, nodeId, log, axlBaseUrl } = options;

  const transport = new AxlTransport(axlBaseUrl);
  const identity = await transport.getIdentity();
  const ourPeerId = identity.peerId;

  log.info(`AXL orchestrator ${nodeId} online, peer ID: ${ourPeerId}`);

  // Announce ourselves to each worker.
  for (const workerPeerId of workerPeerIds) {
    await transport.send(workerPeerId, {
      type: 'ORCH_JOIN',
      payload: { orchestratorPeerId: ourPeerId },
    });
    log.info(`ORCH_JOIN sent to ${workerPeerId}`);
  }

  // Wait for NODE_JOIN responses from each worker.
  const workerIds: string[] = [];
  const workerPeerIdMap = new Map<string, string>();
  const expectedCount = workerPeerIds.length;
  const deadline = Date.now() + 30_000 * expectedCount;

  while (workerIds.length < expectedCount && Date.now() < deadline) {
    const msg = await transport.recvWait(30_000);
    const envelope = msg.payload as { type: string; payload: unknown };
    if (envelope.type === 'NODE_JOIN') {
      const p = envelope.payload as { nodeId: string; peerId: string };
      workerIds.push(p.nodeId);
      workerPeerIdMap.set(p.nodeId, p.peerId ?? msg.fromPeerId);
      log.info(`Worker registered: ${p.nodeId} (peer ${p.peerId ?? msg.fromPeerId})`);
    }
  }

  if (workerIds.length < expectedCount) {
    log.warn(
      `Only ${workerIds.length}/${expectedCount} workers joined within timeout`,
    );
  }

  return { transport, ourPeerId, workerIds, workerPeerIdMap };
}

export type StepExecutorFn = (args: {
  node: NodeCapability;
  step: Step;
  priorContext: string;
  stepIndex: number;
}) => Promise<StepResult>;

export function createAxlStepExecutor(
  transport: AxlTransport,
  workerPeerIdMap: Map<string, string>,
  getGenome: () => Genome,
  stepTimeoutMs = 240_000,
): StepExecutorFn {
  return async ({ node, step, priorContext }) => {
    const targetPeerId = workerPeerIdMap.get(node.id);
    if (!targetPeerId) {
      throw new Error(`No AXL peer ID for node ${node.id}`);
    }

    await transport.send(targetPeerId, {
      type: 'TASK_ASSIGN',
      payload: {
        targetNodeId: node.id,
        step,
        priorContext,
        genome: getGenome(),
      },
    });

    const deadline = Date.now() + stepTimeoutMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const msg = await transport.recvWait(Math.min(60_000, remaining));
      const envelope = msg.payload as { type: string; payload: unknown };
      if (envelope.type === 'STEP_RESULT') {
        const r = envelope.payload as StepResult & { error?: string };
        if (r.stepId === step.id) {
          if (r.error) throw new Error(`Worker step error (${step.id}): ${r.error}`);
          return r;
        }
      }
    }

    throw new Error(
      `AXL step executor: timeout waiting for STEP_RESULT for step ${step.id}`,
    );
  };
}
