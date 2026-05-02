import type { Genome } from './schema.js';

export type GenomeVariant = Genome & { parentId: string; variant: string };

/** Produce simple variants (prompt / model / strategy knobs) — evolution hooks Phase 5. */
export function mutateGenome(g: Genome): GenomeVariant[] {
  const base = { ...g, parentId: g.id };
  return [
    { ...base, id: `${g.id}.1`, variant: 'prompt', reflection_depth: Math.min(8, g.reflection_depth + 1) },
    { ...base, id: `${g.id}.2`, variant: 'model', model: g.model },
    { ...base, id: `${g.id}.3`, variant: 'strategy', strategy: `${g.strategy}+retry` },
  ];
}

/** Apply first mutation branch as next active genome (live evolution tick). */
export function applyMutation(g: Genome): Genome {
  const v = mutateGenome(g)[0]!;
  return genomeFromVariant(v);
}

export function genomeFromVariant(v: GenomeVariant): Genome {
  const { parentId: _p, variant: _v, ...rest } = v;
  return rest as Genome;
}

export function promoteBest(candidates: { genome: Genome; score: number }[]): Genome {
  if (candidates.length === 0) throw new Error('no candidates');
  return [...candidates].sort((a, b) => b.score - a.score)[0]!.genome;
}
