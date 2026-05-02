# 進撃 Shingeki

> *Agents that always move forward.*

**Shingeki** is a self-organizing, genome-driven distributed agent mesh.  
Instead of running one agent on one machine, Shingeki compiles a single  
agent definition into a mesh of specialized nodes — each running a genome  
variant, coordinated through 0G Storage, evolving autonomously over time.

## What makes it different

| Framework | Architecture | Evolution | Coordination |
|---|---|---|---|
| OpenClaw | Single node | Static | Local |
| ZeroClaw | Single node | Static | Local |
| **Shingeki** | **Distributed mesh** | **Genome-driven** | **0G Storage** |

## Core concepts

- **Genome** — a typed, versioned agent definition (model, tools, reasoning strategy, memory)
- **Mesh** — agent splits across nodes dynamically based on capability advertising
- **Evolution** — underperforming nodes trigger mutation, better variants promoted
- **0G** — shared state and lineage tree stored on 0G Storage, inference on 0G Compute

## Quick start

```bash
npx shingeki init
```

### Runnable mesh demo (`shingeki/`)

```bash
cd shingeki && npm install && npm run demo
# parallel step-1 competition + live genome scoring/mutation + [Verification] / 0G traces

npm run hub
NODE_ID=node-1 npm run node   # terminal
NODE_ID=node-2 npm run node   # terminal
npm run demo -- --mesh
```

Env: `ROUTER_*`, optional `PRIVATE_KEY` for on-chain log/KV; `SHINGEKI_EVOLVE_THRESHOLD` (default `0.55`). For mesh, set the same `SHINGEKI_HUB_TOKEN` on hub, workers, and `demo --mesh` (required when `NODE_ENV` or `SHINGEKI_ENV` is `production`). The hub serves `GET /health`, `/ready`, Prometheus **`/metrics`**, and JSON **`/status`** on `SHINGEKI_HUB_PORT` (WebSocket upgrade on `/`). Optional TLS: set `SHINGEKI_HUB_TLS_CERT` + `SHINGEKI_HUB_TLS_KEY`. Crash recovery: each demo step writes **`shingeki/.checkpoints/<task>.json`** — resume with `demo --resume <task-id>` (same `--preset` / `--mesh` as before).

## Architecture

> See [docs/architecture.md](docs/architecture.md)

## Example agent

> See [examples/research-agent](examples/research-agent)

## Status

🚧 Active development — built for OpenAgents Hackathon @ ETHGlobal

## License

MIT
