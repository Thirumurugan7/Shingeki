/** 0G Log Store — append-only lineage blobs (execution traces). */
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import type { Wallet } from 'ethers';
import { indexerUploadRetryOpts } from './indexer-retry.js';
import type { ExecutionTraceEntry } from '../types.js';

export async function appendTrace(
  indexerRpc: string,
  rpcUrl: string,
  signer: Wallet,
  entry: ExecutionTraceEntry,
): Promise<{ rootHash: string; txHash: string }> {
  const indexer = new Indexer(indexerRpc);
  const bytes = new TextEncoder().encode(JSON.stringify(entry, null, 2));
  const mem = new MemData(bytes);
  const [, treeErr] = await mem.merkleTree();
  if (treeErr !== null) throw new Error(`merkle: ${treeErr}`);
  const [tx, err] = await indexer.upload(
    mem,
    rpcUrl,
    signer as never,
    undefined,
    indexerUploadRetryOpts(),
  );
  if (err !== null) throw new Error(`upload: ${err}`);
  const rootHash = 'rootHash' in tx ? tx.rootHash : tx.rootHashes[0];
  const txHash = 'txHash' in tx ? tx.txHash : tx.txHashes[0];
  return { rootHash, txHash };
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Bounded retries for flaky storage sync / network blips */
export async function appendTraceWithRetry(
  indexerRpc: string,
  rpcUrl: string,
  signer: Wallet,
  entry: ExecutionTraceEntry,
  options?: { retries?: number; baseDelayMs?: number },
): Promise<{ rootHash: string; txHash: string }> {
  const retries = options?.retries ?? 3;
  const base = options?.baseDelayMs ?? 400;
  let last: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      return await appendTrace(indexerRpc, rpcUrl, signer, entry);
    } catch (e: unknown) {
      last = e instanceof Error ? e : new Error(String(e));
      if (i < retries - 1) await sleep(base * (i + 1));
    }
  }
  throw last ?? new Error('appendTraceWithRetry failed');
}
