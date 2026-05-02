/**
 * Coordination hub — HTTP observability + WebSocket routing (orchestrator ↔ workers).
 */
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { encodeMessage, parseMessage } from './protocol.js';
import type { MeshMessage } from '../types.js';
import { createLogger } from '../infra/logger.js';
import {
  hubMaxPayloadBytes,
  hubReadyMinWorkers,
  hubTlsCredentials,
} from '../config/runtime-config.js';

const log = createLogger('mesh-hub');

export interface HubOptions {
  port: number;
  /** If set, clients must send this token on ORCH_JOIN / NODE_JOIN payloads (never logged). */
  authToken?: string;
  /** Override max WS frame size (default from env or 2 MiB). */
  maxPayloadBytes?: number;
  /** Bind address (default 0.0.0.0 in production, 127.0.0.1 optional via env). */
  host?: string;
}

export interface HubListenResult {
  readonly httpServer: http.Server | https.Server;
  readonly tls: boolean;
  /** Graceful close — drains HTTP + WS */
  close: () => Promise<void>;
}

export class MeshHub {
  private readonly workers = new Map<string, WebSocket>();
  private orchWs: WebSocket | null = null;
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | https.Server | null = null;
  private readonly rateWindow = new Map<string, { count: number; resetAt: number }>();
  private readonly maxMsgsPerMinute: number;
  private readonly wsMsgCounts = new Map<string, number>();
  private rateLimitHits = 0;

  constructor(private readonly opt: HubOptions) {
    const raw = process.env.SHINGEKI_HUB_MAX_MSG_PER_MIN_PER_IP;
    if (raw === '0' || raw === 'off') this.maxMsgsPerMinute = Number.MAX_SAFE_INTEGER;
    else if (raw == null || raw === '') this.maxMsgsPerMinute = 100_000;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 10 || n > 5_000_000) {
        throw new Error('SHINGEKI_HUB_MAX_MSG_PER_MIN_PER_IP must be between 10 and 5000000 (or 0=off)');
      }
      this.maxMsgsPerMinute = Math.floor(n);
    }
  }

  private authOk(payload: unknown): boolean {
    const want = this.opt.authToken;
    if (!want) return true;
    const t = (payload as { token?: string })?.token;
    return t === want;
  }

  private clientIp(req: IncomingMessage): string {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.length > 0) return xf.split(',')[0]!.trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  private rateOk(ip: string): boolean {
    const now = Date.now();
    const w = this.rateWindow.get(ip);
    if (!w || now > w.resetAt) {
      this.rateWindow.set(ip, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    if (w.count >= this.maxMsgsPerMinute) return false;
    w.count += 1;
    return true;
  }

  private bumpWsMetric(msgType: string) {
    this.wsMsgCounts.set(msgType, (this.wsMsgCounts.get(msgType) ?? 0) + 1);
  }

  private prometheusText(): string {
    const workerCount = this.workers.size;
    const orchUp = this.orchWs != null && this.orchWs.readyState === WebSocket.OPEN ? 1 : 0;
    const instance =
      process.env.SHINGEKI_HUB_INSTANCE_ID?.trim() || os.hostname();
    const lines: string[] = [
      '# HELP shingeki_hub_workers Connected mesh worker sockets',
      '# TYPE shingeki_hub_workers gauge',
      `shingeki_hub_workers{instance=${JSON.stringify(instance)}} ${workerCount}`,
      '# HELP shingeki_hub_orchestrator_connected Orchestrator socket connected (1=yes)',
      '# TYPE shingeki_hub_orchestrator_connected gauge',
      `shingeki_hub_orchestrator_connected{instance=${JSON.stringify(instance)}} ${orchUp}`,
      '# HELP shingeki_hub_rate_limit_hits_total Client messages rejected by rate limit',
      '# TYPE shingeki_hub_rate_limit_hits_total counter',
      `shingeki_hub_rate_limit_hits_total{instance=${JSON.stringify(instance)}} ${this.rateLimitHits}`,
      '# HELP shingeki_hub_ws_messages_total WebSocket messages by type',
      '# TYPE shingeki_hub_ws_messages_total counter',
    ];
    for (const [t, n] of this.wsMsgCounts) {
      lines.push(
        `shingeki_hub_ws_messages_total{instance=${JSON.stringify(instance)},type=${JSON.stringify(t)}} ${n}`,
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  private notifyOrchestratorWorkers() {
    if (this.orchWs && this.orchWs.readyState === WebSocket.OPEN) {
      this.orchWs.send(
        encodeMessage('ORCH_WORKERS', { workerIds: [...this.workers.keys()] }),
      );
    }
  }

  private handleHttp(req: IncomingMessage, res: http.ServerResponse) {
    const path = req.url?.split('?')[0] ?? '/';

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', role: 'shingeki-hub' }));
      return;
    }

    const readyMin = hubReadyMinWorkers();
    const workerCount = this.workers.size;
    const orchOk = this.orchWs != null && this.orchWs.readyState === WebSocket.OPEN;
    const meetsMinWorkers = readyMin == null || workerCount >= readyMin;

    if (req.method === 'GET' && path === '/ready') {
      const ready = meetsMinWorkers;
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ready,
          workers: workerCount,
          orchestrator_connected: orchOk,
          ready_min_workers: readyMin ?? null,
        }),
      );
      return;
    }

    if (req.method === 'GET' && path === '/metrics') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      });
      res.end(this.prometheusText());
      return;
    }

    if (req.method === 'GET' && path === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          workers: workerCount,
          orchestrator_connected: orchOk,
          ready_min_workers: readyMin ?? null,
          instance: process.env.SHINGEKI_HUB_INSTANCE_ID?.trim() ?? os.hostname(),
          ts: Date.now(),
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  }

  async listen(): Promise<HubListenResult> {
    const maxPayload = this.opt.maxPayloadBytes ?? hubMaxPayloadBytes();
    const host = this.opt.host ?? process.env.SHINGEKI_HUB_HOST ?? '0.0.0.0';

    const tlsopt = hubTlsCredentials();
    const server = tlsopt
      ? https.createServer(tlsopt, (req, res) => this.handleHttp(req, res))
      : http.createServer((req, res) => this.handleHttp(req, res));

    const wss = new WebSocketServer({
      noServer: true,
      maxPayload,
      perMessageDeflate: false,
    });

    this.wss = wss;
    this.httpServer = server;

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const path = req.url?.split('?')[0] ?? '/';
      if (path !== '/') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => {
        wss.emit('connection', ws, req);
      });
    });

    wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const ip = this.clientIp(req);

      ws.on('message', (buf: Buffer) => {
        if (!this.rateOk(ip)) {
          this.rateLimitHits += 1;
          log.warn('rate limit exceeded', { ip });
          ws.close(4009, 'rate limit');
          return;
        }

        const raw = buf.toString();
        if (raw.length > maxPayload) {
          ws.close(4004, 'payload too large');
          return;
        }

        const msg = parseMessage(raw);
        if (!msg) return;
        this.bumpWsMetric(msg.type);

        if (msg.type === 'ORCH_JOIN') {
          if (!this.authOk(msg.payload)) {
            ws.close(4001, 'unauthorized');
            return;
          }
          this.orchWs = ws;
          ws.send(
            encodeMessage('ORCH_WORKERS', { workerIds: [...this.workers.keys()] }),
          );
          log.info('orchestrator joined');
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
          log.info('worker registered', { nodeId: p.nodeId });
          return;
        }

        if (msg.type === 'HEARTBEAT') {
          const p = msg.payload as { nodeId: string };
          ws.send(encodeMessage('HEARTBEAT', { ok: true, nodeId: p.nodeId }));
          return;
        }

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
        if (ws === this.orchWs) {
          this.orchWs = null;
          log.info('orchestrator disconnected');
        }
        for (const [k, w] of this.workers) {
          if (w === ws) this.workers.delete(k);
        }
        this.notifyOrchestratorWorkers();
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opt.port, host, () => resolve());
    });
    log.info('listening', { port: this.opt.port, host, tls: Boolean(tlsopt) });

    const close = async () => {
      try {
        this.orchWs?.terminate();
      } catch {
        /* ignore */
      }
      this.orchWs = null;
      for (const w of this.workers.values()) {
        try {
          w.terminate();
        } catch {
          /* ignore */
        }
      }
      this.workers.clear();

      await new Promise<void>(resolve => {
        if (!this.wss) {
          resolve();
          return;
        }
        this.wss.close(err => {
          if (err) log.warn('wss close', { err: (err as Error).message });
          resolve();
        });
      });
      await new Promise<void>(resolve => {
        if (!this.httpServer) {
          resolve();
          return;
        }
        this.httpServer.close(() => resolve());
      });
      this.wss = null;
      this.httpServer = null;
    };

    return { httpServer: server, tls: Boolean(tlsopt), close };
  }

  broadcast(type: MeshMessage['type'], payload: unknown) {
    const raw = encodeMessage(type, payload);
    for (const w of this.workers.values()) {
      if (w.readyState === WebSocket.OPEN) w.send(raw);
    }
  }
}
