import type { Plan, Step } from '../types.js';

/** Default demo goal: forces multi-step reasoning + multi-node routing + verification story. */
export const GPU_LLM_RESEARCH_GOAL = `
Find the best GPU under $1000 for running local LLMs in 2026,
compare at least 3 options, and give a final recommendation with reasoning.
`.trim();

/** Harder optional preset (long chain). */
export const JAPAN_TRIP_GOAL = `
Plan a 5-day trip to Japan under $1500 including flights,
optimize for food and culture, and justify every choice.
`.trim();

function step(
  id: string,
  title: string,
  role: string,
  domain: Step['domain'],
  description: string,
): Step & { title: string; role: string } {
  return { id, title, role, domain, description };
}

/**
 * Explicit Research → Analyze → Decide pipeline (4 steps).
 * Step outputs are chained as context for later steps (orchestrator).
 */
export function planResearchAnalyzeDecide(taskId: string): Plan & { labels: string[] } {
  const steps: (Step & { title: string; role: string })[] = [
    step(
      'step-search',
      'Search GPUs',
      'executor',
      'research',
      [
        'Search pass: You are the mesh search executor.',
        'Find at least 5 retail GPUs under USD $1000 total (2025–2026) suitable for local LLM inference (7B–13B class models).',
        'For each candidate list: model name, approximate street price, VRAM.',
        'Output a tight bullet list (no fluff).',
      ].join('\n'),
    ),
    step(
      'step-specs',
      'Extract specs',
      'executor',
      'research',
      [
        'Spec extraction: From the list in PREVIOUS OUTPUT, pick the 3 best options for local LLMs under $1000.',
        'For each of the 3: VRAM, approximate FP16/tensor throughput (or say unknown), TDP, price, one line on fitting 7B vs 13B models.',
      ].join('\n'),
    ),
    step(
      'step-compare',
      'Compare',
      'critic',
      'planning',
      [
        'Critical comparison: Using PREVIOUS OUTPUT only, compare the 3 GPUs side-by-side for local LLM workloads.',
        'Use a small markdown table + short narrative on perf/watt, VRAM headroom, PSU/noise, and upgrade path.',
      ].join('\n'),
    ),
    step(
      'step-decide',
      'Recommend',
      'critic',
      'planning',
      [
        'Decision: Pick ONE final GPU recommendation under $1000 for local LLMs in 2026.',
        'Give: (1) recommendation (2) reasoning (3) caveats (4) who should pick a different card.',
        'Be decisive; reference PREVIOUS OUTPUT.',
      ].join('\n'),
    ),
  ];

  return {
    taskId,
    steps,
    labels: steps.map(s => s.title),
  };
}

/** Longer multi-step trip planning chain (5 steps). */
export function planJapanTrip(taskId: string): Plan & { labels: string[] } {
  const steps = [
    step('jp-1', 'Flights',    'executor', 'research', 'Find realistic round-trip flight options to Japan under the total trip budget; list 2–3 gateways and rough USD.'),
    step('jp-2', 'Lodging',    'executor', 'research', 'Pick cities/nights distribution for 5 days; prioritize food neighborhoods; estimate lodging USD.'),
    step('jp-3', 'Food',       'critic',   'planning', 'Build a food-forward daily outline (markets, izakaya, regional specialties) with rough meal costs.'),
    step('jp-4', 'Culture',    'critic',   'planning', 'Add cultural depth: museums, neighborhoods, transit passes; justify tradeoffs vs budget.'),
    step('jp-5', 'Final plan', 'critic',   'planning', 'Deliver final day-by-day itinerary under $1500 including flights with justification for each major choice.'),
  ];
  return {
    taskId,
    steps,
    labels: steps.map(s => s.title),
  };
}
