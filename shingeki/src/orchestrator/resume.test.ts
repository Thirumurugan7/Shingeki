import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshOrchestrator } from './orchestrator.js';
import type { StepResult } from '../types.js';

test('resume continues from nextStepIndex with priorResults', async () => {
  const nodes = [
    { id: 'node-1', capabilities: ['llm'] },
    { id: 'node-2', capabilities: ['llm'] },
  ];
  const orch = new MeshOrchestrator(nodes);
  const plan = {
    taskId: 't1',
    steps: [
      { id: 's0', description: 'first' },
      { id: 's1', description: 'second' },
    ],
  };

  const prior: StepResult[] = [
    { stepId: 's0', nodeId: 'node-1', output: 'completed-step0', latencyMs: 10 },
  ];

  let invoked = 0;
  const results = await orch.executePlan(plan, async ({ stepIndex }) => {
    invoked += 1;
    return {
      stepId: plan.steps[stepIndex]!.id,
      nodeId: 'node-1',
      output: `new-${stepIndex}`,
      latencyMs: 5,
    };
  }, {
    parallelFirstStep: false,
    resume: { nextStepIndex: 1, priorResults: prior },
  });

  assert.equal(invoked, 1);
  assert.equal(results.length, 2);
  assert.equal(results[0]!.output, 'completed-step0');
  assert.equal(results[1]!.output, 'new-1');
});
