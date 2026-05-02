/**
 * Real TCP / HTTP stack — no mocks (integration-lite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { MeshHub } from './ws-hub.js';
import { encodeMessage } from './protocol.js';

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

    ws.send(
      encodeMessage('NODE_JOIN', { nodeId: 'integration-node', capabilities: ['llm'], token: 'tok' }),
    );
    await joined;

    await new Promise<void>(resolve => {
      ws.once('close', () => resolve());
      ws.close();
    });
  } finally {
    await close();
  }
});
