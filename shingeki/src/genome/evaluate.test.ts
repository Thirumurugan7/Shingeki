import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOutput } from './evaluate.js';

describe('evaluateOutput', () => {
  it('scores thin output low', () => {
    assert.ok(evaluateOutput('hi') < 0.3);
  });

  it('scores structured GPU-ish text higher', () => {
    const s = `
- RTX 4070 — $550 — 12GB VRAM
- RX 7800 XT — $499 — 16GB VRAM  
| Model | VRAM | Price |
|-------|------|-------|
| A     | 12GB | $500  |
TDP 200W
`;
    assert.ok(evaluateOutput(s) >= 0.5);
  });
});
