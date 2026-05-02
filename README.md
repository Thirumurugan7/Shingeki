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

## Architecture

> See [docs/architecture.md](docs/architecture.md)

## Example agent

> See [examples/research-agent](examples/research-agent)

## Status

🚧 Active development — built for OpenAgents Hackathon @ ETHGlobal

## License

MIT
