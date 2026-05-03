# Changelog

All notable changes to this project will be documented in this file.

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
