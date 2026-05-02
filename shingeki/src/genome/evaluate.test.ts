import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicScore, evaluateOutput } from './evaluate.js';

describe('heuristicScore', () => {
  it('scores thin output low', () => {
    assert.ok(heuristicScore('hi') < 0.3);
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
    assert.ok(heuristicScore(s) >= 0.5);
  });
});

describe('evaluateOutput', () => {
  it('returns heuristic path when score >= threshold (no LLM call)', async () => {
    const richOutput = `
- RTX 4070 Ti Super — $599 — 16GB VRAM — TDP 285W
- RX 7900 GRE — $549 — 16GB VRAM — TDP 260W CUDA ROCm
- RTX 4060 Ti 16GB — $449 — 16GB VRAM — TDP 165W

| Model        | VRAM | Price | TDP  |
|--------------|------|-------|------|
| RTX 4070Ti S | 16GB | $599  | 285W |
| RX 7900 GRE  | 16GB | $549  | 260W |
| RTX 4060Ti   | 16GB | $449  | 165W |

For 13B models the 16GB cards are best. The RTX 4060 Ti wins on perf/watt.
Budget pick: RTX 4060 Ti 16GB at $449.
`.trim();

    const result = await evaluateOutput(richOutput, '', 0.55);
    assert.equal(result.path, 'heuristic');
    assert.ok(result.score >= 0.55);
  });

  it('falls back to heuristic path when LLM judge throws', async () => {
    // Force the slow path (thin output, low heuristic) with no ROUTER_API_KEY set.
    // routerInfer() will throw; evaluateOutput must catch and return heuristic.
    const saved = process.env.ROUTER_API_KEY;
    delete process.env.ROUTER_API_KEY;
    try {
      const result = await evaluateOutput('bad', '', 0.55);
      assert.equal(result.path, 'heuristic');
      assert.ok(result.score < 0.55);
    } finally {
      if (saved !== undefined) process.env.ROUTER_API_KEY = saved;
    }
  });

  it('returns score in [0, 1]', async () => {
    const result = await evaluateOutput('some output', '', 0.55);
    assert.ok(result.score >= 0 && result.score <= 1);
  });
});
