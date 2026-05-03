/**
 * Coordination hub — HTTP observability + WebSocket routing (orchestrator ↔ workers).
 * Routes: /health /ready /status /metrics /lineage /checkpoints /checkpoint /api/run /viewer  WS: /
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { encodeMessage, parseMessage, type NodeCapabilities } from './protocol.js';
import type { LineageEntry, MeshMessage } from '../types.js';
import { addLineageEntry, getLineage } from '../infra/lineage-store.js';
import {
  listCheckpointSummaries,
  readCheckpoint,
  resolvedCheckpointDir,
} from '../infra/checkpoint.js';
import { checkRunEnv } from '../config/env-check.js';
import { createLogger } from '../infra/logger.js';
import {
  hubMaxPayloadBytes,
  hubReadyMinWorkers,
  hubTlsCredentials,
} from '../config/runtime-config.js';

const log = createLogger('mesh-hub');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_PATH = path.join(__dirname, '../viewer/index.html');
const SHINGEKI_ROOT = path.resolve(__dirname, '..', '..');
const CLI_TS = path.join(SHINGEKI_ROOT, 'src', 'cli.ts');

const RUN_API_MAX_BODY = 262_144;

const JSON_CORS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let len = 0;
    req.on('data', (c: Buffer) => {
      len += c.length;
      if (len > maxBytes) {
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

type ParseRunApi =
  | { ok: true; argv: string[]; taskIdForResponse: string; resumeId?: string }
  | { ok: false; message: string };

function parseRunApiBody(body: unknown): ParseRunApi {
  if (body === null || typeof body !== 'object') return { ok: false, message: 'invalid_body' };
  const o = body as Record<string, unknown>;

  const presetIn = o.preset;
  const preset = presetIn === 'japan' ? 'japan' : 'gpu';

  const mesh = o.mesh === true;

  const taskStr = typeof o.task === 'string' ? o.task : '';
  const resumeRaw = typeof o.resume === 'string' ? o.resume.trim() : '';
  const resumeId = resumeRaw || undefined;

  const taskIdArg = typeof o.taskId === 'string' && o.taskId.trim() ? o.taskId.trim() : undefined;

  const argv: string[] = [];
  if (mesh) argv.push('--mesh');
  argv.push('--preset', preset);

  let taskIdForResponse: string;

  if (resumeId) {
    argv.push('--resume', resumeId);
    if (taskIdArg) argv.push('--task-id', taskIdArg);
    if (taskStr.trim()) argv.push('--task', taskStr.trim());
    const cp = readCheckpoint(resolvedCheckpointDir(), resumeId);
    taskIdForResponse = cp?.taskId ?? taskIdArg ?? resumeId;
  } else {
    const tid = taskIdArg ?? `task-${Date.now()}`;
    argv.push('--task-id', tid);
    taskIdForResponse = tid;
    if (taskStr.trim()) argv.push('--task', taskStr.trim());
  }

  return { ok: true, argv, taskIdForResponse, resumeId };
}

export interface HubOptions {
  port: number;
  authToken?: string;
  maxPayloadBytes?: number;
  host?: string;
}

export interface HubListenResult {
  readonly httpServer: http.Server | https.Server;
  readonly tls: boolean;
  close: () => Promise<void>;
}

interface WorkerEntry {
  ws: WebSocket;
  capabilities?: NodeCapabilities;
}

export class MeshHub {
  private readonly workers = new Map<string, WorkerEntry>();
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
    const instance = process.env.SHINGEKI_HUB_INSTANCE_ID?.trim() || os.hostname();
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

  private orchWorkersPayload(): { workerIds: string[]; capabilities: Record<string, NodeCapabilities | undefined> } {
    const caps: Record<string, NodeCapabilities | undefined> = {};
    for (const [id, entry] of this.workers) {
      caps[id] = entry.capabilities;
    }
    return { workerIds: [...this.workers.keys()], capabilities: caps };
  }

  private notifyOrchestratorWorkers() {
    if (this.orchWs && this.orchWs.readyState === WebSocket.OPEN) {
      this.orchWs.send(encodeMessage('ORCH_WORKERS', this.orchWorkersPayload()));
    }
  }

  /** Direct TCP peer only (not X-Forwarded-For) — safe loopback check for local viewer + POST /api/run. */
  private isDirectLoopback(req: IncomingMessage): boolean {
    const ip = req.socket.remoteAddress ?? '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  /**
   * POST /api/run when hub auth is enabled: Bearer matches SHINGEKI_HUB_TOKEN, or same-machine
   * loopback without putting the secret in the browser. Set SHINGEKI_HUB_STRICT_HTTP_AUTH=1 to
   * always require Bearer (tests; locked-down hosts).
   */
  private runApiAuthOk(req: IncomingMessage): boolean {
    const want = this.opt.authToken?.trim();
    if (!want) return true;
    const h = req.headers.authorization;
    if (typeof h === 'string' && h.startsWith('Bearer ') && h.slice(7) === want) return true;
    if (process.env.SHINGEKI_HUB_STRICT_HTTP_AUTH?.trim() === '1') return false;
    return this.isDirectLoopback(req);
  }

  private dispatchApiRun(res: http.ServerResponse, body: unknown): void {
    const envReport = checkRunEnv();
    if (!envReport.ok) {
      res.writeHead(400, JSON_CORS);
      res.end(JSON.stringify({ error: 'env', errors: envReport.errors }));
      return;
    }

    const parsed = parseRunApiBody(body);
    if (!parsed.ok) {
      res.writeHead(400, JSON_CORS);
      res.end(JSON.stringify({ error: parsed.message }));
      return;
    }

    const child = spawn(process.execPath, ['--import', 'tsx', CLI_TS, 'run', ...parsed.argv], {
      cwd: SHINGEKI_ROOT,
      env: process.env,
      detached: true,
      stdio: process.env.SHINGEKI_HUB_LOG_CHILD_RUN === '1' ? 'inherit' : 'ignore',
    });
    child.on('error', err => log.error('spawn cli run failed', { err: String(err) }));
    child.unref();

    res.writeHead(202, JSON_CORS);
    res.end(
      JSON.stringify({
        accepted: true,
        taskId: parsed.taskIdForResponse,
        resume: parsed.resumeId ?? null,
      }),
    );
  }

  private handleHttp(req: IncomingMessage, res: http.ServerResponse) {
    const raw = req.url?.split('?')[0] ?? '/';
    const urlPath = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;

    if (req.method === 'OPTIONS' && urlPath === '/api/run') {
      res.writeHead(204, {
        ...JSON_CORS,
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/run') {
      if (!this.runApiAuthOk(req)) {
        res.writeHead(401, JSON_CORS);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      readJsonBody(req, RUN_API_MAX_BODY)
        .then(body => {
          this.dispatchApiRun(res, body);
        })
        .catch(err => {
          const msg = err instanceof Error ? err.message : String(err);
          const code = msg === 'payload_too_large' ? 413 : 400;
          res.writeHead(code, JSON_CORS);
          res.end(JSON.stringify({ error: msg }));
        });
      return;
    }

    if (req.method === 'GET' && urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', role: 'shingeki-hub' }));
      return;
    }

    const readyMin = hubReadyMinWorkers();
    const workerCount = this.workers.size;
    const orchOk = this.orchWs != null && this.orchWs.readyState === WebSocket.OPEN;
    const meetsMinWorkers = readyMin == null || workerCount >= readyMin;

    if (req.method === 'GET' && urlPath === '/ready') {
      const ready = meetsMinWorkers;
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready, workers: workerCount, orchestrator_connected: orchOk, ready_min_workers: readyMin ?? null }));
      return;
    }

    if (req.method === 'GET' && urlPath === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(this.prometheusText());
      return;
    }

    if (req.method === 'GET' && urlPath === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        workers: workerCount,
        orchestrator_connected: orchOk,
        ready_min_workers: readyMin ?? null,
        instance: process.env.SHINGEKI_HUB_INSTANCE_ID?.trim() ?? os.hostname(),
        ts: Date.now(),
      }));
      return;
    }

    if (req.method === 'GET' && urlPath === '/lineage') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(getLineage()));
      return;
    }

    if (req.method === 'GET' && urlPath === '/checkpoints') {
      const dir = resolvedCheckpointDir();
      const checkpoints = listCheckpointSummaries(dir);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify({ dir, checkpoints }));
      return;
    }

    if (req.method === 'GET' && urlPath === '/checkpoint') {
      const u = new URL(req.url ?? '/', 'http://hub.local');
      const task = u.searchParams.get('task')?.trim();
      if (!task) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'missing_task_query' }));
        return;
      }
      const cp = readCheckpoint(resolvedCheckpointDir(), task);
      if (!cp) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'not_found', task }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(cp));
      return;
    }

    if (req.method === 'GET' && urlPath === '/viewer') {
      try {
        const html = fs.readFileSync(VIEWER_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('viewer/index.html not found');
      }
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

    const wss = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
    this.wss = wss;
    this.httpServer = server;

    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const urlPath = req.url?.split('?')[0] ?? '/';
      if (urlPath !== '/') { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
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
        if (raw.length > maxPayload) { ws.close(4004, 'payload too large'); return; }

        const msg = parseMessage(raw);
        if (!msg) return;
        this.bumpWsMetric(msg.type);

        if (msg.type === 'ORCH_JOIN') {
          if (!this.authOk(msg.payload)) { ws.close(4001, 'unauthorized'); return; }
          this.orchWs = ws;
          ws.send(encodeMessage('ORCH_WORKERS', this.orchWorkersPayload()));
          log.info('orchestrator joined');
          return;
        }

        if (msg.type === 'NODE_JOIN') {
          if (!this.authOk(msg.payload)) { ws.close(4001, 'unauthorized'); return; }
          const p = msg.payload as { nodeId: string; capabilities?: string[]; nodeCapabilities?: NodeCapabilities };
          this.workers.set(p.nodeId, { ws, capabilities: p.nodeCapabilities });
          ws.send(encodeMessage('NODE_JOIN', { ok: true, nodeId: p.nodeId }));
          this.notifyOrchestratorWorkers();
          log.info('worker registered', { nodeId: p.nodeId, role: p.nodeCapabilities?.role });
          return;
        }

        if (msg.type === 'HEARTBEAT') {
          const p = msg.payload as { nodeId: string };
          ws.send(encodeMessage('HEARTBEAT', { ok: true, nodeId: p.nodeId }));
          return;
        }

        if (msg.type === 'GENOME_LINEAGE') {
          addLineageEntry(msg.payload as LineageEntry);
          log.info('lineage entry stored', { genome_id: (msg.payload as LineageEntry).genome_id });
          return;
        }

        if (msg.type === 'TASK_ASSIGN') {
          if (ws !== this.orchWs) return;
          const p = msg.payload as { targetNodeId: string; envelope: Record<string, unknown> };
          const entry = this.workers.get(p.targetNodeId);
          if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
            this.orchWs?.send(encodeMessage('NODE_FAIL', { targetNodeId: p.targetNodeId, reason: 'worker not connected' }));
            return;
          }
          entry.ws.send(encodeMessage('TASK_ASSIGN', p.envelope));
          return;
        }

        if (msg.type === 'STEP_RESULT') {
          let workerId: string | null = null;
          for (const [id, e] of this.workers) {
            if (e.ws === ws) { workerId = id; break; }
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
        if (ws === this.orchWs) { this.orchWs = null; log.info('orchestrator disconnected'); }
        for (const [k, e] of this.workers) {
          if (e.ws === ws) this.workers.delete(k);
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
      try { this.orchWs?.terminate(); } catch { /* ignore */ }
      this.orchWs = null;
      for (const e of this.workers.values()) {
        try { e.ws.terminate(); } catch { /* ignore */ }
      }
      this.workers.clear();
      await new Promise<void>(resolve => {
        if (!this.wss) { resolve(); return; }
        this.wss.close(err => {
          if (err) log.warn('wss close', { err: (err as Error).message });
          resolve();
        });
      });
      await new Promise<void>(resolve => {
        if (!this.httpServer) { resolve(); return; }
        this.httpServer.close(() => resolve());
      });
      this.wss = null;
      this.httpServer = null;
    };

    return { httpServer: server, tls: Boolean(tlsopt), close };
  }

  broadcast(type: MeshMessage['type'], payload: unknown) {
    const raw = encodeMessage(type, payload);
    for (const e of this.workers.values()) {
      if (e.ws.readyState === WebSocket.OPEN) e.ws.send(raw);
    }
  }
}
