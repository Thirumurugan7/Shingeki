# AXL P2P Transport (Gensyn)

AXL is the Gensyn P2P transport layer. When `AXL_ENABLED=true`, Shingeki replaces its WebSocket hub with direct peer-to-peer message passing via the AXL sidecar binary.

## Prerequisites

1. Install the AXL sidecar (Go binary from the Gensyn AXL repo):
   ```bash
   git clone https://github.com/gensyn-ai/axl
   cd axl
   go build -o axl-sidecar ./cmd/sidecar
   ```

2. Start the sidecar (default port 9002):
   ```bash
   ./axl-sidecar --port 9002
   ```

## Configuration

Set the following env vars (`.env` or shell):

| Variable | Required | Default | Description |
|---|---|---|---|
| `AXL_ENABLED` | yes | `false` | Set to `true` to activate AXL transport |
| `AXL_API_URL` | no | `http://127.0.0.1:9002` | AXL sidecar HTTP base URL |
| `AXL_HUB_PEER_ID` | node cmd | — | Hub machine's AXL peer ID |
| `AXL_WORKER_PEER_IDS` | run --mesh | — | Comma-separated worker peer IDs for orchestrator |

## Running the hub node (hub machine)

```bash
# Start AXL sidecar on hub machine
./axl-sidecar --port 9002

# Start Shingeki hub (still serves lineage viewer)
AXL_ENABLED=true npm run hub
# Logs: "AXL mode: workers connect via P2P. Hub AXL peer ID: <peer-id>"
# Copy that peer ID — workers need it as AXL_HUB_PEER_ID.
```

## Running worker nodes

On each worker machine:

```bash
# Start AXL sidecar
./axl-sidecar --port 9002

# Start worker (point to hub peer ID)
AXL_ENABLED=true \
AXL_HUB_PEER_ID=<hub-peer-id> \
NODE_ID=node-1 \
NODE_ROLE=executor \
npm run node
```

## Running the orchestrator (mesh run)

Collect peer IDs from all workers (printed at startup), then:

```bash
AXL_ENABLED=true \
AXL_WORKER_PEER_IDS=<worker1-peer-id>,<worker2-peer-id> \
npm run run -- --mesh --preset gpu
```

## Message protocol

All messages are JSON payloads sent over AXL `/send` / `/recv` endpoints.

| Type | Direction | Payload |
|---|---|---|
| `NODE_JOIN` | worker → hub/orch | `{ nodeId, peerId, capabilities }` |
| `ORCH_JOIN` | orch → worker | `{ orchestratorPeerId }` |
| `TASK_ASSIGN` | orch → worker | `{ targetNodeId, step, priorContext, genome }` |
| `STEP_RESULT` | worker → orch | `StepResult` fields + `nodeId` |
| `HEARTBEAT` | worker → hub | `{ nodeId }` |
| `HEARTBEAT_ACK` | hub → worker | `{}` |

## AXL HTTP API (sidecar)

| Endpoint | Method | Description |
|---|---|---|
| `/topology` | GET | Returns `{ our_public_key, our_ipv6 }` — node identity |
| `/send` | POST | Send message; `X-Destination-Peer-Id` header, JSON body |
| `/recv` | GET | Receive next message; `204` = empty queue; `200` = raw payload bytes in body + sender peer ID in `X-From-Peer-Id` response header |
| `/mcp/{peer}/{service}` | POST | MCP call passthrough |
