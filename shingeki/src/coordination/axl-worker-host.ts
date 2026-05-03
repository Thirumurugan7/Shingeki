/**
 * AXL-based worker host — P2P alternative to WebSocket worker-host.ts.
 * Requires the AXL sidecar to be running (see axl/README.md).
 */
import type { Genome } from '../genome/schema.js';
import type { Step } from '../types.js';
import type { NodeCapabilities } from './protocol.js';
import { NodeRuntime } from '../node-runtime/runtime.js';
import { AxlTransport } from './axl-transport.js';

type Logger = ReturnType<typeof import('../infra/logger.js').createLogger>;

export interface AxlWorkerOptions {
  hubPeerId: string;
  nodeId: string;
  genome: Genome;
  capabilities: NodeCapabilities;
  log: Logger;
  axlBaseUrl?: string;
}

export async function runAxlWorkerHost(options: AxlWorkerOptions): Promise<void> {
  const { hubPeerId, nodeId, genome, capabilities, log, axlBaseUrl } = options;

  const transport = new AxlTransport(axlBaseUrl);
  const identity = await transport.getIdentity();
  const ourPeerId = identity.peerId;

  log.info(`AXL worker ${nodeId} online, peer ID: ${ourPeerId}`);

  await transport.send(hubPeerId, {
    type: 'NODE_JOIN',
    payload: { nodeId, peerId: ourPeerId, capabilities },
  });
  log.info(`[${nodeId}] registered with hub peer ${hubPeerId}`);

  // Tracks the active orchestrator's peer ID so STEP_RESULT is sent to the right party.
  let currentOrchPeerId: string = hubPeerId;

  // Heartbeat loop.
  const heartbeatHandle = setInterval(() => {
    transport
      .send(hubPeerId, { type: 'HEARTBEAT', payload: { nodeId } })
      .catch((e: Error) => log.warn(`[${nodeId}] heartbeat failed: ${e.message}`));
  }, 30_000);

  const cleanup = () => { clearInterval(heartbeatHandle); process.exit(0); };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  // Main receive loop.
  while (true) {
    let msg: import('./axl-transport.js').AxlMessage;
    try {
      msg = await transport.recvWait(60_000);
    } catch (e: unknown) {
      if ((e as Error).message === 'AXL recv timeout') {
        continue; // idle timeout — loop back
      }
      log.error(`[${nodeId}] recv error: ${(e as Error).message} — retrying in 5s`);
      await new Promise(r => setTimeout(r, 5_000));
      continue;
    }

    const envelope = msg.payload as { type: string; payload: unknown };

    if (envelope.type === 'ORCH_JOIN') {
      // Orchestrator announced itself — re-send NODE_JOIN and record its peer ID.
      const p = envelope.payload as { orchestratorPeerId?: string };
      currentOrchPeerId = p.orchestratorPeerId ?? msg.fromPeerId;
      await transport.send(currentOrchPeerId, {
        type: 'NODE_JOIN',
        payload: { nodeId, peerId: ourPeerId, capabilities },
      });
      log.info(`[${nodeId}] re-sent NODE_JOIN to orchestrator ${currentOrchPeerId}`);
    } else if (envelope.type === 'TASK_ASSIGN') {
      const p = envelope.payload as {
        targetNodeId?: string;
        step: Step;
        priorContext?: string;
        genome?: Genome;
      };
      const g = p.genome ?? genome;
      const step: Step = p.step;

      log.info(`[${nodeId}] executing step: ${step.title ?? step.id}`);
      const t0 = Date.now();
      try {
        const runtime = new NodeRuntime({ nodeId }, g);
        const result = await runtime.executeStep(step, p.priorContext);
        log.info(`[${nodeId}] step done in ${Date.now() - t0}ms`);
        await transport.send(currentOrchPeerId, {
          type: 'STEP_RESULT',
          payload: { ...result, nodeId },
        });
      } catch (e: unknown) {
        log.error(`[${nodeId}] step error: ${(e as Error).message}`);
        await transport.send(currentOrchPeerId, {
          type: 'STEP_RESULT',
          payload: {
            stepId: step.id,
            nodeId,
            output: '',
            latencyMs: Date.now() - t0,
            error: (e as Error).message,
          },
        });
      }
    } else if (envelope.type === 'HEARTBEAT_ACK') {
      // ignore
    } else {
      log.warn(`[${nodeId}] unknown message type: ${envelope.type}`);
    }
  }
  // while(true) above never exits normally
}
