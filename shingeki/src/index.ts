/**
 * Shingeki public API — programmatic entry point.
 *
 * @example
 * ```ts
 * import { MeshOrchestrator, NodeRuntime, planResearchAnalyzeDecide } from 'shingeki';
 * import { genomeFromConfig } from 'shingeki/genome';
 * ```
 */

// Orchestrator
export { MeshOrchestrator, planToRequiredRoles } from './orchestrator/orchestrator.js';
export type { StepExecutor, ExecutePlanOptions } from './orchestrator/orchestrator.js';
export { splitCompoundTask } from './orchestrator/planner.js';

// Node runtime
export { NodeRuntime } from './node-runtime/runtime.js';
export type { NodeRuntimeOptions } from './node-runtime/runtime.js';

// Coordination hub + WebSocket layer
export { MeshHub } from './coordination/ws-hub.js';
export { runWorkerHost } from './coordination/worker-host.js';
export { createMeshStepExecutor, openOrchestratorSession, hubUrlFromEnv } from './coordination/mesh-orchestrator-ws.js';

// AXL P2P transport
export { AxlTransport, createAxlTransport } from './coordination/axl-transport.js';
export type { AxlIdentity, AxlMessage } from './coordination/axl-transport.js';
export { runAxlWorkerHost } from './coordination/axl-worker-host.js';
export type { AxlWorkerOptions } from './coordination/axl-worker-host.js';
export { runAxlOrchestratorSession, createAxlStepExecutor } from './coordination/axl-orchestrator.js';
export type { AxlOrchestratorSession, AxlOrchestratorSessionOptions } from './coordination/axl-orchestrator.js';

// Genome
export { genomeFromConfig } from './genome/schema.js';
export type { Genome, AgentMeshConfig } from './genome/schema.js';
export { evaluateOutput, heuristicScore } from './genome/evaluate.js';
export { applyMutation, mutateGenome } from './genome/mutation.js';

// Uniswap tools
export { getUniswapQuote, buildUniswapSwap, checkUniswapApproval } from './tools/uniswap.js';
export type { UniswapQuoteParams, UniswapQuoteResult, UniswapSwapTx } from './tools/uniswap.js';

// Plans / presets
export {
  planResearchAnalyzeDecide,
  planJapanTrip,
  defiPlan,
  GPU_LLM_RESEARCH_GOAL,
  JAPAN_TRIP_GOAL,
  DEFI_SWAP_GOAL,
} from './planner/research-plan.js';

// Infra
export { writeCheckpointAtomic, readCheckpoint, listCheckpointSummaries, buildPriorContextFromResults } from './infra/checkpoint.js';
export type { DemoCheckpoint, CheckpointSummary } from './infra/checkpoint.js';
export { createLogger } from './infra/logger.js';

// Types
export type { Plan, Step, StepResult, NodeCapability, MeshMessage } from './types.js';
export type { NodeCapabilities } from './coordination/protocol.js';
