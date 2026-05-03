/**
 * In-process lineage store — records genome mutations chronologically.
 * In local (single-process) runs, the orchestrator writes here directly.
 * In mesh mode, the hub receives GENOME_LINEAGE WS messages and writes here.
 */
import type { LineageEntry } from '../types.js';

const entries: LineageEntry[] = [];

export function addLineageEntry(e: LineageEntry): void {
  entries.push(e);
}

export function getLineage(): readonly LineageEntry[] {
  return entries;
}

export function clearLineage(): void {
  entries.length = 0;
}
