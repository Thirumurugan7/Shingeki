import type { Genome } from './schema.js';

export type GenomeVariant = Genome & { parentId: string; variant: string };

/** Ordered fallback models for the 'model' mutation variant. */
export const FALLBACK_MODELS = [
  'qwen/qwen-2.5-7b-instruct',
  'meta-llama/llama-3.1-8b-instruct',
  'qwen/qwen-2.5-14b-instruct',
] as const;

/** Return the next model in the fallback list, cycling back to index 0 when exhausted. */
export function nextFallbackModel(current: string): string {
  const idx = (FALLBACK_MODELS as readonly string[]).indexOf(current);
  if (idx === -1) return FALLBACK_MODELS[1]!;
  return FALLBACK_MODELS[(idx + 1) % FALLBACK_MODELS.length]!;
}

/** Produce three candidate variants (prompt / model / strategy knobs). */
export function mutateGenome(g: Genome): GenomeVariant[] {
  const base = { ...g, parentId: g.id };
  return [
    { ...base, id: `${g.id}.1`, variant: 'prompt', reflection_depth: Math.min(8, g.reflection_depth + 1) },
    { ...base, id: `${g.id}.2`, variant: 'model', model: nextFallbackModel(g.model) },
    { ...base, id: `${g.id}.3`, variant: 'strategy', strategy: `${g.strategy}+retry` },
  ];
}

/**
 * Apply the next mutation variant, cycling through prompt → model → strategy on successive
 * mutations. Variant is selected by counting how many .N suffixes the genome ID already has.
 */
export function applyMutation(g: Genome): Genome {
  const variants = mutateGenome(g);
  const depth = (g.id.match(/\.\d+/g) ?? []).length;
  return genomeFromVariant(variants[depth % variants.length]!);
}

export function genomeFromVariant(v: GenomeVariant): Genome {
  const { parentId: _p, variant: _v, ...rest } = v;
  return rest as Genome;
}

export function promoteBest(candidates: { genome: Genome; score: number }[]): Genome {
  if (candidates.length === 0) throw new Error('no candidates');
  return [...candidates].sort((a, b) => b.score - a.score)[0]!.genome;
}
