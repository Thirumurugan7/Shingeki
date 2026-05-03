# Shingeki — Hackathon Submission Feedback

## What we built

**Shingeki** is a distributed cognitive mesh where autonomous AI agents self-organize, compete on each step, and evolve their inference strategy using 0G Router for verifiable, TEE-backed LLM inference.

Key features implemented for this submission:
- Multi-step reasoning pipeline with genome evolution (prompt/model/strategy mutation on low-fitness steps)
- 0G Router integration for all LLM inference (verifiable compute with TEE traces)
- 0G Log Store for on-chain step verification
- 0G KV Store for genome checkpointing
- WebSocket mesh hub (real-time lineage viewer with genome evolution visualization)
- Durable checkpoints (crash-safe; resume mid-plan)
- **Uniswap Trade API integration** — DeFi preset: market research → live swap quote → swap recommendation
- **Gensyn AXL P2P transport** — fully decentralized worker coordination without a central WebSocket hub

## Integrations

### 0G (Core)
- **0G Router**: all LLM inference routed through `compute-router.ts` with TEE verification traces
- **0G Log Store**: every step result appended on-chain via `appendTraceWithRetry`
- **0G KV Store**: genome state persisted per-task after finalization

### Uniswap Trade API
- `src/tools/uniswap.ts`: `getUniswapQuote` (routing-aware), `buildUniswapSwap`, `checkUniswapApproval`
- Dutch routing guard: DUTCH_V2/V3/PRIORITY routes rejected with actionable error
- `--preset defi` CLI flag: 3-step plan (market research → Uniswap quote → swap decision)
- Env: `UNISWAP_API_KEY`, `AGENT_WALLET`

### Gensyn AXL P2P
- `src/coordination/axl-transport.ts`: full AXL HTTP sidecar client (send/recv/identity/mcp)
- `src/coordination/axl-worker-host.ts`: worker runs over P2P — no WebSocket hub needed
- `src/coordination/axl-orchestrator.ts`: orchestrator discovers workers via AXL peer IDs
- `AXL_ENABLED=true` flag activates AXL transport in all three CLI commands (hub/node/run --mesh)
- See `axl/README.md` for setup instructions

## What we learned

Building a multi-agent mesh where every LLM call is verifiable on-chain required rethinking how we handle latency, retries, and step chaining. The genome evolution system — where low-scoring steps trigger automatic strategy/model/prompt mutation — made the system genuinely adaptive rather than just a static pipeline.

The AXL integration showed how P2P transport can fully replace a centralized coordination layer, which is important for truly decentralized agent networks.

## What's next

- Live Uniswap swap execution (currently recommends only)
- Cross-mesh genome sharing via 0G KV (agents learn from each other's lineage)
- Broader AXL mesh topologies (multi-hop routing, DHT-based node discovery)
