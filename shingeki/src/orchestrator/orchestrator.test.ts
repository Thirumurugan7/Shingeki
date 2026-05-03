import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planToRequiredRoles } from './orchestrator.js';
import type { Plan } from '../types.js';

test('planToRequiredRoles counts distinct domains', () => {
  const plan: Plan = {
    taskId: 't1',
    steps: [
      { id: 's1', description: 'd', domain: 'research' },
      { id: 's2', description: 'd', domain: 'research' },
      { id: 's3', description: 'd', domain: 'planning' },
    ],
  };
  const roles = planToRequiredRoles(plan);
  assert.equal(roles['research'], 2);
  assert.equal(roles['planning'], 1);
});

test('planToRequiredRoles caps each domain at 2', () => {
  const plan: Plan = {
    taskId: 't2',
    steps: [
      { id: 's1', description: 'd', domain: 'planning' },
      { id: 's2', description: 'd', domain: 'planning' },
      { id: 's3', description: 'd', domain: 'planning' },
    ],
  };
  const roles = planToRequiredRoles(plan);
  assert.equal(roles['planning'], 2, 'should cap at 2, not return 3');
});

test('planToRequiredRoles defaults undomain steps to general', () => {
  const plan: Plan = {
    taskId: 't3',
    steps: [{ id: 's1', description: 'd' }],
  };
  const roles = planToRequiredRoles(plan);
  assert.equal(roles['general'], 2, 'single undomain step should yield 2 general nodes for parallel competition');
});

test('planToRequiredRoles ensures at least 2 total nodes', () => {
  const plan: Plan = {
    taskId: 't4',
    steps: [{ id: 's1', description: 'd', domain: 'research' }],
  };
  const roles = planToRequiredRoles(plan);
  const total = Object.values(roles).reduce((a, b) => a + b, 0);
  assert.ok(total >= 2, 'must have at least 2 nodes for parallel competition');
});

test('planToRequiredRoles handles multi-domain gpu plan', () => {
  const plan: Plan = {
    taskId: 'gpu',
    steps: [
      { id: 's1', description: 'd', domain: 'research' },
      { id: 's2', description: 'd', domain: 'research' },
      { id: 's3', description: 'd', domain: 'planning' },
      { id: 's4', description: 'd', domain: 'planning' },
    ],
  };
  const roles = planToRequiredRoles(plan);
  assert.equal(roles['research'], 2);
  assert.equal(roles['planning'], 2);
  assert.equal(Object.values(roles).reduce((a, b) => a + b, 0), 4);
});

test('planToRequiredRoles total node count equals sum of all domain counts', () => {
  const plan: Plan = {
    taskId: 't5',
    steps: [
      { id: 's1', description: 'd', domain: 'research' },
      { id: 's2', description: 'd', domain: 'coding' },
      { id: 's3', description: 'd', domain: 'planning' },
    ],
  };
  const roles = planToRequiredRoles(plan);
  // 3 domains × 1 step each = 3 total ≥ 2, so the "ensure min 2 total" bump does not fire.
  assert.equal(roles['research'], 1);
  assert.equal(roles['coding'], 1);
  assert.equal(roles['planning'], 1);
});
