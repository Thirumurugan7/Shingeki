/**
 * Sigli public API — programmatic entry point.
 *
 * Sigli gives every agent a wallet, a policy, and an audit trail, layered on a
 * distributed mesh that executes and verifies each step.
 *
 * @example
 * ```ts
 * import { ControlPlane, MeshOrchestrator, NodeRuntime } from 'sigli';
 * import { evaluatePolicy } from 'sigli/controls';
 * ```
 */

// Mirror SIGLI_* ↔ SHINGEKI_* env vars before anything reads them.
import './config/env-compat.js';

// Orchestrator
export { MeshOrchestrator, planToRequiredRoles } from './orchestrator/orchestrator.js';
export type { StepExecutor, ExecutePlanOptions } from './orchestrator/orchestrator.js';
export { splitCompoundTask } from './orchestrator/planner.js';

// Node runtime
export { NodeRuntime } from './node-runtime/runtime.js';
export type { NodeRuntimeOptions, NodeControls } from './node-runtime/runtime.js';

// Sigli financial-controls layer
export {
  ControlPlane,
  CONTROL_PLANE_VERSION,
  AgentRegistry,
  AgentWallet,
  AuditLog,
  evaluatePolicy,
  VELOCITY_WINDOW_MS,
  toMinor,
  toMajor,
  round2,
} from './controls/index.js';
export type {
  ControlPlaneOptions,
  WalletState,
  WalletOptions,
  PolicyContext,
  AgentIdentity,
  AgentStatus,
  RegisterAgentInput,
  Velocity,
  PolicyDefinition,
  Outcome,
  ActionRequest,
  PolicyDecision,
  AuditEntry,
  AuditSummary,
} from './controls/index.js';

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
