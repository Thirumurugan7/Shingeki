import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ControlPlane } from './control-plane.js';

function fixedClock(start: number): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ControlPlane', () => {
  it('registers an agent, opens a wallet, and enforces policy on authorize', () => {
    const cp = new ControlPlane();
    cp.registerAgent({ id: 'procurement-01', name: 'Procurement', owner: 'finance', purpose: 'vendor payments' }, 1000);
    cp.setPolicy('procurement-01', { spend_limit: 500, velocity: 'daily', escalate_above: 250 });

    assert.equal(cp.authorize({ agentId: 'procurement-01', amount: 248 }).outcome, 'APPROVED');
    assert.equal(cp.walletOf('procurement-01').balance, 752);

    // 250 is at the escalation threshold and 248 + 250 = 498 stays under the daily cap.
    assert.equal(cp.authorize({ agentId: 'procurement-01', amount: 250 }).outcome, 'ESCALATED');
    assert.equal(cp.authorize({ agentId: 'procurement-01', amount: 1200 }).outcome, 'BLOCKED');

    // Escalated/blocked actions do not move the wallet.
    assert.equal(cp.walletOf('procurement-01').balance, 752);

    const s = cp.auditSummary('procurement-01');
    assert.deepEqual(s, { actions: 3, approved: 1, escalated: 0 + 1, violations: 1 });
  });

  it('blocks spend for an unknown or paused agent', () => {
    const cp = new ControlPlane();
    assert.equal(cp.authorize({ agentId: 'ghost', amount: 1 }).rule, 'unknown-agent');

    cp.registerAgent({ id: 'a1', name: 'A', owner: 'o', purpose: 'p' }, 100);
    cp.setAgentStatus('a1', 'paused');
    assert.equal(cp.authorize({ agentId: 'a1', amount: 1 }).rule, 'agent-not-active');
  });

  it('enforces a daily velocity cap that resets after the window', () => {
    const clock = fixedClock(1_000_000_000_000);
    const cp = new ControlPlane({ now: clock.now });
    cp.registerAgent({ id: 'r1', name: 'R', owner: 'o', purpose: 'p' }, 10_000);
    cp.setPolicy('r1', { spend_limit: 1000, velocity: 'daily', velocity_cap: 500 });

    assert.equal(cp.authorize({ agentId: 'r1', amount: 300 }).outcome, 'APPROVED');
    assert.equal(cp.authorize({ agentId: 'r1', amount: 300 }).rule, 'velocity-cap'); // 600 > 500
    assert.equal(cp.authorize({ agentId: 'r1', amount: 200 }).outcome, 'APPROVED');  // 500 == cap ok

    clock.advance(25 * 60 * 60 * 1000); // past the daily window
    assert.equal(cp.authorize({ agentId: 'r1', amount: 400 }).outcome, 'APPROVED');
  });

  it('persists to disk and reloads with state intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigli-cp-'));
    try {
      const cp = new ControlPlane({ persistDir: dir });
      cp.registerAgent({ id: 'p1', name: 'P', owner: 'o', purpose: 'p' }, 500);
      cp.setPolicy('p1', { spend_limit: 100 });
      cp.authorize({ agentId: 'p1', amount: 40, task: 'lunch' });

      const reloaded = ControlPlane.load(dir);
      assert.equal(reloaded.walletOf('p1').balance, 460);
      assert.equal(reloaded.getPolicy('p1').spend_limit, 100);
      assert.equal(reloaded.audit('p1').length, 1);
      assert.equal(reloaded.getAgent('p1')?.owner, 'o');

      // The reloaded plane keeps appending with a monotonic seq.
      reloaded.authorize({ agentId: 'p1', amount: 10 });
      const seqs = reloaded.audit('p1').map(e => e.seq);
      assert.deepEqual(seqs, [1, 2]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exports an audit trail as CSV', () => {
    const cp = new ControlPlane();
    cp.registerAgent({ id: 'c1', name: 'C', owner: 'o', purpose: 'p' }, 100);
    cp.authorize({ agentId: 'c1', amount: 10, task: 'has, comma' });
    const csv = cp.exportAuditCSV('c1');
    assert.match(csv.split('\n')[0]!, /^seq,timestamp,agentId/);
    assert.match(csv, /"has, comma"/);
  });
});
