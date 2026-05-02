import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMutation, genomeFromVariant, mutateGenome } from './mutation.js';
import type { Genome } from './schema.js';

const base: Genome = {
  id: 'genome-v1',
  model: 'qwen/qwen-2.5-7b-instruct',
  strategy: 'plan-execute',
  tools: ['web'],
  reflection_depth: 2,
  mutation_rate: 0.2,
};

describe('mutation', () => {
  it('mutateGenome returns three variants', () => {
    assert.equal(mutateGenome(base).length, 3);
  });

  it('applyMutation bumps id and changes genome', () => {
    const next = applyMutation(base);
    assert.ok(next.id.includes('v1'));
    assert.ok(next.reflection_depth >= base.reflection_depth);
  });

  it('genomeFromVariant strips lineage fields', () => {
    const v = mutateGenome(base)[0]!;
    const g = genomeFromVariant(v);
    assert.equal((g as { parentId?: string }).parentId, undefined);
  });
});
