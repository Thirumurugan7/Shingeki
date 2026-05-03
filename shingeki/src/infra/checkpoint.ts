/** Local durable checkpoints — survive hub/orchestrator crashes between steps (not mid-step). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Genome } from '../genome/schema.js';
import type { StepResult } from '../types.js';

export const CHECKPOINT_VERSION = 1 as const;

export interface DemoCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  taskId: string;
  preset: 'gpu' | 'japan' | 'defi';
  mesh: boolean;
  /** Index of the next step to run (0-based); equals completed step count */
  nextStepIndex: number;
  results: StepResult[];
  genome: Genome;
  evolveThreshold: number;
  summary: string;
  updatedAt: number;
}

export function defaultCheckpointDir(shingekiRoot: string): string {
  const raw = process.env.SHINGEKI_CHECKPOINT_DIR?.trim();
  if (raw) return path.resolve(raw);
  return path.join(shingekiRoot, '.checkpoints');
}

/** Resolved `.checkpoints` dir for this package (hub + CLI). */
export function resolvedCheckpointDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/infra → package root (matches cli.ts `shingekiRoot`)
  const shingekiRoot = path.resolve(here, '..', '..');
  return defaultCheckpointDir(shingekiRoot);
}

export interface CheckpointSummary {
  taskId: string;
  updatedAt: number;
  stepCount: number;
  nextStepIndex: number;
  mesh: boolean;
  summaryPreview: string;
}

export function listCheckpointSummaries(dir: string): CheckpointSummary[] {
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -'.json'.length));
  const out: CheckpointSummary[] = [];
  for (const base of names) {
    const cp = readCheckpoint(dir, base);
    if (!cp) continue;
    out.push({
      taskId: cp.taskId,
      updatedAt: cp.updatedAt,
      stepCount: cp.results.length,
      nextStepIndex: cp.nextStepIndex,
      mesh: cp.mesh,
      summaryPreview: cp.summary.replace(/\s+/g, ' ').trim().slice(0, 220),
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function checkpointPath(dir: string, taskId: string): string {
  const safe = taskId
    .replace(/\.\./g, '_')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 128);
  return path.join(dir, `${safe}.json`);
}

export function writeCheckpointAtomic(dir: string, cp: DemoCheckpoint): void {
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = checkpointPath(dir, cp.taskId);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(cp, null, 2), 'utf8');
  fs.renameSync(tmpPath, finalPath);
}

export function readCheckpoint(dir: string, taskId: string): DemoCheckpoint | null {
  const p = checkpointPath(dir, taskId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const o = JSON.parse(raw) as DemoCheckpoint;
    if (o.version !== CHECKPOINT_VERSION) return null;
    if (!Array.isArray(o.results) || typeof o.nextStepIndex !== 'number') return null;
    return o;
  } catch {
    return null;
  }
}

export function buildPriorContextFromResults(
  stepIds: string[],
  results: StepResult[],
): string {
  let ctx = '';
  for (let i = 0; i < results.length && i < stepIds.length; i++) {
    ctx += `\n\n### ${stepIds[i]}\n${results[i]!.output}`;
  }
  return ctx;
}
