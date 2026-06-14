/**
 * 0G KV — optimistic concurrency via monotonic version (Batcher pattern).
 */
import { Indexer, Batcher, KvClient, getFlowContract } from '@0gfoundation/0g-ts-sdk';
import { ethers, type Wallet } from 'ethers';

const STREAM_LABEL = 'shingeki:mesh:state:v1';

export interface KvEnv {
  rpcUrl: string;
  indexerRpc: string;
  flowContract: string;
  kvNodeUrl: string;
}

export function loadKvEnv(): KvEnv {
  return {
    rpcUrl: process.env.BLOCKCHAIN_RPC ?? 'https://evmrpc-testnet.0g.ai',
    indexerRpc: process.env.INDEXER_RPC ?? 'https://indexer-storage-testnet-turbo.0g.ai',
    flowContract: process.env.FLOW_CONTRACT ?? '0x22e03a6a89b950f1c82ec5e74f8eca321a105296',
    kvNodeUrl: process.env.KV_NODE_URL ?? 'http://127.0.0.1:6789',
  };
}

export class SigliKv {
  readonly streamId: `0x${string}`;

  constructor(
    private readonly signer: Wallet,
    private readonly env: KvEnv,
    streamLabel = STREAM_LABEL,
  ) {
    this.streamId = (streamLabel.startsWith('0x')
      ? streamLabel
      : ethers.id(streamLabel)) as `0x${string}`;
  }

  /** CAS-style write: use version strictly greater than any prior (e.g. Date.now()). */
  async setJson(key: string, value: unknown, version: number): Promise<{ txHash: string }> {
    const indexer = new Indexer(this.env.indexerRpc);
    const flowContract = getFlowContract(this.env.flowContract, this.signer as never);
    const [nodes, err] = await indexer.selectNodes(1);
    if (err !== null) throw new Error(`selectNodes: ${err}`);
    const batcher = new Batcher(version, nodes, flowContract, this.env.rpcUrl);
    const keyBytes = new TextEncoder().encode(key);
    const valBytes = new TextEncoder().encode(JSON.stringify(value));
    batcher.streamDataBuilder.set(this.streamId, keyBytes, valBytes);
    const [tx, batchErr] = await batcher.exec();
    if (batchErr !== null) throw new Error(`batcher: ${batchErr}`);
    return { txHash: tx.txHash };
  }

  async getJson<T = unknown>(key: string): Promise<T | null> {
    const client = new KvClient(this.env.kvNodeUrl);
    const keyBytes = new TextEncoder().encode(key);
    const result = await client.getValue(this.streamId, keyBytes);
    if (result === null) return null;
    const text = Buffer.from(result.data, 'base64').toString('utf-8');
    return JSON.parse(text) as T;
  }
}

/**
 * @deprecated Renamed to {@link SigliKv}. Kept as an alias so existing imports
 * (and the on-chain stream label) continue to work after the rebrand.
 */
export const ShingekiKv = SigliKv;
