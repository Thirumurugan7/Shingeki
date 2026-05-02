import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointPath } from './checkpoint.js';

test('checkpointPath sanitizes unsafe characters', () => {
  const p = checkpointPath('/tmp/x', 'task/../../evil');
  assert.ok(!p.includes('..'));
  assert.ok(p.endsWith('.json'));
  assert.ok(p.includes('task_'));
});
