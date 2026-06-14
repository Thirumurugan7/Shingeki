/**
 * Policy enforcement — evaluated at the moment of action, not reviewed after.
 *
 * The engine is a pure function: given a request, a policy, and the spending
 * context (current balance + spend already used in the velocity window), it
 * returns a deterministic decision. No I/O, no clock — the caller supplies
 * `now` so decisions are reproducible and testable.
 */
import type { ActionRequest, PolicyDecision, PolicyDefinition, Velocity } from './types.js';
import { toMinor } from './money.js';

/** Length of each velocity window in milliseconds. */
export const VELOCITY_WINDOW_MS: Record<Velocity, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

export interface PolicyContext {
  /** Wallet balance available to this agent, in major units. */
  balance: number;
  /** Sum of already-approved spend inside the current velocity window, major units. */
  windowSpend: number;
}

function decision(outcome: PolicyDecision['outcome'], rule: string, reason: string): PolicyDecision {
  return { outcome, rule, reason };
}

/**
 * Evaluate one action against a policy.
 *
 * Order of checks (hard blocks first, then escalation, then approve):
 *  1. invalid amount
 *  2. counterparty allow-list
 *  3. per-action spend limit
 *  4. velocity cap over the rolling window
 *  5. insufficient wallet balance
 *  6. escalation threshold (human approval required)
 *  7. approved
 */
export function evaluatePolicy(
  req: ActionRequest,
  policy: PolicyDefinition,
  ctx: PolicyContext,
): PolicyDecision {
  const amountMinor = toMinor(req.amount);

  if (!Number.isFinite(req.amount) || amountMinor <= 0) {
    return decision('BLOCKED', 'invalid-amount', `amount must be positive, got ${req.amount}`);
  }

  const allow = policy.approved_counterparties;
  if (allow && allow.length > 0) {
    if (!req.counterparty || !allow.includes(req.counterparty)) {
      return decision(
        'BLOCKED',
        'counterparty-not-approved',
        `counterparty ${req.counterparty ?? '(none)'} is not on the approved list`,
      );
    }
  }

  if (policy.spend_limit != null && amountMinor > toMinor(policy.spend_limit)) {
    return decision(
      'BLOCKED',
      'spend-limit',
      `amount ${req.amount} exceeds per-action spend limit ${policy.spend_limit}`,
    );
  }

  if (policy.velocity) {
    const cap = policy.velocity_cap ?? policy.spend_limit;
    if (cap != null) {
      const projectedMinor = toMinor(ctx.windowSpend) + amountMinor;
      if (projectedMinor > toMinor(cap)) {
        return decision(
          'BLOCKED',
          'velocity-cap',
          `${policy.velocity} spend ${ctx.windowSpend} + ${req.amount} exceeds velocity cap ${cap}`,
        );
      }
    }
  }

  if (amountMinor > toMinor(ctx.balance)) {
    return decision(
      'BLOCKED',
      'insufficient-funds',
      `amount ${req.amount} exceeds wallet balance ${ctx.balance}`,
    );
  }

  if (policy.escalate_above != null && amountMinor >= toMinor(policy.escalate_above)) {
    return decision(
      'ESCALATED',
      'escalation-threshold',
      `amount ${req.amount} at or above escalation threshold ${policy.escalate_above} — human approval required`,
    );
  }

  return decision('APPROVED', 'policy-ok', `amount ${req.amount} is within policy`);
}
