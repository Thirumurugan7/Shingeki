/**
 * Real TCP / HTTP stack — no mocks (integration-lite).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { MeshHub } from './ws-hub.js';
import { encodeMessage } from './protocol.js';
import { addLineageEntry, clearLineage } from '../infra/lineage-store.js';
import { CHECKPOINT_VERSION, writeCheckpointAtomic } from '../infra/checkpoint.js';
import type { DemoCheckpoint } from '../infra/checkpoint.js';

beforeEach(() => clearLineage());

test('hub serves health, status JSON, and Prometheus metrics', async () => {
  const hub = new MeshHub({ port: 0, authToken: 'hub-test-token' });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    const hj = (await health.json()) as { status: string };
    assert.equal(hj.status, 'ok');

    const status = await fetch(`http://127.0.0.1:${port}/status`);
    assert.equal(status.status, 200);
    const sj = (await status.json()) as { workers: number };
    assert.equal(sj.workers, 0);

    const prom = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert.equal(prom.status, 200);
    const body = await prom.text();
    assert.match(body, /shingeki_hub_workers/);
  } finally {
    await close();
  }
});

test('hub accepts websocket upgrade and worker registration', async () => {
  const hub = new MeshHub({ port: 0, authToken: 'tok' });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const url = `ws://127.0.0.1:${port}`;

    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });

    const joined = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('NODE_JOIN ack timeout')), 5000);
      ws.once('message', buf => {
        clearTimeout(t);
        const j = JSON.parse(buf.toString()) as { type: string };
        if (j.type === 'NODE_JOIN') resolve();
        else reject(new Error(`unexpected ${j.type}`));
      });
    });

    ws.send(encodeMessage('NODE_JOIN', { nodeId: 'integration-node', capabilities: ['llm'], token: 'tok' }));
    await joined;

    await new Promise<void>(resolve => { ws.once('close', () => resolve()); ws.close(); });
  } finally {
    await close();
  }
});

test('hub stores worker capabilities and forwards in ORCH_WORKERS', async () => {
  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const url = `ws://127.0.0.1:${port}`;

    // Register a worker with capabilities.
    const worker = new WebSocket(url);
    await new Promise<void>((res, rej) => { worker.once('open', () => res()); worker.once('error', rej); });
    const workerJoined = new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 5000);
      worker.once('message', () => { clearTimeout(t); res(); });
    });
    worker.send(encodeMessage('NODE_JOIN', {
      nodeId: 'cap-worker',
      capabilities: ['llm'],
      nodeCapabilities: { role: 'reasoning', latency_ms: 250, cost_weight: 1.0, specialization: ['research'] },
    }));
    await workerJoined;

    // Orchestrator connects and receives ORCH_WORKERS with capabilities.
    const orch = new WebSocket(url);
    await new Promise<void>((res, rej) => { orch.once('open', () => res()); orch.once('error', rej); });

    const orchWorkers = new Promise<{ workerIds: string[]; capabilities: Record<string, unknown> }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ORCH_WORKERS timeout')), 5000);
      orch.on('message', buf => {
        const msg = JSON.parse(buf.toString()) as { type: string; payload: unknown };
        if (msg.type === 'ORCH_WORKERS') {
          clearTimeout(t);
          resolve(msg.payload as { workerIds: string[]; capabilities: Record<string, unknown> });
        }
      });
    });
    orch.send(encodeMessage('ORCH_JOIN', {}));
    const payload = await orchWorkers;

    assert.ok(payload.workerIds.includes('cap-worker'));
    const caps = payload.capabilities['cap-worker'] as { role: string; specialization: string[] };
    assert.equal(caps.role, 'reasoning');
    assert.deepEqual(caps.specialization, ['research']);

    worker.close();
    orch.close();
    await new Promise<void>(r => setTimeout(r, 50));
  } finally {
    await close();
  }
});

test('/lineage endpoint returns stored entries', async () => {
  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;

    addLineageEntry({ genome_id: 'g1', model: 'qwen', strategy: 'plan', fitness_score: 0.6, tee_verified: true, timestamp: 1000, step_count: 2 });

    const res = await fetch(`http://127.0.0.1:${port}/lineage`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as Array<{ genome_id: string }>;
    assert.equal(data.length, 1);
    assert.equal(data[0]!.genome_id, 'g1');
  } finally {
    await close();
  }
});

test('GENOME_LINEAGE WS message is stored in lineage', async () => {
  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });

    ws.send(encodeMessage('GENOME_LINEAGE', {
      genome_id: 'g-mesh-1', parent_id: 'g-root',
      model: 'qwen', strategy: 'plan',
      fitness_score: 0.72, tee_verified: true,
      timestamp: 2000, step_count: 3,
    }));

    // Give hub a tick to process the message.
    await new Promise<void>(r => setTimeout(r, 50));

    const res = await fetch(`http://127.0.0.1:${port}/lineage`);
    const data = (await res.json()) as Array<{ genome_id: string }>;
    assert.ok(data.some(e => e.genome_id === 'g-mesh-1'));

    ws.close();
    await new Promise<void>(r => setTimeout(r, 20));
  } finally {
    await close();
  }
});

test('GET /checkpoints and GET /checkpoint read SHINGEKI_CHECKPOINT_DIR', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shingeki-cp-'));
  const prev = process.env.SHINGEKI_CHECKPOINT_DIR;
  process.env.SHINGEKI_CHECKPOINT_DIR = dir;
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.SHINGEKI_CHECKPOINT_DIR;
    else process.env.SHINGEKI_CHECKPOINT_DIR = prev;
  });

  const cp: DemoCheckpoint = {
    version: CHECKPOINT_VERSION,
    taskId: 'integration-task',
    preset: 'gpu',
    mesh: false,
    nextStepIndex: 1,
    results: [{ stepId: 'step-a', nodeId: 'n1', output: 'step output', latencyMs: 12 }],
    genome: {
      id: 'g1',
      model: 'm',
      strategy: 'plan',
      tools: [],
      reflection_depth: 1,
      mutation_rate: 0.1,
    },
    evolveThreshold: 0.5,
    summary: 'final summary',
    updatedAt: 4242,
  };
  writeCheckpointAtomic(dir, cp);

  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;

    const list = await fetch(`http://127.0.0.1:${port}/checkpoints`);
    assert.equal(list.status, 200);
    const lj = (await list.json()) as {
      dir: string;
      checkpoints: Array<{ taskId: string; summaryPreview: string }>;
    };
    assert.equal(lj.dir, path.resolve(dir));
    assert.equal(lj.checkpoints.length, 1);
    assert.equal(lj.checkpoints[0]!.taskId, 'integration-task');

    const one = await fetch(
      `http://127.0.0.1:${port}/checkpoint?task=${encodeURIComponent('integration-task')}`,
    );
    assert.equal(one.status, 200);
    const cj = (await one.json()) as DemoCheckpoint;
    assert.equal(cj.taskId, 'integration-task');
    assert.equal(cj.summary, 'final summary');
    assert.equal(cj.results.length, 1);
    assert.equal(cj.results[0]!.output, 'step output');

    const missing = await fetch(`http://127.0.0.1:${port}/checkpoint?task=nope`);
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test('OPTIONS /api/run CORS preflight', async () => {
  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, { method: 'OPTIONS' });
    assert.equal(res.status, 204);
  } finally {
    await close();
  }
});

test('POST /api/run returns 401 when hub token is required (strict HTTP auth)', async t => {
  const prevStrict = process.env.SHINGEKI_HUB_STRICT_HTTP_AUTH;
  process.env.SHINGEKI_HUB_STRICT_HTTP_AUTH = '1';
  t.after(() => {
    if (prevStrict === undefined) delete process.env.SHINGEKI_HUB_STRICT_HTTP_AUTH;
    else process.env.SHINGEKI_HUB_STRICT_HTTP_AUTH = prevStrict;
  });

  const hub = new MeshHub({ port: 0, authToken: 'hub-secret' });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'gpu' }),
    });
    assert.equal(res.status, 401);
  } finally {
    await close();
  }
});

test('POST /api/run returns 400 env when ROUTER_API_KEY missing', async t => {
  const prev = process.env.ROUTER_API_KEY;
  delete process.env.ROUTER_API_KEY;
  t.after(() => {
    if (prev !== undefined) process.env.ROUTER_API_KEY = prev;
    else delete process.env.ROUTER_API_KEY;
  });

  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'gpu' }),
    });
    assert.equal(res.status, 400);
    const j = (await res.json()) as { error: string; errors?: string[] };
    assert.equal(j.error, 'env');
    assert.ok(Array.isArray(j.errors));
  } finally {
    await close();
  }
});

test('POST /api/run returns 400 mesh_workers when mesh=true but hub has no workers', async t => {
  const prevKey = process.env.ROUTER_API_KEY;
  process.env.ROUTER_API_KEY = 'test-router-key-integration';
  const prevSkip = process.env.SHINGEKI_HUB_SKIP_MESH_WORKER_CHECK;
  delete process.env.SHINGEKI_HUB_SKIP_MESH_WORKER_CHECK;
  t.after(() => {
    if (prevKey !== undefined) process.env.ROUTER_API_KEY = prevKey;
    else delete process.env.ROUTER_API_KEY;
    if (prevSkip !== undefined) process.env.SHINGEKI_HUB_SKIP_MESH_WORKER_CHECK = prevSkip;
    else delete process.env.SHINGEKI_HUB_SKIP_MESH_WORKER_CHECK;
  });

  const hub = new MeshHub({ port: 0 });
  const { httpServer, close } = await hub.listen();
  try {
    const addr = httpServer.address();
    assert.ok(addr && typeof addr === 'object');
    const port = addr.port;
    const res = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: 'gpu', mesh: true }),
    });
    assert.equal(res.status, 400);
    const j = (await res.json()) as { error: string; workers?: number; need?: number };
    assert.equal(j.error, 'mesh_workers');
    assert.equal(j.workers, 0);
    assert.ok(typeof j.need === 'number' && j.need >= 2);
  } finally {
    await close();
  }
});
