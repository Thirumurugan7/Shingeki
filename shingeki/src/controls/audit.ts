/**
 * Audit trail. Every financial action is logged with full context — which
 * agent, which task, which policy check, which outcome — and is reviewable
 * before anyone asks. Entries are append-only and carry a monotonic seq.
 */
import type { AuditEntry, AuditSummary, Outcome } from './types.js';

export class AuditLog {
  private readonly entries: AuditEntry[] = [];
  private seq = 0;

  /** Append an entry, assigning it the next sequence number. */
  append(e: Omit<AuditEntry, 'seq'>): AuditEntry {
    const entry: AuditEntry = { ...e, seq: ++this.seq };
    this.entries.push(entry);
    return { ...entry };
  }

  /** All entries, optionally filtered to one agent, in insertion order. */
  list(agentId?: string): AuditEntry[] {
    const rows = agentId ? this.entries.filter(e => e.agentId === agentId) : this.entries;
    return rows.map(e => ({ ...e }));
  }

  summary(agentId?: string): AuditSummary {
    const rows = agentId ? this.entries.filter(e => e.agentId === agentId) : this.entries;
    const count = (o: Outcome) => rows.filter(e => e.outcome === o).length;
    return {
      actions: rows.length,
      approved: count('APPROVED'),
      escalated: count('ESCALATED'),
      violations: count('BLOCKED'),
    };
  }

  exportJSON(agentId?: string): string {
    return JSON.stringify(this.list(agentId), null, 2);
  }

  /** Export as CSV for internal audit, legal review, or regulatory examination. */
  exportCSV(agentId?: string): string {
    const header = [
      'seq', 'timestamp', 'agentId', 'task', 'amount',
      'counterparty', 'outcome', 'rule', 'reason', 'balanceAfter', 'ref',
    ];
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const e of this.list(agentId)) {
      lines.push([
        e.seq, new Date(e.timestamp).toISOString(), e.agentId, e.task, e.amount,
        e.counterparty, e.outcome, e.rule, e.reason, e.balanceAfter, e.ref,
      ].map(esc).join(','));
    }
    return lines.join('\n');
  }

  toJSON(): { seq: number; entries: AuditEntry[] } {
    return { seq: this.seq, entries: this.list() };
  }

  static fromJSON(data: { seq: number; entries: AuditEntry[] }): AuditLog {
    const log = new AuditLog();
    for (const e of data.entries) log.entries.push({ ...e });
    log.seq = data.seq ?? log.entries.length;
    return log;
  }
}
