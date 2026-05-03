/**
 * Indexer `upload()` retry options — align with @0gfoundation/0g-ts-sdk `RetryOpts`
 * (tx receipt polling + splitable data retries). Tunable via env.
 */
export function indexerUploadRetryOpts(): {
  Retries: number;
  Interval: number;
  MaxGasPrice: number;
  TooManyDataRetries: number;
} {
  return {
    Retries: numEnv('OG_INDEXER_TX_RETRIES', 10, 1, 100),
    Interval: numEnv('OG_INDEXER_RETRY_INTERVAL_SEC', 5, 1, 120),
    MaxGasPrice: numEnv('OG_INDEXER_MAX_GAS_PRICE_WEI', 0, 0, Number.MAX_SAFE_INTEGER),
    TooManyDataRetries: numEnv('OG_INDEXER_DATA_RETRIES', 5, 0, 50),
  };
}

function numEnv(
  name: string,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return defaultVal;
  return Math.floor(n);
}
