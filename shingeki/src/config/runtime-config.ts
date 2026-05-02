/**
 * Central runtime flags — fail fast in production for unsafe defaults.
 */
import fs from 'node:fs';

export function hubTlsCredentials(): { key: Buffer; cert: Buffer } | null {
  const certPath = process.env.SHINGEKI_HUB_TLS_CERT?.trim();
  const keyPath = process.env.SHINGEKI_HUB_TLS_KEY?.trim();
  if (!certPath || !keyPath) return null;
  try {
    return {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
  } catch (e) {
    throw new Error(
      `Failed to read TLS files (SHINGEKI_HUB_TLS_CERT / SHINGEKI_HUB_TLS_KEY): ${(e as Error).message}`,
    );
  }
}

export function isProduction(): boolean {
  const n = process.env.NODE_ENV?.toLowerCase();
  const s = process.env.SHINGEKI_ENV?.toLowerCase();
  return n === 'production' || s === 'production';
}

/** Hub must use shared secret when running in production profile */
export function assertHubProductionSafe(): void {
  if (!isProduction()) return;
  const t = process.env.SHINGEKI_HUB_TOKEN?.trim();
  if (!t) {
    throw new Error(
      'SHINGEKI_HUB_TOKEN is required when NODE_ENV or SHINGEKI_ENV is production (hub auth cannot be disabled)',
    );
  }
}

/** Worker / orchestrator clients must present token in production */
export function assertMeshClientProductionSafe(): void {
  if (!isProduction()) return;
  if (!process.env.SHINGEKI_HUB_TOKEN?.trim()) {
    throw new Error(
      'SHINGEKI_HUB_TOKEN is required when NODE_ENV or SHINGEKI_ENV is production (mesh clients)',
    );
  }
}

export function hubPort(): number {
  const p = Number(process.env.SHINGEKI_HUB_PORT ?? '8765');
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid SHINGEKI_HUB_PORT: ${process.env.SHINGEKI_HUB_PORT}`);
  }
  return p;
}

export function hubMaxPayloadBytes(): number {
  const raw = process.env.SHINGEKI_HUB_MAX_PAYLOAD_BYTES;
  if (raw == null || raw === '') return 2_097_152; // 2 MiB
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 4096 || n > 50 * 1024 * 1024) {
    throw new Error('SHINGEKI_HUB_MAX_PAYLOAD_BYTES must be between 4096 and 52428800');
  }
  return Math.floor(n);
}

/** Optional: /ready returns 503 until worker count >= this (useful for K8s rollout) */
export function hubReadyMinWorkers(): number | undefined {
  const raw = process.env.SHINGEKI_HUB_READY_MIN_WORKERS;
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10_000) {
    throw new Error('SHINGEKI_HUB_READY_MIN_WORKERS must be a non-negative integer');
  }
  return Math.floor(n);
}

export function routerTimeoutMs(): number {
  const raw = process.env.ROUTER_TIMEOUT_MS;
  if (raw == null || raw === '') return 120_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 5000 || n > 600_000) {
    throw new Error('ROUTER_TIMEOUT_MS must be between 5000 and 600000');
  }
  return Math.floor(n);
}

export function routerMaxRetries(): number {
  const raw = process.env.ROUTER_MAX_RETRIES;
  if (raw == null || raw === '') return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    throw new Error('ROUTER_MAX_RETRIES must be between 0 and 10');
  }
  return Math.floor(n);
}

/** Default: unlimited reconnects (Infinity). Set to 0 to disable reconnect after disconnect. */
export function workerReconnectMaxAttempts(): number {
  const raw = process.env.SHINGEKI_WORKER_RECONNECT_MAX;
  if (raw == null || raw === '') return Number.POSITIVE_INFINITY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('SHINGEKI_WORKER_RECONNECT_MAX must be >= 0');
  }
  return Math.floor(n);
}

export function workerReconnectBaseMs(): number {
  const raw = process.env.SHINGEKI_WORKER_RECONNECT_BASE_MS;
  if (raw == null || raw === '') return 1000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 200 || n > 60_000) {
    throw new Error('SHINGEKI_WORKER_RECONNECT_BASE_MS must be between 200 and 60000');
  }
  return Math.floor(n);
}

export function orchConnectRetries(): number {
  const raw = process.env.SHINGEKI_ORCH_CONNECT_RETRIES;
  if (raw == null || raw === '') return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new Error('SHINGEKI_ORCH_CONNECT_RETRIES must be between 1 and 100');
  }
  return Math.floor(n);
}
