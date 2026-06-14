/**
 * Sigli control plane — one place to govern every agent an institution deploys.
 *
 * Ties together identity, scoped wallets, runtime policy enforcement, and an
 * audit trail. The single hot path is {@link ControlPlane.authorize}: it
 * evaluates a proposed spend against the agent's policy, settles the wallet on
 * approval, and records the outcome to the audit log — atomically, in process,
 * before any transaction clears.
 *
 * Mirrors the product API:
 *   registerAgent  ≈ POST /agents
 *   setPolicy      ≈ POST /agents/:id/policy
 *   audit          ≈ GET  /agents/:id/audit
 */
import fs from 'node:fs';
import path from 'node:path';
import { AgentRegistry } from './identity.js';
import { AgentWallet } from './wallet.js';
import { AuditLog } from './audit.js';
import { evaluatePolicy, VELOCITY_WINDOW_MS } from './policy.js';
import { round2 } from './money.js';
import type {
  ActionRequest,
  AgentIdentity,
  AgentStatus,
  AuditEntry,
  AuditSummary,
  PolicyDecision,
  PolicyDefinition,
  RegisterAgentInput,
} from './types.js';

export const CONTROL_PLANE_VERSION = 1 as const;

export interface ControlPlaneOptions {
  /** Default wallet currency for newly registered agents. */
  currency?: string;
  /**
   * Directory for durable state. When set, every mutating call persists the
   * full plane (agents, policies, wallets, audit) atomically to
   * `<persistDir>/control-plane.json`. Load it back with {@link ControlPlane.load}.
   */
  persistDir?: string;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
}

interface PersistShape {
  version: typeof CONTROL_PLANE_VERSION;
  currency: string;
  agents: AgentIdentity[];
  policies: Record<string, PolicyDefinition>;
  wallets: ReturnType<AgentWallet['toJSON']>[];
  audit: ReturnType<AuditLog['toJSON']>;
}

export class ControlPlane {
  private registry: AgentRegistry;
  private readonly wallets = new Map<string, AgentWallet>();
  private readonly policies = new Map<string, PolicyDefinition>();
  private audit_ = new AuditLog();
  private readonly currency: string;
  private readonly persistDir?: string;
  private readonly now: () => number;

  constructor(opts: ControlPlaneOptions = {}) {
    this.registry = new AgentRegistry();
    this.currency = opts.currency ?? 'USD';
    this.persistDir = opts.persistDir;
    this.now = opts.now ?? Date.now;
  }

  // ── Identity ───────────────────────────────────────────────────────────

  /** Register an agent and open its scoped wallet. */
  registerAgent(input: RegisterAgentInput, openingBalance = 0): AgentIdentity {
    const agent = this.registry.register(input, this.now());
    this.wallets.set(agent.id, new AgentWallet(agent.id, { currency: this.currency, balance: openingBalance }));
    this.persist();
    return agent;
  }

  setAgentStatus(agentId: string, status: AgentStatus): AgentIdentity {
    const a = this.registry.setStatus(agentId, status, this.now());
    this.persist();
    return a;
  }

  listAgents(): AgentIdentity[] {
    return this.registry.list();
  }

  getAgent(agentId: string): AgentIdentity | undefined {
    return this.registry.get(agentId);
  }

  // ── Policy ─────────────────────────────────────────────────────────────

  setPolicy(agentId: string, policy: PolicyDefinition): void {
    this.registry.require(agentId);
    this.policies.set(agentId, { ...policy });
    this.persist();
  }

  getPolicy(agentId: string): PolicyDefinition {
    return { ...(this.policies.get(agentId) ?? {}) };
  }

  // ── Wallet ─────────────────────────────────────────────────────────────

  walletOf(agentId: string): AgentWallet {
    const w = this.wallets.get(agentId);
    if (!w) throw new Error(`no wallet for agent: ${agentId}`);
    return w;
  }

  /** Add funds to an agent's wallet. */
  fundWallet(agentId: string, amount: number): number {
    const bal = this.walletOf(agentId).credit(amount);
    this.persist();
    return bal;
  }

  // ── Authorization (the hot path) ────────────────────────────────────────

  /**
   * Evaluate a proposed spend, settle the wallet on approval, and log the
   * outcome. The wallet is only debited when the decision is APPROVED.
   */
  authorize(req: ActionRequest): PolicyDecision {
    const at = req.at ?? this.now();

    const agent = this.registry.get(req.agentId);
    if (!agent) {
      return this.record(req, at, {
        outcome: 'BLOCKED',
        rule: 'unknown-agent',
        reason: `agent ${req.agentId} is not registered`,
      });
    }
    if (agent.status !== 'active') {
      return this.record(req, at, {
        outcome: 'BLOCKED',
        rule: 'agent-not-active',
        reason: `agent ${req.agentId} is ${agent.status}`,
      });
    }

    const wallet = this.walletOf(req.agentId);
    const policy = this.policies.get(req.agentId) ?? {};
    const windowSpend = this.windowSpend(req.agentId, policy, at);

    const decision = evaluatePolicy(req, policy, { balance: wallet.balance, windowSpend });
    return this.record(req, at, decision);
  }

  /** Sum of approved spend for an agent inside its current velocity window. */
  private windowSpend(agentId: string, policy: PolicyDefinition, at: number): number {
    if (!policy.velocity) return 0;
    const since = at - VELOCITY_WINDOW_MS[policy.velocity];
    let total = 0;
    for (const e of this.audit_.list(agentId)) {
      if (e.outcome === 'APPROVED' && e.timestamp > since) total += e.amount;
    }
    return round2(total);
  }

  /** Apply settlement (APPROVED only) and append the audit entry. */
  private record(req: ActionRequest, at: number, decision: PolicyDecision): PolicyDecision {
    let balanceAfter: number | undefined;
    if (decision.outcome === 'APPROVED') {
      balanceAfter = this.walletOf(req.agentId).debit(req.amount);
    }
    this.audit_.append({
      timestamp: at,
      agentId: req.agentId,
      task: req.task,
      amount: round2(req.amount),
      counterparty: req.counterparty,
      outcome: decision.outcome,
      rule: decision.rule,
      reason: decision.reason,
      balanceAfter,
      ref: req.ref,
    });
    this.persist();
    return decision;
  }

  // ── Audit ──────────────────────────────────────────────────────────────

  audit(agentId?: string): AuditEntry[] {
    return this.audit_.list(agentId);
  }

  auditSummary(agentId?: string): AuditSummary {
    return this.audit_.summary(agentId);
  }

  exportAuditJSON(agentId?: string): string {
    return this.audit_.exportJSON(agentId);
  }

  exportAuditCSV(agentId?: string): string {
    return this.audit_.exportCSV(agentId);
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private toJSON(): PersistShape {
    return {
      version: CONTROL_PLANE_VERSION,
      currency: this.currency,
      agents: this.registry.toJSON(),
      policies: Object.fromEntries(this.policies),
      wallets: [...this.wallets.values()].map(w => w.toJSON()),
      audit: this.audit_.toJSON(),
    };
  }

  private static fileIn(dir: string): string {
    return path.join(dir, 'control-plane.json');
  }

  private persist(): void {
    if (!this.persistDir) return;
    fs.mkdirSync(this.persistDir, { recursive: true });
    const finalPath = ControlPlane.fileIn(this.persistDir);
    const tmpPath = `${finalPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.toJSON(), null, 2), 'utf8');
    fs.renameSync(tmpPath, finalPath);
  }

  /** Load a previously persisted control plane from disk. */
  static load(dir: string, opts: Omit<ControlPlaneOptions, 'persistDir' | 'currency'> = {}): ControlPlane {
    const file = ControlPlane.fileIn(dir);
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw) as PersistShape;
    if (data.version !== CONTROL_PLANE_VERSION) {
      throw new Error(`unsupported control-plane version: ${data.version}`);
    }
    const cp = new ControlPlane({ ...opts, currency: data.currency, persistDir: dir });
    // Restore internal state directly, preserving original timestamps and seq.
    cp.registry = AgentRegistry.fromJSON(data.agents);
    for (const [id, p] of Object.entries(data.policies)) cp.policies.set(id, { ...p });
    for (const w of data.wallets) cp.wallets.set(w.agentId, AgentWallet.fromJSON(w));
    cp.audit_ = AuditLog.fromJSON(data.audit);
    return cp;
  }
}
