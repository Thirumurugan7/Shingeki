import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, parseMessage } from './protocol.js';

test('encodeMessage round-trips', () => {
  const raw = encodeMessage('TASK_ASSIGN', { targetNodeId: 'n1', envelope: { stepId: 's1' } });
  const msg = parseMessage(raw);
  assert.ok(msg);
  assert.equal(msg!.type, 'TASK_ASSIGN');
  assert.deepEqual((msg!.payload as { targetNodeId: string }).targetNodeId, 'n1');
});

test('parseMessage rejects invalid JSON', () => {
  assert.equal(parseMessage('not json'), null);
});

test('parseMessage rejects missing type', () => {
  assert.equal(parseMessage(JSON.stringify({ payload: {} })), null);
});
