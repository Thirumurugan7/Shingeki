import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKPOINT_VERSION,
  checkpointPath,
  writeCheckpointAtomic,
  readCheckpoint,
  buildPriorContextFromResults,
  listCheckpointSummaries,
} from './checkpoint.js';
import type { DemoCheckpoint } from './checkpoint.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shingeki-cp-test-'));
}

const baseGenome = {
  id: 'g1', model: 'm', strategy: 'plan',
  tools: [] as string[], reflection_depth: 1, mutation_rate: 0.1,
};

const baseCheckpoint: DemoCheckpoint = {
  version: CHECKPOINT_VERSION,
  taskId: 'task-abc',
  preset: 'gpu',
  mesh: false,
  nextStepIndex: 1,
  results: [{ stepId: 's0', nodeId: 'n1', output: 'hello world', latencyMs: 10 }],
  genome: baseGenome,
  evolveThreshold: 0.5,
  summary: 'test summary',
  updatedAt: 1_000_000,
};

test('checkpointPath sanitizes unsafe characters', () => {
  const p = checkpointPath('/tmp/x', 'task/../../evil');
  assert.ok(!p.includes('..'));
  assert.ok(p.endsWith('.json'));
  assert.ok(p.includes('task_'));
});

test('writeCheckpointAtomic + readCheckpoint round-trips all fields', () => {
  const dir = tmpDir();
  try {
    writeCheckpointAtomic(dir, baseCheckpoint);
    const loaded = readCheckpoint(dir, 'task-abc');
    assert.ok(loaded !== null);
    assert.equal(loaded!.taskId, 'task-abc');
    assert.equal(loaded!.preset, 'gpu');
    assert.equal(loaded!.nextStepIndex, 1);
    assert.equal(loaded!.results.length, 1);
    assert.equal(loaded!.results[0]!.output, 'hello world');
    assert.equal(loaded!.summary, 'test summary');
    assert.equal(loaded!.updatedAt, 1_000_000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readCheckpoint returns null for nonexistent file', () => {
  const dir = tmpDir();
  try {
    const result = readCheckpoint(dir, 'does-not-exist');
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readCheckpoint returns null for wrong version', () => {
  const dir = tmpDir();
  try {
    const bad = { ...baseCheckpoint, version: 99 };
    fs.mkdirSync(dir, { recursive: true });
    const p = checkpointPath(dir, 'bad-version');
    fs.writeFileSync(p, JSON.stringify(bad), 'utf8');
    const result = readCheckpoint(dir, 'bad-version');
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readCheckpoint returns null for corrupt JSON', () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const p = checkpointPath(dir, 'corrupt');
    fs.writeFileSync(p, '{not valid json', 'utf8');
    const result = readCheckpoint(dir, 'corrupt');
    assert.equal(result, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('listCheckpointSummaries returns empty array for nonexistent dir', () => {
  const result = listCheckpointSummaries('/tmp/this-dir-does-not-exist-shingeki-test');
  assert.deepEqual(result, []);
});

test('listCheckpointSummaries returns entries sorted newest-first', () => {
  const dir = tmpDir();
  try {
    writeCheckpointAtomic(dir, { ...baseCheckpoint, taskId: 'old-task', updatedAt: 1000 });
    writeCheckpointAtomic(dir, { ...baseCheckpoint, taskId: 'new-task', updatedAt: 9000 });
    const list = listCheckpointSummaries(dir);
    assert.equal(list.length, 2);
    assert.equal(list[0]!.taskId, 'new-task');
    assert.equal(list[1]!.taskId, 'old-task');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildPriorContextFromResults chains step outputs', () => {
  const results = [
    { stepId: 's0', nodeId: 'n1', output: 'first output', latencyMs: 5 },
    { stepId: 's1', nodeId: 'n1', output: 'second output', latencyMs: 5 },
  ];
  const ctx = buildPriorContextFromResults(['step-search', 'step-specs'], results);
  assert.ok(ctx.includes('### step-search'));
  assert.ok(ctx.includes('first output'));
  assert.ok(ctx.includes('### step-specs'));
  assert.ok(ctx.includes('second output'));
});

test('buildPriorContextFromResults stops at shorter array', () => {
  const results = [
    { stepId: 's0', nodeId: 'n1', output: 'only one', latencyMs: 5 },
  ];
  const ctx = buildPriorContextFromResults(['step-a', 'step-b', 'step-c'], results);
  assert.ok(ctx.includes('only one'));
  assert.ok(!ctx.includes('step-b'));
});
