import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyMutation, FALLBACK_MODELS, genomeFromVariant, mutateGenome, nextFallbackModel } from './mutation.js';
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

  it('variant 2 (model) switches to a different model', () => {
    const variants = mutateGenome(base);
    const modelVariant = variants[1]!;
    assert.equal(modelVariant.variant, 'model');
    assert.notEqual(modelVariant.model, base.model, 'model variant must change the model');
  });

  it('nextFallbackModel cycles to next entry in FALLBACK_MODELS', () => {
    const first = FALLBACK_MODELS[0]!;
    const second = FALLBACK_MODELS[1]!;
    assert.equal(nextFallbackModel(first), second);
    assert.notEqual(nextFallbackModel(first), first);
  });

  it('nextFallbackModel wraps around at end of list', () => {
    const last = FALLBACK_MODELS[FALLBACK_MODELS.length - 1]!;
    const first = FALLBACK_MODELS[0]!;
    assert.equal(nextFallbackModel(last), first);
  });

  it('nextFallbackModel handles unknown model by returning index 1', () => {
    const result = nextFallbackModel('unknown/model');
    assert.equal(result, FALLBACK_MODELS[1]!);
  });

  it('applyMutation cycles prompt → model → strategy on successive mutations', () => {
    // depth 0 → variant[0] = prompt (reflection_depth bumped)
    const g1 = applyMutation(base);
    assert.ok(g1.reflection_depth > base.reflection_depth, 'first mutation: reflection_depth should increase');

    // depth 1 → variant[1] = model (model changed)
    const g2 = applyMutation(g1);
    assert.notEqual(g2.model, g1.model, 'second mutation: model should change');

    // depth 2 → variant[2] = strategy (+retry appended)
    const g3 = applyMutation(g2);
    assert.ok(g3.strategy.includes('+retry'), 'third mutation: strategy should include +retry');

    // depth 3 → variant[0] again (cycles back to prompt)
    const g4 = applyMutation(g3);
    assert.ok(
      g4.reflection_depth > g3.reflection_depth || g4.reflection_depth === 8,
      'fourth mutation: should cycle back to prompt variant',
    );
  });

  it('all variants have different ids', () => {
    const variants = mutateGenome(base);
    const ids = variants.map(v => v.id);
    assert.equal(new Set(ids).size, ids.length, 'all variant IDs must be unique');
  });
});
