/**
 * AXL P2P transport — wraps the AXL sidecar HTTP API.
 * Docs: https://github.com/gensyn-ai/axl/blob/main/docs/api.md
 */

// Frozen at import time — callers that need live env should pass axlApiUrl() explicitly to the constructor.
const AXL_BASE = process.env.AXL_API_URL ?? 'http://127.0.0.1:9002';

export interface AxlIdentity {
  peerId: string;
  ipv6: string;
}

export interface AxlMessage {
  fromPeerId: string;
  payload: unknown;
}

export class AxlTransport {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? AXL_BASE;
  }

  async getIdentity(): Promise<AxlIdentity> {
    const res = await fetch(`${this.baseUrl}/topology`);
    if (!res.ok) {
      throw new Error(`AXL /topology failed (${res.status})`);
    }
    const data = (await res.json()) as { our_public_key: string; our_ipv6: string };
    return { peerId: data.our_public_key, ipv6: data.our_ipv6 };
  }

  async send(peerId: string, message: unknown): Promise<void> {
    const body = Buffer.from(JSON.stringify(message), 'utf-8');
    const res = await fetch(`${this.baseUrl}/send`, {
      method: 'POST',
      headers: { 'X-Destination-Peer-Id': peerId },
      body,
    });
    if (!res.ok) {
      throw new Error(`AXL /send failed (${res.status}) to peer ${peerId}`);
    }
  }

  async recv(): Promise<AxlMessage | null> {
    const res = await fetch(`${this.baseUrl}/recv`);
    if (res.status === 204) return null;
    if (res.status === 200) {
      const fromPeerId = res.headers.get('x-from-peer-id') ?? '';
      const buf = await res.arrayBuffer();
      const payload = JSON.parse(Buffer.from(buf).toString('utf-8')) as unknown;
      return { fromPeerId, payload };
    }
    throw new Error(`AXL /recv unexpected status ${res.status}`);
  }

  async recvWait(timeoutMs = 30_000, pollIntervalMs = 200): Promise<AxlMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msg = await this.recv();
      if (msg !== null) return msg;
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    throw new Error('AXL recv timeout');
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/topology`);
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async mcpCall(peerId: string, service: string, method: string, params: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/mcp/${peerId}/${service}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, id: Date.now(), params }),
    });
    const data = (await res.json()) as { result?: unknown; error?: { message: string } };
    if (data.error) {
      throw new Error(`AXL MCP error from ${peerId}/${service}: ${data.error.message}`);
    }
    return data.result;
  }
}

export function createAxlTransport(baseUrl?: string): AxlTransport {
  return new AxlTransport(baseUrl);
}
