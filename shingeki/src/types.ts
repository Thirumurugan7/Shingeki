/** Mesh coordination — not on 0G (fast path). */

export type CoordinationEventType =
  | 'NODE_JOIN'
  | 'ORCH_JOIN'
  | 'ORCH_WORKERS'
  | 'TASK_ASSIGN'
  | 'STEP_RESULT'
  | 'NODE_FAIL'
  | 'RETRY'
  | 'HEARTBEAT'
  | 'GENOME_LINEAGE';

export interface MeshMessage<T = unknown> {
  type: CoordinationEventType;
  payload: T;
}

export interface EvaluationResult {
  score: number;
  reason?: string;
  tee_verified?: boolean;
  path: 'heuristic' | 'llm';
}

export interface LineageEntry {
  genome_id: string;
  parent_id?: string;
  model: string;
  strategy: string;
  fitness_score: number;
  tee_verified: boolean;
  timestamp: number;
  step_count: number;
}

export interface NodeCapability {
  id: string;
  capabilities: string[];
  latencyMs?: number;
  stake?: number;
  role?: string;
  specialization?: string[];
}

export interface Step {
  id: string;
  description: string;
  dependsOn?: string[];
  title?: string;
  role?: string;
  domain?: 'research' | 'coding' | 'planning' | 'general' | 'defi';
}

export interface Plan {
  taskId: string;
  steps: Step[];
}

export interface StepResult {
  stepId: string;
  nodeId: string;
  output: string;
  latencyMs: number;
  teeTrace?: Record<string, unknown>;
  /** Populated by MeshOrchestrator after evaluateOutput() runs on each step. */
  evalResult?: EvaluationResult;
}

export interface ExecutionTraceEntry {
  step: number;
  node: string;
  input: string;
  output: string;
  signature?: string;
  timestamp: number;
  rootHash?: string;
}
