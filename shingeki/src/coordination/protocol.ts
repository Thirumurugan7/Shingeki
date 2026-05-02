import type { MeshMessage } from '../types.js';

export function parseMessage(raw: string): MeshMessage | null {
  try {
    const o = JSON.parse(raw) as MeshMessage;
    if (o && typeof o.type === 'string' && 'payload' in o) return o;
  } catch {
    /* ignore */
  }
  return null;
}

export function encodeMessage<T>(type: MeshMessage['type'], payload: T): string {
  return JSON.stringify({ type, payload } satisfies MeshMessage<T>);
}
