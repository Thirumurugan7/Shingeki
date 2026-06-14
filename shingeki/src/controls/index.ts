/**
 * Sigli financial-controls layer.
 *
 * Gives every agent an identity, a scoped wallet, a runtime-enforced policy,
 * and an audit trail — so an institution can deploy autonomous agents without
 * losing financial control.
 *
 * @example
 * ```ts
 * import { ControlPlane } from 'sigli/controls';
 *
 * const plane = new ControlPlane({ currency: 'USD' });
 * plane.registerAgent({ id: 'procurement-01', name: 'Procurement', owner: 'finance-team', purpose: 'vendor payments' }, 1000);
 * plane.setPolicy('procurement-01', { spend_limit: 500, velocity: 'daily', escalate_above: 250 });
 *
 * plane.authorize({ agentId: 'procurement-01', amount: 248, task: 'invoice #4821' }); // APPROVED
 * plane.authorize({ agentId: 'procurement-01', amount: 1200, task: 'bulk order' });    // BLOCKED (spend-limit)
 *
 * console.log(plane.auditSummary('procurement-01')); // { actions: 2, approved: 1, escalated: 0, violations: 1 }
 * ```
 */
export { ControlPlane, CONTROL_PLANE_VERSION } from './control-plane.js';
export type { ControlPlaneOptions } from './control-plane.js';
export { AgentRegistry } from './identity.js';
export { AgentWallet } from './wallet.js';
export type { WalletState, WalletOptions } from './wallet.js';
export { AuditLog } from './audit.js';
export { evaluatePolicy, VELOCITY_WINDOW_MS } from './policy.js';
export type { PolicyContext } from './policy.js';
export { toMinor, toMajor, round2 } from './money.js';
export type {
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
} from './types.js';
