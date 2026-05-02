/**
 * Fast coordination layer — routes TASK_ASSIGN orchestrator → worker, STEP_RESULT worker → orchestrator.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { encodeMessage, parseMessage } from './protocol.js';
import type { MeshMessage } from '../types.js';

export interface HubOptions {
  port: number;
  /** If set, clients must send this token on ORCH_JOIN / NODE_JOIN payloads. */
  authToken?: string;
}

export class MeshHub {
  private readonly workers = new Map<string, WebSocket>();
  private orchWs: WebSocket | null = null;

  constructor(private readonly opt: HubOptions) {}

  /** Extract optional bearer token from coord payloads */
  private authOk(payload: unknown): boolean {
    const want = this.opt.authToken;
    if (!want) return true;
    const t = (payload as { token?: string })?.token;
    return t === want;
  }

  private notifyOrchestratorWorkers() {
    if (this.orchWs && this.orchWs.readyState === WebSocket.OPEN) {
      this.orchWs.send(
        encodeMessage('ORCH_WORKERS', { workerIds: [...this.workers.keys()] }),
      );
    }
  }

  listen(): WebSocketServer {
    const wss = new WebSocketServer({ port: this.opt.port });

    wss.on('connection', (ws: WebSocket) => {
      ws.on('message', (buf: Buffer) => {
        const msg = parseMessage(buf.toString());
        if (!msg) return;

        if (msg.type === 'ORCH_JOIN') {
          if (!this.authOk(msg.payload)) {
            ws.close(4001, 'unauthorized');
            return;
          }
          this.orchWs = ws;
          ws.send(
            encodeMessage('ORCH_WORKERS', { workerIds: [...this.workers.keys()] }),
          );
          return;
        }

        if (msg.type === 'NODE_JOIN') {
          if (!this.authOk(msg.payload)) {
            ws.close(4001, 'unauthorized');
            return;
          }
          const p = msg.payload as { nodeId: string; capabilities?: string[] };
          this.workers.set(p.nodeId, ws);
          ws.send(encodeMessage('NODE_JOIN', { ok: true, nodeId: p.nodeId }));
          this.notifyOrchestratorWorkers();
          return;
        }

        if (msg.type === 'HEARTBEAT') {
          const p = msg.payload as { nodeId: string };
          ws.send(encodeMessage('HEARTBEAT', { ok: true, nodeId: p.nodeId }));
          return;
        }

        /** Orchestrator delegates a step to a specific worker */
        if (msg.type === 'TASK_ASSIGN') {
          if (ws !== this.orchWs) return;
          const p = msg.payload as {
            targetNodeId: string;
            envelope: Record<string, unknown>;
          };
          const target = this.workers.get(p.targetNodeId);
          if (!target || target.readyState !== WebSocket.OPEN) {
            this.orchWs?.send(
              encodeMessage('NODE_FAIL', {
                targetNodeId: p.targetNodeId,
                reason: 'worker not connected',
              }),
            );
            return;
          }
          target.send(encodeMessage('TASK_ASSIGN', p.envelope));
          return;
        }

        /** Worker finished step — forward to orchestrator */
        if (msg.type === 'STEP_RESULT') {
          let workerId: string | null = null;
          for (const [id, w] of this.workers) {
            if (w === ws) {
              workerId = id;
              break;
            }
          }
          if (!workerId) return;
          const payload = { ...(msg.payload as object), nodeId: workerId };
          if (this.orchWs && this.orchWs.readyState === WebSocket.OPEN) {
            this.orchWs.send(encodeMessage('STEP_RESULT', payload));
          }
          return;
        }
      });

      ws.on('close', () => {
        if (ws === this.orchWs) this.orchWs = null;
        for (const [k, w] of this.workers) {
          if (w === ws) this.workers.delete(k);
        }
        this.notifyOrchestratorWorkers();
      });
    });

    return wss;
  }

  broadcast(type: MeshMessage['type'], payload: unknown) {
    const raw = encodeMessage(type, payload);
    for (const w of this.workers.values()) {
      if (w.readyState === WebSocket.OPEN) w.send(raw);
    }
  }
}
