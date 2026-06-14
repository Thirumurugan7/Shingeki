# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] — 2026-06-15

### Added
- **Sigli financial-controls layer** (`sigli/controls`) — give every agent an identity, a scoped wallet, a runtime-enforced policy, and an audit trail.
  - `ControlPlane` — one object tying identity + wallet + policy + audit together; `authorize()` evaluates a spend, debits the wallet only on approval, and records the outcome. Mirrors the product API (`registerAgent` ≈ `POST /agents`, `setPolicy` ≈ `POST /agents/:id/policy`, `audit` ≈ `GET /agents/:id/audit`).
  - `evaluatePolicy` — pure, deterministic policy engine: spend limit, velocity cap over a rolling window, approved-counterparty allow-list, escalation threshold. Returns `APPROVED` / `ESCALATED` / `BLOCKED`.
  - `AgentWallet` — scoped ledger held in integer minor units (cents); cannot overdraw.
  - `AgentRegistry` — named agent identities with lifecycle status.
  - `AuditLog` — append-only trail with monotonic seq, `exportJSON` / `exportCSV`, and per-agent summaries.
  - Optional durable persistence via `persistDir` + `ControlPlane.load(dir)` (atomic writes).
- `NodeRuntime` now accepts an optional `{ plane, agentId }` so an agent's financial tool calls (`{"tool":"spend",...}` and authorized `uniswap_quote`) are governed and audited before they execute.
- Subpath export `sigli/controls`.

### Changed
- **Renamed `shingeki` → `sigli`** (package name, `sigli` bin, repo, brand strings, public `SigliKv`). Repositioned as financial controls for AI agents, layered on the mesh/0G execution engine.
- Environment-variable prefix is now `SIGLI_`; existing `SHINGEKI_*` variables still work via a startup compatibility shim that mirrors both prefixes.

## [0.1.1] — 2026-05-03

### Fixed
- `listCheckpointSummaries` crashed with `TypeError: Cannot read properties of undefined (reading 'replace')` when a checkpoint was written without a `summary` field — guarded with `?? ''`
- `DemoCheckpoint.summary` is now optional so user-constructed checkpoints don't require it

## [0.1.0] — 2026-05-03

### Added
- `MeshOrchestrator` — parallel competition on step 1, domain-aware round-robin for steps 2–N, retry fallback
- `NodeRuntime` — executes one plan step via 0G Router with TEE verification
- Genome system — `genomeFromConfig`, `evaluateOutput`, `heuristicScore`, `applyMutation`, `mutateGenome`
- Two-path fitness scorer: fast heuristic pre-filter + TEE-verified LLM judge (fires only when score < threshold)
- Genome mutation: cycles `prompt → model → strategy` on low-fitness output; lineage recorded
- `MeshHub` — WebSocket + HTTP coordination hub with `/health`, `/ready`, `/metrics`, `/status`, `/lineage`, `/viewer`, `POST /api/run`
- `runWorkerHost` — worker with capability advertisement, exponential backoff reconnect
- AXL P2P transport (`AxlTransport`, `runAxlWorkerHost`, `runAxlOrchestratorSession`) — broker-free via Gensyn sidecar
- 0G Router integration — every LLM call TEE-attested, fastest provider auto-selected
- 0G Log Store — append-only per-step execution trace (input, output, TEE flag, rootHash)
- 0G KV Store — final genome checkpoint after task completes
- Uniswap Trade API client — `getUniswapQuote`, `buildUniswapSwap`, `checkUniswapApproval`
- Embedded tool call protocol — LLM embeds `{"tool":"uniswap_quote",...}` JSON; NodeRuntime detects and executes
- Built-in preset plans: GPU research, Japan trip, DeFi swap analysis
- `splitCompoundTask` — free-form string → domain-tagged Plan
- Crash-recovery checkpoints — `writeCheckpointAtomic`, `readCheckpoint`, `--resume` CLI flag
- Self-contained genome lineage browser viewer at `/viewer`
- CLI: `demo`, `run`, `hub`, `node` subcommands
- Public SDK barrel (`src/index.ts`) with full TypeScript types and declaration maps
- Subpath exports: `shingeki`, `shingeki/genome`, `shingeki/tools`, `shingeki/coordination`, `shingeki/types`
