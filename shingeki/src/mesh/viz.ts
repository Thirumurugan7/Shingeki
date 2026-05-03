import type { NodeCapability } from '../types.js';

/** ASCII mesh status — makes “network of agents” visible in the terminal. */
export function formatMeshViz(nodes: NodeCapability[], activeIds: ReadonlySet<string>): string {
  const lines = ['[Mesh]'];
  for (const n of nodes) {
    const caps = n.capabilities ?? [];
    const role = caps.includes('critic') ? 'critic' : caps.includes('executor') ? 'executor' : caps[0] ?? 'worker';
    const state = activeIds.has(n.id) ? 'active' : 'idle';
    const bar = state === 'active' ? '████████████' : '░░░░░░░░░░░░';
    lines.push(`  ${n.id.padEnd(10)} (${role.padEnd(9)}) ${bar}  ${state}`);
  }
  return lines.join('\n');
}
