import type { Plan, Step } from '../types.js';

const CODING_RE = /\b(code|implement|build|write|debug|fix|refactor|deploy|program|develop)\b/i;
const RESEARCH_RE = /\b(search|find|gather|research|look up|fetch|investigate|survey|explore|discover)\b/i;
const PLANNING_RE = /\b(plan|compare|decide|choose|recommend|select|evaluate|strategize|assess|analyse|analyze)\b/i;

/**
 * Same marker as the hub viewer `buildFollowUpContext` + follow-up field — prior steps often contain
 * `;`, newlines, and bullets; {@link planTask} would mis-classify that as “compound” and split into hundreds of steps.
 */
export const VIEWER_FOLLOWUP_SEPARATOR = '\n\n---\n\n**Follow-up:**\n\n';

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
      steps: [{ id: `${taskId}-step-1`, description: taskText.trim() }],
    };
  }

  const parts = taskText
    .split(/;|\n|then/i)
    .map(s => s.trim())
    .filter(Boolean);

  const steps: Step[] = parts.map((p, i) => ({
    id: `${taskId}-step-${i + 1}`,
    description: p,
  }));

  return { taskId, steps };
}

/**
 * Like planTask() but also infers a domain tag on each step from keywords in the description.
 * Used when the user provides a free-form --task string via the CLI.
 */
export function splitCompoundTask(taskId: string, taskText: string): Plan {
  if (taskText.includes(VIEWER_FOLLOWUP_SEPARATOR)) {
    const idx = taskText.lastIndexOf(VIEWER_FOLLOWUP_SEPARATOR);
    const userPart = taskText.slice(idx + VIEWER_FOLLOWUP_SEPARATOR.length);
    return {
      taskId,
      steps: [
        {
          id: `${taskId}-step-1`,
          description: taskText.trim(),
          domain: inferDomain(userPart.trim()),
        },
      ],
    };
  }

  const base = planTask(taskId, taskText);
  return {
    ...base,
    steps: base.steps.map(s => ({ ...s, domain: inferDomain(s.description) })),
  };
}
