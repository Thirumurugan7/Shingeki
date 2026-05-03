import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AxlTransport } from './axl-transport.js';

type FetchFn = typeof fetch;
let originalFetch: FetchFn;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  (globalThis as Record<string, unknown>)['fetch'] = handler as FetchFn;
}
function restoreFetch() {
  (globalThis as Record<string, unknown>)['fetch'] = originalFetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('AxlTransport', () => {
  before(() => { originalFetch = globalThis.fetch; });
  after(() => restoreFetch());

  it('getIdentity() maps our_public_key → peerId and our_ipv6 → ipv6', async () => {
    mockFetch(async () =>
      jsonResponse({
        our_public_key: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        our_ipv6: '::1',
        peers: [],
        tree: [],
      }),
    );

    const t = new AxlTransport('http://127.0.0.1:9002');
    const id = await t.getIdentity();
    assert.equal(id.peerId, 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890');
    assert.equal(id.ipv6, '::1');
  });

  it('send() sets X-Destination-Peer-Id header correctly', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = '';

    mockFetch(async (_, init) => {
      capturedHeaders = Object.fromEntries(
        new Headers(init?.headers as HeadersInit).entries(),
      );
      capturedBody = Buffer.from(init?.body as Uint8Array).toString('utf-8');
      return new Response(null, {
        status: 200,
        headers: { 'X-Sent-Bytes': '42' },
      });
    });

    const t = new AxlTransport('http://127.0.0.1:9002');
    await t.send('peer-xyz', { hello: 'world' });

    assert.equal(capturedHeaders['x-destination-peer-id'], 'peer-xyz');
    assert.deepEqual(JSON.parse(capturedBody), { hello: 'world' });
  });

  it('recv() returns null on 204 No Content', async () => {
    mockFetch(async () => new Response(null, { status: 204 }));

    const t = new AxlTransport('http://127.0.0.1:9002');
    const result = await t.recv();
    assert.equal(result, null);
  });

  it('recv() parses message body and X-From-Peer-Id on 200', async () => {
    const payload = { type: 'HEARTBEAT', payload: { nodeId: 'node-1' } };

    mockFetch(async () =>
      new Response(Buffer.from(JSON.stringify(payload), 'utf-8'), {
        status: 200,
        headers: { 'X-From-Peer-Id': 'peer-abc123' },
      }),
    );

    const t = new AxlTransport('http://127.0.0.1:9002');
    const msg = await t.recv();

    assert.ok(msg !== null);
    assert.equal(msg!.fromPeerId, 'peer-abc123');
    assert.deepEqual(msg!.payload, payload);
  });

  it('recv() throws on unexpected status codes', async () => {
    mockFetch(async () => new Response(null, { status: 500 }));

    const t = new AxlTransport('http://127.0.0.1:9002');
    await assert.rejects(
      () => t.recv(),
      (e: Error) => e.message.includes('500'),
    );
  });

  it('recvWait() throws AXL recv timeout when queue stays empty', async () => {
    // Always return 204 (empty queue)
    mockFetch(async () => new Response(null, { status: 204 }));

    const t = new AxlTransport('http://127.0.0.1:9002');
    await assert.rejects(
      () => t.recvWait(300, 50), // 300ms timeout, poll every 50ms
      (e: Error) => e.message === 'AXL recv timeout',
    );
  });

  it('isReady() returns true on 200, false on error', async () => {
    const t = new AxlTransport('http://127.0.0.1:9002');

    mockFetch(async () => jsonResponse({ our_public_key: 'abc', our_ipv6: '::1', peers: [], tree: [] }));
    assert.equal(await t.isReady(), true);

    mockFetch(async () => { throw new Error('connection refused'); });
    assert.equal(await t.isReady(), false);
  });

  it('mcpCall() sends correct JSON-RPC envelope and returns result', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;

    mockFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string);
      return jsonResponse({ jsonrpc: '2.0', id: 1, result: { answer: 42 } });
    });

    const t = new AxlTransport('http://127.0.0.1:9002');
    const result = await t.mcpCall('peer-1', 'myService', 'doThing', { x: 1 });

    assert.equal(capturedUrl, 'http://127.0.0.1:9002/mcp/peer-1/myService');
    const body = capturedBody as Record<string, unknown>;
    assert.equal(body['jsonrpc'], '2.0');
    assert.equal(body['method'], 'doThing');
    assert.deepEqual(body['params'], { x: 1 });
    assert.deepEqual(result, { answer: 42 });
  });

  it('mcpCall() throws when response contains an error field', async () => {
    mockFetch(async () =>
      jsonResponse({ jsonrpc: '2.0', id: 1, error: { message: 'service not found' } }),
    );

    const t = new AxlTransport('http://127.0.0.1:9002');
    await assert.rejects(
      () => t.mcpCall('peer-1', 'svc', 'method', {}),
      (e: Error) => e.message.includes('service not found'),
    );
  });
});
