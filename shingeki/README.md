# 進撃 Shingeki
> Agents that always move forward.

Shingeki is a distributed cognitive mesh where multiple AI agent nodes collaborate to solve multi-step tasks, with every decision verifiable on-chain. Unlike single-agent frameworks that run one LLM call after another, Shingeki routes steps across a live network of nodes that compete on quality, evolve their genome when output falls below threshold, and log every trace to 0G's tamper-proof storage — so any participant can independently verify what ran, on what model, and with what result.

---

## What makes it different

| Framework | Architecture | Evolution | Verified |
|-----------|-------------|-----------|----------|
| LangChain | Single chain, single node | Static prompts | No |
| AutoGen | Agent pairs, static roles | Static | No |
| CrewAI | Fixed crew, sequential | Static | No |
| **Shingeki** | **Distributed mesh** | **Genome-driven (live TEE scoring)** | **TEE ✓ + 0G Log Store** |

---

## How it works

**Genome.** Every node runs with a genome: a configuration object holding model, strategy, tools, reflection depth, and mutation rate. The genome is the agent's identity — what it does and how it thinks. It starts from `agentmesh.example.yaml` and mutates automatically when output quality drops below a configurable threshold.

**Mesh.** The orchestrator dispatches plan steps across a network of nodes over WebSocket. Step 1 runs on all available nodes in parallel (competition): each node produces a response, a fitness scorer picks the best, and the winner's output chains into step 2. Subsequent steps use round-robin routing with retry fallback and domain-aware node selection (nodes advertise specializations like `research` or `planning`).

**Evolution.** After every step, the output is evaluated via a two-path fitness scorer: a fast heuristic pre-filter (structural signals — length, bullets, tables, domain keywords), and a TEE-verified LLM judge that runs only when the heuristic score falls below threshold. If the score is too low, the genome mutates — the next step uses the evolved configuration. Every mutation is recorded to the lineage store, visible live in the browser viewer.

---

## Quick start

### Prerequisites
- Node.js ≥ 22
- `ROUTER_API_KEY` from [pc.0g.ai](https://pc.0g.ai) → Dashboard → API Keys
- Copy `.env.example` → `.env` and fill in `ROUTER_API_KEY`

```bash
cd shingeki
cp ../.env.example ../.env   # edit ROUTER_API_KEY
npm install
```

### Local mode (2 in-process nodes)

```bash
npm run demo
# Japan trip preset:
npm run demo -- --preset japan
# Resume after crash:
npm run demo -- --resume task-1746000000000
```

### Distributed mesh mode (4 terminals)

```bash
# Terminal 1 — coordination hub (auto-opens genome lineage viewer)
npm run hub

# Terminal 2 — worker A (research specialist)
NODE_ID=node-1 NODE_ROLE=executor NODE_SPECIALIZATION=research npm run node

# Terminal 3 — worker B (planning specialist)
NODE_ID=node-2 NODE_ROLE=reasoning NODE_SPECIALIZATION=planning npm run node

# Terminal 4 — orchestrator
npm run demo -- --mesh
```

### Lineage viewer

Opens automatically at `http://localhost:8765/viewer` when `npm run hub` starts.
The viewer polls `/lineage` every 3 seconds and renders a live tree of genome mutations with fitness bars, TEE verification badges, and parent→child arrows.

---

## Architecture

```
shingeki/src/
├── og/
│   ├── compute-router.ts   0G Router inference (circuit breaker, retries, TEE)
│   ├── kv.ts               0G KV — genome checkpoint after task completes
│   └── log.ts              0G Log Store — per-step execution trace (append-only)
├── genome/
│   ├── schema.ts           Genome type + YAML config loader
│   ├── evaluate.ts         Two-path fitness scorer (heuristic + LLM judge)
│   └── mutation.ts         Genome mutation and variant promotion
├── orchestrator/
│   ├── orchestrator.ts     MeshOrchestrator — parallel competition + evolution + domain routing
│   └── planner.ts          Compound-task splitter
├── node-runtime/
│   └── runtime.ts          NodeRuntime — executes one plan step via Router
├── coordination/
│   ├── ws-hub.ts           MeshHub — WS + HTTP (/health /ready /metrics /status /lineage /viewer)
│   ├── worker-host.ts      Worker with capability advertisement + exponential backoff reconnect
│   ├── mesh-orchestrator-ws.ts  Orchestrator WS client + step executor
│   └── protocol.ts         Message encode/parse + NodeCapabilities type
├── planner/
│   └── research-plan.ts    GPU research plan + Japan trip plan (demo presets, domain-tagged steps)
├── infra/
│   ├── checkpoint.ts       Atomic crash-recovery checkpoints
│   ├── lineage-store.ts    In-process genome lineage store
│   └── logger.ts           Structured JSON logs (LOG_LEVEL, LOG_PRETTY)
├── config/
│   ├── runtime-config.ts   All env vars with bounds validation
│   └── env-check.ts        Pre-flight env check (fails fast before expensive ops)
├── mesh/viz.ts             ASCII mesh status for terminal demos
├── viewer/index.html       Self-contained genome lineage browser viewer
└── cli.ts                  CLI: demo | hub | node
```

---

## 0G Integration

| 0G Primitive | Used for | When |
|---|---|---|
| **0G Router** (`router-api.0g.ai/v1`) | Every LLM step and fitness evaluation judge | Every plan step + evolution gate |
| **Router `verify_tee: true`** | Server-side TEE signature validation | Always on; result in `x_0g_trace.tee_verified` |
| **Router `provider: { sort: "latency" }`** | Automatic fastest-provider routing | Always on |
| **0G Log Store** | Per-step execution trace (input, output, TEE flag, rootHash) | After each completed step |
| **0G KV Store** | Final genome state checkpoint at task end | After `finalize()` |

### Fitness evaluation — two paths

| Path | Trigger | Cost | TEE-verified |
|---|---|---|---|
| Heuristic | Always (pre-filter) | 0 tokens | No |
| LLM judge | Score < threshold | ~128 tokens | Yes (`verify_tee: true`) |

The LLM judge sends a structured JSON system prompt and returns `{ score, reason }`. The `x_0g_trace.tee_verified` field on the Router response is stored on the `StepResult.evalResult` and included in the 0G Log Store entry.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ROUTER_API_KEY` | — | Required. From pc.0g.ai → API Keys |
| `ROUTER_BASE_URL` | `https://router-api.0g.ai/v1` | Override for testnet |
| `PRIVATE_KEY` | — | Optional. Enables 0G Log + KV verification |
| `SHINGEKI_EVOLVE_THRESHOLD` | `0.55` | Fitness below this triggers genome mutation |
| `SHINGEKI_HUB_PORT` | `8765` | Hub WS + HTTP port |
| `SHINGEKI_HUB_TOKEN` | — | Shared secret (required in production) |
| `NODE_ID` | random | Worker node identity |
| `NODE_ROLE` | `general` | `executor` \| `reasoning` \| `memory` \| `general` |
| `NODE_SPECIALIZATION` | — | Comma-separated: `research,planning,coding` |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_PRETTY` | — | Set to `1` for human-readable logs |

---

## License

MIT
