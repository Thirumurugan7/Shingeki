import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { addLineageEntry, getLineage, clearLineage } from './lineage-store.js';

beforeEach(() => clearLineage());

test('starts empty', () => {
  assert.equal(getLineage().length, 0);
});

test('addLineageEntry appends in order', () => {
  addLineageEntry({ genome_id: 'g1', model: 'm', strategy: 's', fitness_score: 0.5, tee_verified: false, timestamp: 1, step_count: 1 });
  addLineageEntry({ genome_id: 'g2', parent_id: 'g1', model: 'm', strategy: 's', fitness_score: 0.7, tee_verified: true, timestamp: 2, step_count: 2 });
  const l = getLineage();
  assert.equal(l.length, 2);
  assert.equal(l[0]!.genome_id, 'g1');
  assert.equal(l[1]!.genome_id, 'g2');
  assert.equal(l[1]!.parent_id, 'g1');
});

test('getLineage returns readonly snapshot', () => {
  addLineageEntry({ genome_id: 'g1', model: 'm', strategy: 's', fitness_score: 0.6, tee_verified: false, timestamp: 1, step_count: 1 });
  const snap = getLineage();
  assert.equal(snap.length, 1);
});

test('clearLineage empties the store', () => {
  addLineageEntry({ genome_id: 'g1', model: 'm', strategy: 's', fitness_score: 0.5, tee_verified: false, timestamp: 1, step_count: 1 });
  clearLineage();
  assert.equal(getLineage().length, 0);
});
