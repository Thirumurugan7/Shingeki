# Sigli

> Financial controls for AI agents.

[![npm version](https://img.shields.io/npm/v/sigli)](https://www.npmjs.com/package/sigli)
[![license](https://img.shields.io/npm/l/sigli)](./LICENSE)
[![node](https://img.shields.io/node/v/sigli)](https://nodejs.org)

> **Status: alpha (0.2.x).** APIs may change between minor versions. Pin to an exact version for production use.

Sigli gives every agent a wallet, a policy, and an audit trail, so your institution can deploy autonomous AI without losing financial control. Expense policies, approval chains, and audit logs were all built assuming a person made the decision — when software acts autonomously, those controls no longer apply. Sigli closes that gap: every agent gets a named **identity**, a **scoped wallet** that cannot overdraw, a **policy enforced at the moment of action** (not reviewed after), and an **audit trail** that records which agent, which task, which policy check, and which outcome.

Underneath, Sigli runs on a distributed cognitive mesh: agent nodes collaborate on multi-step tasks, compete on quality, evolve their genome when output falls below threshold, and log every trace to 0G's tamper-proof storage. The control plane is the financial layer on top of that execution engine — so autonomous workflows that need to spend money (API calls, SaaS renewals, vendor payments, swaps) are safe to run in production.

Built for banks, insurers, asset managers, and enterprise AI teams.

---

## Why Sigli

| | Built-in controls | Spend governance | Verified execution |
|---|---|---|---|
| LangChain / AutoGen / CrewAI | None — orchestration only | None | No |
| Generic agent frameworks | Monitoring after the fact | Logged, not enforced | No |
| **Sigli** | **Identity + scoped wallet + policy + audit** | **Enforced at the moment of action** | **TEE ✓ + 0G Log Store** |

The difference between "we monitor our agents" and "our agents cannot violate financial policy by design" is the difference between a tool and infrastructure.

---

## Installation

```bash
npm install sigli
```

**Requirements:**
- Node.js ≥ 22
- A `ROUTER_API_KEY` from [pc.0g.ai](https://pc.0g.ai) → Dashboard → API Keys

---

## Quick start

### 1. Set your API key

```bash
# .env (or export in shell)
ROUTER_API_KEY=sk-your-key-here
```

### 2. Run the built-in demo (no code needed)

```bash
npx sigli demo                        # GPU research preset
npx sigli demo --preset japan         # 5-day Japan trip planner
npx sigli demo --preset defi          # DeFi swap analysis (needs UNISWAP_API_KEY)
npx sigli demo --resume task-<id>     # resume after crash
```

### 3. Run with your own task

```bash
npx sigli run --task "Compare the top 3 L2 networks for a DeFi app launch"
```

---

## Financial controls

One control plane for every agent your institution deploys. Up and running in three steps — and every decision is enforced in-process, before any transaction clears.

```ts
import { ControlPlane } from 'sigli/controls';

const plane = new ControlPlane({ currency: 'USD' });
```

### 1. Register your agent

Every agent gets a unique identity tied to its owner, purpose, and lifecycle status — a named, accountable actor, not a shared service account. Registering opens a scoped wallet for it.

```ts
// ≈ POST /agents
plane.registerAgent(
  { id: 'procurement-01', name: 'Procurement', owner: 'finance-team', purpose: 'vendor payments' },
  1000, // opening wallet balance
);
```

### 2. Set its financial policy

Define exactly what the agent is allowed to do: a per-action spend limit, a velocity cap over a rolling window, approved counterparties, and an escalation threshold above which a human must approve. Policy is enforced at runtime, not logged after.

```ts
// ≈ POST /agents/procurement-01/policy
plane.setPolicy('procurement-01', {
  spend_limit: 500,
  velocity: 'daily',
  velocity_cap: 500,        // defaults to spend_limit when omitted
  escalate_above: 250,
  approved_counterparties: ['acme-supplies', 'aws'],
});
```

### 3. Authorize spend — APPROVED, ESCALATED, or BLOCKED

`authorize()` is the hot path: it evaluates the request against the policy, debits the wallet **only on approval**, and records the outcome to the audit trail.

```ts
plane.authorize({ agentId: 'procurement-01', amount: 248, counterparty: 'acme-supplies', task: 'invoice #4821' });
// → { outcome: 'APPROVED',  rule: 'policy-ok' }            wallet: 1000 → 752

plane.authorize({ agentId: 'procurement-01', amount: 260, counterparty: 'aws', task: 'reserved capacity' });
// → { outcome: 'ESCALATED', rule: 'escalation-threshold' } wallet unchanged — human approval required

plane.authorize({ agentId: 'procurement-01', amount: 1200, counterparty: 'acme-supplies', task: 'bulk order' });
// → { outcome: 'BLOCKED',   rule: 'spend-limit' }          wallet unchanged
```

Decisions are deterministic. Hard limits (invalid amount, counterparty allow-list, spend limit, velocity cap, insufficient funds) block first; the escalation threshold is checked only on an otherwise-approvable spend.

### 4. Get a full audit trail

Every action is recorded with full context: agent, task, policy check, approval chain, outcome. Reviewable by internal audit, legal, and regulators — and exportable as JSON or CSV.

```ts
// ≈ GET /agents/procurement-01/audit
plane.auditSummary('procurement-01');
// → { actions: 3, approved: 1, escalated: 1, violations: 1 }

const csv = plane.exportAuditCSV('procurement-01');
```

### Durable persistence

Pass `persistDir` and the full plane (agents, policies, wallets, audit) is written atomically after every mutation, and reloads with state and the monotonic audit sequence intact.

```ts
const plane = new ControlPlane({ currency: 'USD', persistDir: '.sigli' });
// ...later, in another process:
const restored = ControlPlane.load('.sigli');
```

### Govern an agent's spend inside the mesh

Bind a `NodeRuntime` to the control plane and the agent's financial tool calls are authorized — and audited — before they execute. A blocked or escalated action is never carried out.

```ts
import { NodeRuntime } from 'sigli';

const runtime = new NodeRuntime(
  { nodeId: 'node-1' },
  genome,
  { plane, agentId: 'procurement-01' },
);
// When the LLM emits {"tool":"spend","amountUsd":120,"counterparty":"aws","memo":"..."}
// the runtime routes it through plane.authorize() and annotates the step output with the decision.
```

> **Money handling.** Balances are held internally as integer minor units (cents), so spend checks and ledger math are exact — never binary floats. Amounts in the public API are in the wallet's major units (e.g. USD).

---

## Programmatic usage

### Minimal — run a plan in-process

```ts
import 'dotenv/config';
import {
  MeshOrchestrator,
  NodeRuntime,
  planResearchAnalyzeDecide,
} from 'sigli';

const genome = {
  id: 'g1',
  model: 'qwen/qwen-2.5-7b-instruct',
  strategy: 'plan-execute-reflect',
  tools: ['web'],
  reflection_depth: 2,
  mutation_rate: 0.2,
};

const taskId = `task-${Date.now()}`;
const plan = planResearchAnalyzeDecide(taskId);

const nodes = [
  { id: 'node-1', capabilities: ['llm', 'research'], specialization: ['research'] },
  { id: 'node-2', capabilities: ['llm', 'planning'], specialization: ['planning'] },
];

const orch = new MeshOrchestrator(nodes);
let currentGenome = genome;

const results = await orch.executePlan(
  plan,
  async ({ node, step }) => {
    const runtime = new NodeRuntime({ nodeId: node.id }, currentGenome);
    return runtime.executeStep(step);
  },
  {
    log: (msg) => console.log(msg),
    onGenomeUpdate: (g) => { currentGenome = g; },
  },
);

console.log(results.at(-1)?.output);
```

### Load genome from YAML config

```ts
import { genomeFromConfig } from 'sigli';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';

const cfg = parse(readFileSync('agentmesh.example.yaml', 'utf8'));
const genome = genomeFromConfig(cfg);
```

`agentmesh.example.yaml` (included in the package):

```yaml
agent:
  name: research-agent
  strategy: plan-execute-reflect

genome:
  model: qwen/qwen-2.5-7b-instruct
  tools: [web, code]
  reflection_depth: 2
  mutation_rate: 0.2

mesh:
  min_nodes: 2
```

### Use a built-in preset plan

```ts
import {
  planResearchAnalyzeDecide, // 4-step GPU/research pipeline
  planJapanTrip,             // 6-step travel planner
  defiPlan,                  // 4-step DeFi swap analysis
  GPU_LLM_RESEARCH_GOAL,
  JAPAN_TRIP_GOAL,
  DEFI_SWAP_GOAL,
} from 'sigli';
```

### Split a free-form task into a plan

```ts
import { splitCompoundTask } from 'sigli';

const plan = splitCompoundTask(
  'task-001',
  'Research Ethereum L2s; Compare fees and TPS; Recommend the best one for a DeFi launch',
);
// plan.steps → [research step, planning step, planning step]
// each step has a domain tag: 'research' | 'planning' | 'coding' | 'defi' | 'general'
```

### Genome evolution — manual control

```ts
import { evaluateOutput, applyMutation } from 'sigli';

const result = await evaluateOutput(stepOutput, taskContext, 0.55);
// result.path === 'heuristic' | 'llm'
// result.score  0.0 – 1.0
// result.tee_verified  true when LLM judge path ran

if (result.score < 0.55) {
  const next = applyMutation(currentGenome);
  // next.id, next.model, next.strategy — one axis mutated
}
```

### Uniswap quote inside an agent step

The Uniswap tool is activated automatically when `genome.tools` includes `'uniswap'` and the LLM embeds a tool call in its response. You can also call it directly:

```ts
import { getUniswapQuote, buildUniswapSwap, checkUniswapApproval } from 'sigli';

// UNISWAP_API_KEY must be set
const quote = await getUniswapQuote({
  tokenIn:  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  tokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  amount:   '1000000000000000000',                        // 1 ETH in wei
  chainId:  1,
  swapper:  process.env.AGENT_WALLET ?? '0x000...001',
});

console.log(quote.routing);    // 'V3' | 'V4' | 'DUTCH_V2' | ...
console.log(quote.tokenOut.amount); // USDC amount out
console.log(quote.gasFeeUSD);  // estimated gas cost in USD

// Build the swap tx calldata (not submitted — return to wallet to sign)
const tx = await buildUniswapSwap(quote);
console.log(tx.to, tx.data, tx.value, tx.gasLimit);

// Check if token approval is needed first
const approval = await checkUniswapApproval(
  quote.tokenIn.token,
  quote.tokenIn.amount,
  process.env.AGENT_WALLET!,
  1,
);
if (approval) {
  // submit approval tx first, then tx above
}
```

**How the LLM triggers it automatically:** When `genome.tools` includes `'uniswap'`, the NodeRuntime scans the LLM's text output for embedded JSON of this shape and executes it:

```json
{
  "tool": "uniswap_quote",
  "tokenIn": "0xC02aaA...",
  "tokenOut": "0xA0b869...",
  "amount": "1000000000000000000",
  "chainId": 1,
  "swapper": "0xYourWallet"
}
```

The quote result is appended to the step output and logged to 0G Log Store.

### Crash recovery — checkpoints

```ts
import {
  writeCheckpointAtomic,
  readCheckpoint,
  listCheckpointSummaries,
  buildPriorContextFromResults,
} from 'sigli';

// List all saved tasks
const summaries = await listCheckpointSummaries('.checkpoints');

// Resume from a checkpoint
const saved = await readCheckpoint('.checkpoints', 'task-1234567890');
if (saved) {
  const priorContext = buildPriorContextFromResults(plan.steps, saved.results);
  // pass priorContext into executePlan options
}
```

---

## Distributed mesh mode

Run workers across multiple machines — each registers specializations and the orchestrator routes domain-tagged steps to the right node.

### Start the hub (machine 1)

```bash
SIGLI_HUB_TOKEN=my-secret npx sigli hub
# Opens lineage viewer at http://localhost:8765/viewer
```

### Start workers (machines 2 and 3)

```bash
# Worker A — research specialist
NODE_ID=node-1 NODE_ROLE=executor NODE_SPECIALIZATION=research \
  SIGLI_HUB_URL=ws://hub-host:8765 \
  SIGLI_HUB_TOKEN=my-secret \
  npx sigli node

# Worker B — planning specialist
NODE_ID=node-2 NODE_ROLE=reasoning NODE_SPECIALIZATION=planning \
  SIGLI_HUB_URL=ws://hub-host:8765 \
  SIGLI_HUB_TOKEN=my-secret \
  npx sigli node
```

### Run a task against the mesh (machine 4)

```bash
SIGLI_HUB_URL=ws://hub-host:8765 \
  SIGLI_HUB_TOKEN=my-secret \
  npx sigli demo --mesh
```

### Programmatic distributed execution

```ts
import {
  openOrchestratorSession,
  createMeshStepExecutor,
  hubUrlFromEnv,
  MeshOrchestrator,
} from 'sigli';

const ws = await openOrchestratorSession(hubUrlFromEnv(), process.env.SIGLI_HUB_TOKEN);
const executor = createMeshStepExecutor(ws);

const orch = new MeshOrchestrator(nodes);
const results = await orch.executePlan(plan, executor);
ws.close();
```

### Hub HTTP endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | `{"ok":true}` |
| `/ready` | GET | `{"ready":true}` when ≥ min workers connected |
| `/metrics` | GET | Prometheus text format |
| `/status` | GET | JSON snapshot — workers, lineage count, uptime |
| `/lineage` | GET | Full genome lineage array |
| `/viewer` | GET | Self-contained browser lineage viewer |
| `/checkpoints` | GET | List task checkpoint summaries |
| `/checkpoint?id=task-…` | GET | Single checkpoint JSON |
| `/api/run` | POST | Submit a task over HTTP (returns step results) |

---

## AXL P2P transport (Gensyn)

Replace the WebSocket hub with broker-free peer-to-peer transport via a Gensyn AXL sidecar.

```bash
# Enable on hub
AXL_ENABLED=true npx sigli hub

# Enable on worker (needs the hub's peer ID)
AXL_ENABLED=true AXL_HUB_PEER_ID=<hub-peer-id> npx sigli node

# Enable on orchestrator
AXL_ENABLED=true AXL_WORKER_PEER_IDS=<id1,id2> npx sigli demo --mesh
```

```ts
import { createAxlTransport, runAxlWorkerHost, runAxlOrchestratorSession } from 'sigli';

const axl = createAxlTransport('http://127.0.0.1:9002');
const identity = await axl.getIdentity();
console.log(identity.peerId); // share this with workers
```

See [`axl/README.md`](https://github.com/thirumurugan7/sigli/blob/main/axl/README.md) for the full sidecar setup.

---

## 0G integration

| 0G Primitive | Used for | When |
|---|---|---|
| **0G Router** (`router-api.0g.ai/v1`) | Every LLM call + fitness judge | Every plan step |
| **`verify_tee: true`** | Server-side TEE attestation | Always on — stored in `StepResult.evalResult.tee_verified` |
| **`provider: { sort: "latency" }`** | Auto fastest-provider routing | Always on |
| **0G Log Store** | Per-step trace: input, output, TEE flag, rootHash | After each completed step |
| **0G KV Store** | Final genome checkpoint | After `finalize()` |

Enable on-chain verification by adding to `.env`:

```bash
PRIVATE_KEY=0xYourWalletKey
BLOCKCHAIN_RPC=https://evmrpc-testnet.0g.ai
INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai
FLOW_CONTRACT=0x22e03a6a89b950f1c82ec5e74f8eca321a105296
KV_NODE_URL=http://3.101.147.150:6789
```

Without `PRIVATE_KEY`, all LLM calls still run through the 0G Router with TEE verification — only the Log Store and KV uploads are skipped.

---

## Environment variables

> **Rename note.** The documented prefix is now `SIGLI_`. Existing `SHINGEKI_*`
> variables still work — Sigli mirrors the two prefixes in both directions at
> startup, and whichever you set wins. New deployments should use `SIGLI_`.

| Variable | Default | Description |
|---|---|---|
| `ROUTER_API_KEY` | — | **Required.** From [pc.0g.ai](https://pc.0g.ai) → API Keys |
| `ROUTER_BASE_URL` | `https://router-api.0g.ai/v1` | Override for testnet: `https://router-api-testnet.integratenetwork.work/v1` |
| `PRIVATE_KEY` | — | Wallet key — enables 0G Log Store + KV uploads |
| `BLOCKCHAIN_RPC` | — | EVM RPC (required with `PRIVATE_KEY`) |
| `INDEXER_RPC` | — | 0G indexer URL (required with `PRIVATE_KEY`) |
| `FLOW_CONTRACT` | — | 0G Flow contract address |
| `KV_NODE_URL` | — | 0G KV node endpoint |
| `SIGLI_EVOLVE_THRESHOLD` | `0.55` | Fitness score below this triggers genome mutation |
| `SIGLI_HUB_PORT` | `8765` | Hub WebSocket + HTTP port |
| `SIGLI_HUB_HOST` | `0.0.0.0` | Hub bind address |
| `SIGLI_HUB_TOKEN` | — | Shared secret — **required when `NODE_ENV=production`** |
| `SIGLI_HUB_URL` | `ws://localhost:8765` | Hub URL for workers / orchestrators |
| `SIGLI_AGENTMESH_CONFIG` | `agentmesh.example.yaml` | Path to custom genome YAML |
| `SIGLI_CHECKPOINT_DIR` | `.checkpoints/` | Directory for crash-recovery checkpoints |
| `NODE_ID` | random UUID | Worker node identity |
| `NODE_ROLE` | `general` | `executor` \| `critic` \| `reasoning` \| `memory` \| `general` |
| `NODE_SPECIALIZATION` | — | Comma-separated: `research,planning,coding,defi` |
| `UNISWAP_API_KEY` | — | Required for DeFi preset. From [developers.uniswap.org](https://developers.uniswap.org/dashboard) |
| `AGENT_WALLET` | `0x000…001` | Wallet address sent as `swapper` in Uniswap quote requests |
| `AXL_ENABLED` | `false` | `true` → use Gensyn AXL P2P instead of WebSocket hub |
| `AXL_API_URL` | `http://127.0.0.1:9002` | AXL sidecar base URL |
| `AXL_HUB_PEER_ID` | — | Hub peer ID (required for workers when AXL enabled) |
| `AXL_WORKER_PEER_IDS` | — | Comma-separated worker peer IDs for `run --mesh` with AXL |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_PRETTY` | — | `1` → human-readable logs |

---

## API reference

### Orchestration

```ts
import {
  MeshOrchestrator,      // core — runs a Plan across nodes
  planToRequiredRoles,   // infer how many nodes a Plan needs
  splitCompoundTask,     // split a free-form string into a Plan
} from 'sigli';
```

### Node runtime

```ts
import { NodeRuntime } from 'sigli';
// NodeRuntime({ nodeId }, genome).executeStep(step) → StepResult
// NodeRuntime({ nodeId }, genome, { plane, agentId }) → spend governed by the control plane
```

### Financial controls

```ts
import {
  ControlPlane,     // identity + wallet + policy + audit, one object
  AgentRegistry,    // agent identities (used internally by ControlPlane)
  AgentWallet,      // scoped, non-overdrawing ledger (integer minor units)
  AuditLog,         // append-only trail with JSON/CSV export
  evaluatePolicy,   // pure policy engine → PolicyDecision
} from 'sigli/controls'; // also re-exported from 'sigli'

import type {
  AgentIdentity, AgentStatus, RegisterAgentInput,
  PolicyDefinition, Velocity, ActionRequest,
  PolicyDecision, Outcome, AuditEntry, AuditSummary,
} from 'sigli/controls';
```

`ControlPlane` methods: `registerAgent`, `setAgentStatus`, `listAgents`, `getAgent`,
`setPolicy`, `getPolicy`, `fundWallet`, `walletOf`, `authorize`, `audit`,
`auditSummary`, `exportAuditJSON`, `exportAuditCSV`, and the static `ControlPlane.load(dir)`.

### Genome

```ts
import {
  genomeFromConfig,  // parse agentmesh.yaml → Genome
  evaluateOutput,   // two-path scorer → EvaluationResult
  heuristicScore,   // synchronous fast path only
  applyMutation,    // mutate one axis → new Genome
  mutateGenome,     // returns all three variant candidates
} from 'sigli';
```

### Coordination (WebSocket mesh)

```ts
import {
  MeshHub,                    // hub server
  runWorkerHost,              // worker with auto-reconnect
  openOrchestratorSession,    // open WS session as orchestrator
  createMeshStepExecutor,     // step executor over existing WS
  hubUrlFromEnv,              // reads SIGLI_HUB_URL
} from 'sigli';
```

### Coordination (AXL P2P)

```ts
import {
  AxlTransport,
  createAxlTransport,
  runAxlWorkerHost,
  runAxlOrchestratorSession,
  createAxlStepExecutor,
} from 'sigli';
```

### Uniswap tools

```ts
import {
  getUniswapQuote,       // POST /v1/quote
  buildUniswapSwap,      // POST /v1/swap → calldata
  checkUniswapApproval,  // POST /v1/check_approval
} from 'sigli';
```

### Plans / presets

```ts
import {
  planResearchAnalyzeDecide,
  planJapanTrip,
  defiPlan,
  GPU_LLM_RESEARCH_GOAL,
  JAPAN_TRIP_GOAL,
  DEFI_SWAP_GOAL,
} from 'sigli';
```

### Infra

```ts
import {
  writeCheckpointAtomic,
  readCheckpoint,
  listCheckpointSummaries,
  buildPriorContextFromResults,
  createLogger,
} from 'sigli';
```

### Types

```ts
import type {
  Genome,
  Plan,
  Step,
  StepResult,
  NodeCapability,
  NodeCapabilities,
  MeshMessage,
  EvaluationResult,
  LineageEntry,
} from 'sigli';
```

---

## CLI reference

```
sigli demo [options]         Run a task locally with in-process nodes
sigli run  [options]         Run a task (local or mesh)
sigli hub  [options]         Start the coordination hub + viewer
sigli node [options]         Start a worker node

Options (demo / run):
  --preset <gpu|japan|defi>     Use a built-in task preset
  --task <"...">                Free-form task string
  --mesh                        Route via hub instead of in-process
  --resume <task-id>            Resume from checkpoint

Options (hub):
  (configured entirely via env vars — see table above)

Options (node):
  (NODE_ID, NODE_ROLE, NODE_SPECIALIZATION env vars)
```

---

## Source layout

```
src/
├── controls/            Sigli control plane — identity, wallet, policy, audit
├── og/                  0G Router, Log Store, KV Store
├── genome/              Schema, two-path fitness scorer, mutation
├── orchestrator/        MeshOrchestrator, compound-task planner
├── node-runtime/        NodeRuntime — executes one step via Router
├── coordination/        WebSocket hub, worker host, AXL transport
├── planner/             Built-in preset plans (GPU, Japan, DeFi)
├── tools/               Uniswap Trade API client
├── infra/               Checkpoints, lineage store, logger
├── config/              Env var validation, pre-flight check, rename shim
├── mesh/                ASCII mesh status renderer
├── viewer/              Self-contained browser lineage viewer
└── cli.ts               CLI entry point
```

---

## License

MIT © [thirumurugan7](https://github.com/thirumurugan7)
