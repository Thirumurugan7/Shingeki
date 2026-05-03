import type { Plan, Step } from '../types.js';

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

const CODING_RE = /\b(code|implement|build|write|debug|fix|refactor|deploy|program|develop)\b/i;
const RESEARCH_RE = /\b(search|find|gather|research|look up|fetch|investigate|survey|explore|discover)\b/i;
const PLANNING_RE = /\b(plan|compare|decide|choose|recommend|select|evaluate|strategize|assess|analyse|analyze)\b/i;

function inferDomain(text: string): Step['domain'] {
  if (CODING_RE.test(text)) return 'coding';
  if (RESEARCH_RE.test(text)) return 'research';
  if (PLANNING_RE.test(text)) return 'planning';
  return 'general';
}

/** Phase 2 — lightweight planner: multi-step if task looks compound; else single step. */
export function planTask(taskId: string, taskText: string): Plan {
  const lower = taskText.toLowerCase();
  const compound =
    lower.includes(';') ||
    lower.includes(' then ') ||
    lower.includes('steps:') ||
    /\n\s*[-*]\s/.test(taskText);

  if (!compound) {
    return {
      taskId,
      steps: [{ id: nextId('step'), description: taskText.trim() }],
    };
  }

  const parts = taskText
    .split(/;|\n|then/i)
    .map(s => s.trim())
    .filter(Boolean);

  const steps: Step[] = parts.map(p => ({
    id: nextId('step'),
    description: p,
  }));

  return { taskId, steps };
}

/**
 * Like planTask() but also infers a domain tag on each step from keywords in the description.
 * Used when the user provides a free-form --task string via the CLI.
 */
export function splitCompoundTask(taskId: string, taskText: string): Plan {
  const base = planTask(taskId, taskText);
  return {
    ...base,
    steps: base.steps.map(s => ({ ...s, domain: inferDomain(s.description) })),
  };
}
