import type { Plan, Step } from '../types.js';

let seq = 0;
function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
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
