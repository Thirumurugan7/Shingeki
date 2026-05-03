import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCompoundTask } from './planner.js';

test('splitCompoundTask returns single step for simple task', () => {
  const plan = splitCompoundTask('t1', 'Tell me something interesting');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.taskId, 't1');
});

test('splitCompoundTask splits on semicolons', () => {
  const plan = splitCompoundTask('t2', 'Research GPUs; Compare prices; Decide on a model');
  assert.ok(plan.steps.length >= 2, 'should split into multiple steps');
});

test('splitCompoundTask infers research domain', () => {
  const plan = splitCompoundTask('t3', 'Research the best DeFi protocols on Metis');
  assert.equal(plan.steps[0]?.domain, 'research');
});

test('splitCompoundTask infers planning domain', () => {
  const plan = splitCompoundTask('t4', 'Compare and decide on the best option');
  assert.equal(plan.steps[0]?.domain, 'planning');
});

test('splitCompoundTask infers coding domain', () => {
  const plan = splitCompoundTask('t5', 'Implement a smart contract for token staking');
  assert.equal(plan.steps[0]?.domain, 'coding');
});

test('splitCompoundTask defaults to general for ambiguous task', () => {
  const plan = splitCompoundTask('t6', 'Do something interesting today');
  assert.equal(plan.steps[0]?.domain, 'general');
});

test('splitCompoundTask tags each step of a compound task', () => {
  const plan = splitCompoundTask(
    't7',
    'Research GPU prices; Compare specs; Implement a benchmark script',
  );
  const domains = plan.steps.map(s => s.domain);
  assert.ok(domains.includes('research'), 'should have at least one research step');
  assert.ok(domains.includes('coding'), 'should have at least one coding step');
});

test('splitCompoundTask preserves taskId', () => {
  const plan = splitCompoundTask('my-task-123', 'Find the best approach');
  assert.equal(plan.taskId, 'my-task-123');
});

test('viewer follow-up with huge prior context stays a single step', () => {
  const sep = '\n\n---\n\n**Follow-up:**\n\n';
  const prior = [
    '## Prior run: `t-1`',
    'Line1; line2; line3',
    '- bullet a',
    '- bullet b',
    '### Step outputs',
    '#### s1',
    'Some; semicolons; here',
  ].join('\n');
  const full = prior + sep + 'Research the cost impact briefly.';
  const plan = splitCompoundTask('t-follow', full);
  assert.equal(plan.steps.length, 1, 'must not split on newlines/; inside pasted context');
  assert.ok(plan.steps[0]!.description.includes('semicolons'), 'step keeps full task string');
  assert.equal(plan.steps[0]!.domain, 'research', 'domain from user follow-up line only');
});
