/** Mesh coordination — not on 0G (fast path). */

export type CoordinationEventType =
  | 'NODE_JOIN'
  | 'ORCH_JOIN'
  | 'ORCH_WORKERS'
  | 'TASK_ASSIGN'
  | 'STEP_RESULT'
  | 'NODE_FAIL'
  | 'RETRY'
  | 'HEARTBEAT';

export interface MeshMessage<T = unknown> {
  type: CoordinationEventType;
  payload: T;
}

export interface NodeCapability {
  id: string;
  capabilities: string[];
  latencyMs?: number;
  stake?: number;
}

export interface Step {
  id: string;
  description: string;
  dependsOn?: string[];
  /** UI / logs — executor vs critic */
  title?: string;
  role?: string;
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
