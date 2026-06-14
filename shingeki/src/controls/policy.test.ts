import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from './policy.js';
import type { PolicyDefinition } from './types.js';

const policy: PolicyDefinition = { spend_limit: 500, velocity: 'daily', escalate_above: 250 };
const ctx = { balance: 1000, windowSpend: 0 };

describe('evaluatePolicy', () => {
  it('approves a spend below every threshold', () => {
    const d = evaluatePolicy({ agentId: 'a', amount: 248 }, policy, ctx);
    assert.equal(d.outcome, 'APPROVED');
    assert.equal(d.rule, 'policy-ok');
  });

  it('escalates at or above the escalation threshold', () => {
    assert.equal(evaluatePolicy({ agentId: 'a', amount: 250 }, policy, ctx).outcome, 'ESCALATED');
    assert.equal(evaluatePolicy({ agentId: 'a', amount: 400 }, policy, ctx).outcome, 'ESCALATED');
  });

  it('blocks above the per-action spend limit', () => {
    const d = evaluatePolicy({ agentId: 'a', amount: 1200 }, policy, ctx);
    assert.equal(d.outcome, 'BLOCKED');
    assert.equal(d.rule, 'spend-limit');
  });

  it('blocks when the velocity cap would be exceeded', () => {
    const d = evaluatePolicy({ agentId: 'a', amount: 100 }, policy, { balance: 1000, windowSpend: 450 });
    assert.equal(d.outcome, 'BLOCKED');
    assert.equal(d.rule, 'velocity-cap');
  });

  it('blocks when the wallet cannot cover the amount', () => {
    const d = evaluatePolicy({ agentId: 'a', amount: 200 }, { spend_limit: 500 }, { balance: 50, windowSpend: 0 });
    assert.equal(d.outcome, 'BLOCKED');
    assert.equal(d.rule, 'insufficient-funds');
  });

  it('blocks non-positive amounts', () => {
    assert.equal(evaluatePolicy({ agentId: 'a', amount: 0 }, policy, ctx).rule, 'invalid-amount');
    assert.equal(evaluatePolicy({ agentId: 'a', amount: -5 }, policy, ctx).rule, 'invalid-amount');
  });

  it('enforces the counterparty allow-list', () => {
    const p: PolicyDefinition = { approved_counterparties: ['acme'] };
    assert.equal(evaluatePolicy({ agentId: 'a', amount: 10, counterparty: 'acme' }, p, ctx).outcome, 'APPROVED');
    const d = evaluatePolicy({ agentId: 'a', amount: 10, counterparty: 'evilcorp' }, p, ctx);
    assert.equal(d.outcome, 'BLOCKED');
    assert.equal(d.rule, 'counterparty-not-approved');
  });

  it('approves any affordable spend under an empty policy', () => {
    assert.equal(evaluatePolicy({ agentId: 'a', amount: 9999 }, {}, { balance: 100000, windowSpend: 0 }).outcome, 'APPROVED');
  });
});
