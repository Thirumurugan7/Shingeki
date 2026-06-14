# 進撃 Shingeki

> *Agents that always move forward.*

[![npm version](https://img.shields.io/npm/v/shingeki)](https://www.npmjs.com/package/shingeki)
[![license](https://img.shields.io/npm/l/shingeki)](./shingeki/LICENSE)
[![node](https://img.shields.io/node/v/shingeki)](https://nodejs.org)

**Shingeki** is a distributed cognitive mesh — multiple AI agent nodes collaborate on multi-step tasks, competing on quality, evolving their genomes when output falls below threshold, and logging every decision to 0G's tamper-proof storage. Unlike single-agent frameworks, every inference is TEE-attested on-chain.

---

## What makes it different

| Framework | Architecture | Evolution | Verified |
|---|---|---|---|
| LangChain | Single chain | Static prompts | No |
| AutoGen | Agent pairs, static roles | Static | No |
| CrewAI | Fixed crew, sequential | Static | No |
| **Shingeki** | **Distributed mesh** | **Genome-driven (live TEE scoring)** | **TEE + 0G Log Store + KV** |

---

## Core concepts

- **Genome** — typed, versioned agent definition: model, strategy, tools, reflection depth, mutation rate
- **Mesh** — plan steps dispatched across nodes by domain tag (`research`, `planning`, `coding`, `defi`)
- **Evolution** — step output scored by heuristic fast-path or TEE-verified LLM judge; if score < threshold, one genome axis mutates (prompt → model → strategy, cycling)
- **0G Compute** — every LLM call routed through 0G Router with `verify_tee: true` and `provider.sort: "latency"`
- **0G Storage** — per-step execution trace (input, output, TEE flag) uploaded to 0G Log Store as Merkle blob
- **0G KV** — final genome checkpoint written after task completion using `Batcher` CAS pattern
- **AXL P2P** — broker-free coordination via Gensyn AXL sidecar (replaces WebSocket hub)

---

## Quick start

```bash
cd shingeki && npm install

# Local in-process run (no hub needed)
npm run run

# Full distributed mesh
npm run hub                           # terminal 1
NODE_ID=node-1 npm run node           # terminal 2
NODE_ID=node-2 npm run node           # terminal 3
npm run run -- --mesh                 # terminal 4
```

**Required env** (`shingeki/.env`):

```bash
ROUTER_API_KEY=sk-your-key
ROUTER_BASE_URL=https://router-api-testnet.integratenetwork.work/v1

# For on-chain Log Store + KV (enables full verification)
PRIVATE_KEY=0xYourWalletKey
BLOCKCHAIN_RPC=https://evmrpc-testnet.0g.ai
INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
FLOW_CONTRACT=0x22e03a6a89b950f1c82ec5e74f8eca321a105296
KV_NODE_URL=http://127.0.0.1:6789

# For DeFi preset
UNISWAP_APIKEY=your-uniswap-key

```

---

## Source layout

```
shingeki/src/
├── og/
│   ├── compute-router.ts    0G Router — every LLM call, TEE attestation, circuit breaker
│   ├── log.ts               0G Log Store — per-step Merkle blob upload → rootHash + txHash
│   ├── kv.ts                0G KV Store — Batcher CAS write, final genome checkpoint
│   └── indexer-retry.ts     Upload retry with exponential backoff
├── genome/
│   ├── schema.ts            Genome type, genomeFromConfig (YAML)
│   ├── evaluate.ts          Two-path scorer: heuristic (sync) + LLM judge (TEE-verified)
│   └── mutation.ts          applyMutation — cycles prompt → model → strategy axes
├── orchestrator/
│   ├── orchestrator.ts      MeshOrchestrator — parallel step-1 competition, domain round-robin
│   └── planner.ts           planResearchAnalyzeDecide, splitCompoundTask, planToRequiredRoles
├── node-runtime/
│   └── runtime.ts           NodeRuntime — executes one step, calls Router, detects tool calls
├── coordination/
│   ├── ws-hub.ts            MeshHub — WebSocket + HTTP (health, metrics, viewer, /api/run)
│   ├── worker-host.ts       runWorkerHost — capability advertisement, reconnect backoff
│   ├── axl-transport.ts     AxlTransport — Gensyn AXL sidecar (/topology, /send, /recv)
│   ├── axl-worker-host.ts   runAxlWorkerHost — AXL-based worker
│   └── axl-orchestrator.ts  runAxlOrchestratorSession — broker-free orchestration
├── tools/
│   └── uniswap.ts           getUniswapQuote, buildUniswapSwap, checkUniswapApproval
├── infra/
│   ├── checkpoint.ts        writeCheckpointAtomic, readCheckpoint, listCheckpointSummaries
│   ├── lineage-store.ts     In-memory lineage tree with hub broadcast
│   └── logger.ts            Structured JSON logger
└── cli.ts                   CLI entry — demo, run, hub, node subcommands
```

---

## Implementation details

### 0G Compute — Router

**File:** `src/og/compute-router.ts`

Every LLM call hits the 0G Router with TEE attestation always on:

```typescript
body: JSON.stringify({
  model: opt.model ?? 'qwen/qwen-2.5-7b-instruct',
  messages,
  max_tokens: opt.max_tokens ?? 512,
  temperature: opt.temperature ?? 0.3,
  verify_tee: opt.verify_tee ?? true,     // always on
  provider: { sort: 'latency' },          // auto-select fastest provider
})
```

The Router returns `x_0g_trace` with: provider address, request ID, billing (aOG wei), and `tee_verified`. This trace is stored on `StepResult.teeTrace` and included in the Log Store upload.

**Circuit breaker:** 6 consecutive failures → 45s open window. Retries on 429/502/503/504/ECONNRESET with exponential backoff.

---

### 0G Storage — Log Store

**File:** `src/og/log.ts`

After each step completes, the execution trace is serialized, Merkle-hashed, and uploaded:

```typescript
const bytes = new TextEncoder().encode(JSON.stringify(entry, null, 2));
const mem = new MemData(bytes);
const [, treeErr] = await mem.merkleTree();
const [tx, err] = await indexer.upload(mem, rpcUrl, signer, undefined, retryOpts);
const rootHash = 'rootHash' in tx ? tx.rootHash : tx.rootHashes[0];
const txHash   = 'txHash'   in tx ? tx.txHash   : tx.txHashes[0];
```

Each blob contains: `{ step, node, input, output, signature: 'tee:router', timestamp }`.

- **Network:** 0G Testnet (Chain ID `16602`)
- **Flow contract:** `0x22e03a6a89b950f1c82ec5e74f8eca321a105296`
- **Indexer:** `https://indexer-storage-testnet-turbo.0g.ai`
- **Explorer:** `https://chainscan-galileo.0g.ai`

Upload has 3 retries with 400ms base delay.

---

### 0G KV Store — genome checkpoint

**File:** `src/og/kv.ts`

After `finalize()`, the current genome is written using optimistic concurrency (monotonic version = `Date.now()`):

```typescript
const STREAM_LABEL = 'shingeki:mesh:state:v1';
// streamId = ethers.id(STREAM_LABEL)  ← keccak256

batcher.streamDataBuilder.set(this.streamId, keyBytes, valBytes);
const [tx, batchErr] = await batcher.exec();
// returns { txHash }
```

- **Stream ID:** `ethers.id('shingeki:mesh:state:v1')`
- **Key pattern:** `genome/<taskId>`
- **KV node:** `KV_NODE_URL` env (default `http://127.0.0.1:6789`)

---

### Genome evolution

**Files:** `src/genome/evaluate.ts`, `src/genome/mutation.ts`

Two-path fitness scorer:

```
output → heuristicScore()
  ├── score ≥ threshold  →  return {score, path:'heuristic'}       (no extra LLM call)
  └── score < threshold  →  routerInfer(judgePrompt, verify_tee:true)
                            →  return {score, path:'llm', tee_verified:true}
```

Heuristic signals scored: Markdown headings, tables, bullet lists, code blocks, numbers/prices/percentages, domain keywords (VRAM, ETH, USDC, gas, gwei, APY, flight, hotel, budget, itinerary, yen).

Mutation cycles three axes in order: `prompt_variant → model → strategy`. Each mutation appends `.N` to the genome ID (e.g. `genome-v1` → `genome-v1.1`).

---

### AXL P2P transport — Gensyn

**File:** `src/coordination/axl-transport.ts`

Replaces the WebSocket hub with broker-free messaging via the Gensyn AXL sidecar:

```typescript
GET  /topology                           // → { peerId, ipv6 }
POST /send  + X-Destination-Peer-Id      // fire-and-forget to peer
GET  /recv                               // poll inbox — 200 message | 204 empty
```

- **Long-poll:** `recvWait()` polls every 200ms up to configurable timeout
- **Sidecar URL:** `AXL_API_URL` env (default `http://127.0.0.1:9002`)
- **Startup ordering:** orchestrator sends `ORCH_JOIN` first; workers reply `NODE_JOIN` re-ack to handle race condition

---

### Uniswap integration

**File:** `src/tools/uniswap.ts`

```typescript
POST https://trade-api.gateway.uniswap.org/v1/quote
POST https://trade-api.gateway.uniswap.org/v1/swap
POST https://trade-api.gateway.uniswap.org/v1/check_approval
```

Dutch routing guard rejects `DUTCH_V2`, `DUTCH_V3`, `PRIORITY` routing types (require Permit2 signature — incompatible with agent-only execution). Only classic `V2/V3/V4` supported.

**Embedded tool call:** When `genome.tools` includes `'uniswap'`, NodeRuntime scans LLM output for embedded JSON and executes it automatically:

```json
{ "tool": "uniswap_quote", "tokenIn": "0xC02a...", "tokenOut": "0xA0b8...",
  "amount": "1000000000000000000", "chainId": 1, "swapper": "0xYourWallet" }
```

---

## Live run verification — 0G Compute (Router TEE traces)

All LLM calls TEE-attested through 0G Router. `x_0g_trace` records from live runs (stored in `.checkpoints/`):

**Provider (all runs):** `0xa48f01287233509FD694a22Bf840225062E67836`

| Task | Step | Request ID | TEE | Total cost (aOG wei) |
|---|---|---|---|---|
| `task-1777775351634` | step-search | `8ed2a29e-6f31-4e4a-af8c-67080d525298` | ✓ | 18,350,000,000,000 |
| `task-1777775351634` | step-specs | `eb3ef001-4341-441f-96a2-1f17e08d8eaa` | ✓ | 36,800,000,000,000 |
| `task-1777797913828` | step-1 (LLM judge) | `d96c268f-0019-4253-84f6-d17c336ef43e` | ✓ | 6,950,000,000,000 |
| `task-1777798248693` | step-1 (LLM judge) | `55495f28-cb27-4162-9691-0c37f4b8f02e` | ✓ | 6,950,000,000,000 |
| `task-1777798279992` | step-1 (LLM judge) | `bb6b7d74-13d1-45c5-87ab-8595608436a8` | ✓ | 6,150,000,000,000 |
| `task-1777821390633` | step-1 | `7d06b964-c64d-480d-819b-a484dc24f1cf` | ✓ | 199,950,000,000,000 |

Rows 3–5 (`path: llm`) triggered the LLM judge path — heuristic score fell below 0.55, a second TEE-attested Router call ran as a quality judge, and `evalResult.tee_verified: true` was set on those results.

---

## Live run verification — 0G Storage (Log Store)

Each step execution trace uploaded to 0G Testnet Log Store after wallet was funded with testnet OG tokens. The `[Verification]` block printed per step:

```
[Verification]
  Step 1 logged to 0G
  Trace ID   : 0x<rootHash>        ← Merkle root — independently verifiable
  Router TEE : true
  Eval score : 0.85 (heuristic)
  Eval TEE   : false
```

Four steps × four runs = 16 blobs uploaded to the Log Store during hackathon testing. Each blob is a Merkle-attested JSON object containing the full step input, output, TEE flag, and timestamp.

**Verify on explorer:** `https://chainscan-galileo.0g.ai` → search by rootHash or wallet address `0x29cf2827f36f900ae10c2f67cb5cb05612e98346df346aa6d1832edf443a370d`

---

## Live run verification — 0G KV Store

After each task, `finalize()` writes the genome to the KV stream:

```
[0G KV] genome checkpoint written version <timestamp>
```

- **Stream:** `shingeki:mesh:state:v1`
- **Key:** `genome/<taskId>`
- **Network:** 0G Testnet (Chain ID `16602`)
- **Wallet:** `0x29cf2827...370d` (testnet only)

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     CLI / SDK User                        │
└────────────────────────┬─────────────────────────────────┘
                         │
               MeshOrchestrator
          (parallel compete step-1,
           domain round-robin steps 2–N)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
       node-1         node-2         node-N
     (research)     (planning)      (general)
          │              │              │
          └──────────────┴──────────────┘
                         │
                    NodeRuntime
                         │
          ┌──────────────┼──────────────────┐
          │              │                  │
    0G Router      heuristicScore /    Uniswap
   (TEE infer)    LLM judge (TEE)    Trade API
          │              │
          └──────┬────────┘
                 │
         ┌───────┴────────┐
         │                │
   0G Log Store      0G KV Store
   (per-step blob)  (genome final)
   rootHash+txHash   txHash
   (on-chain proof)
```

**Coordination** (choose one):

```
WebSocket hub  ←→  workers   (default, SHINGEKI_HUB_URL)
AXL sidecar    ←→  workers   (AXL_ENABLED=true, broker-free via Gensyn)
```

---

## npm package

```bash
npm install shingeki
```

Full API and programmatic usage: [shingeki/README.md](./shingeki/README.md)

---

## Status

Active development — built for ETHGlobal hackathon (0G Labs, Gensyn, Uniswap Foundation tracks).

## License

MIT © [thirumurugan7](https://github.com/thirumurugan7)
