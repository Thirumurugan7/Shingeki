/**
 * Sigli financial-controls layer — type definitions.
 *
 * The control plane gives every agent an identity, a scoped wallet, a policy,
 * and an audit trail, so autonomous agents can transact without an institution
 * losing financial control. Enforcement happens at the moment of action.
 */

/** Lifecycle state of a registered agent. */
export type AgentStatus = 'active' | 'paused' | 'retired';

/**
 * A named, accountable actor — not a shared service account.
 * Tied to its owner, purpose, and lifecycle status.
 */
export interface AgentIdentity {
  /** Unique, human-meaningful id, e.g. `procurement-01`. */
  id: string;
  name: string;
  /** Owning team or person — who is accountable for this agent. */
  owner: string;
  /** What the agent exists to do, e.g. `vendor payments`. */
  purpose: string;
  /** Model the agent runs on, when known. */
  model?: string;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
}

/** Input accepted by {@link ControlPlane.registerAgent}. */
export interface RegisterAgentInput {
  id: string;
  name: string;
  owner: string;
  purpose: string;
  model?: string;
  status?: AgentStatus;
}

/** Rolling window a velocity cap is measured over. */
export type Velocity = 'daily' | 'weekly' | 'monthly';

/**
 * A financial policy scoped to one agent. Every field is optional; an empty
 * policy approves any affordable, non-negative spend.
 */
export interface PolicyDefinition {
  /** Max amount, in wallet major units (e.g. USD), for a single action. */
  spend_limit?: number;
  /** Rolling window the velocity cap is enforced over. */
  velocity?: Velocity;
  /**
   * Max cumulative approved spend within the velocity window.
   * Defaults to `spend_limit` when omitted but `velocity` is set.
   */
  velocity_cap?: number;
  /** Actions at or above this amount require human approval (ESCALATED). */
  escalate_above?: number;
  /**
   * Allow-list of counterparties the agent may pay. When omitted or empty,
   * counterparties are unrestricted.
   */
  approved_counterparties?: string[];
}

/** Decision returned by the policy engine. */
export type Outcome = 'APPROVED' | 'ESCALATED' | 'BLOCKED';

/** A proposed financial action submitted to {@link ControlPlane.authorize}. */
export interface ActionRequest {
  agentId: string;
  /** Positive amount to spend, in wallet major units (e.g. USD). */
  amount: number;
  /** Who is being paid. Checked against the policy allow-list when set. */
  counterparty?: string;
  /** Free-form task/reason context recorded in the audit trail. */
  task?: string;
  /** Epoch-ms timestamp; defaults to `Date.now()`. */
  at?: number;
  /** Caller-supplied correlation / idempotency id. */
  ref?: string;
}

/** The verdict for a single {@link ActionRequest}. */
export interface PolicyDecision {
  outcome: Outcome;
  /** Machine-readable rule that drove the decision, e.g. `velocity-cap`. */
  rule: string;
  /** Human-readable explanation. */
  reason: string;
}

/** One immutable line in the audit trail. */
export interface AuditEntry {
  /** Monotonic sequence number within a control plane. */
  seq: number;
  timestamp: number;
  agentId: string;
  task?: string;
  amount: number;
  counterparty?: string;
  outcome: Outcome;
  rule: string;
  reason: string;
  /** Wallet balance (major units) after settlement — present for APPROVED only. */
  balanceAfter?: number;
  ref?: string;
}

/** Roll-up of an agent's (or the whole plane's) audit trail. */
export interface AuditSummary {
  actions: number;
  approved: number;
  escalated: number;
  /** Blocked actions — i.e. attempted policy violations that were stopped. */
  violations: number;
}
