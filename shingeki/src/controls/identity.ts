/**
 * Agent identity registry. Every agent gets a unique, named identity tied to
 * its owner and purpose — the actor a compliance team can point to.
 */
import type { AgentIdentity, AgentStatus, RegisterAgentInput } from './types.js';

export class AgentRegistry {
  private readonly agents = new Map<string, AgentIdentity>();

  register(input: RegisterAgentInput, now: number = Date.now()): AgentIdentity {
    if (!input.id || !input.id.trim()) throw new Error('agent id is required');
    if (this.agents.has(input.id)) throw new Error(`agent ${input.id} already registered`);
    if (!input.name?.trim()) throw new Error('agent name is required');
    if (!input.owner?.trim()) throw new Error('agent owner is required');
    if (!input.purpose?.trim()) throw new Error('agent purpose is required');

    const agent: AgentIdentity = {
      id: input.id,
      name: input.name,
      owner: input.owner,
      purpose: input.purpose,
      model: input.model,
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.agents.set(agent.id, agent);
    return { ...agent };
  }

  get(id: string): AgentIdentity | undefined {
    const a = this.agents.get(id);
    return a ? { ...a } : undefined;
  }

  /** Like {@link get} but throws when the agent is unknown. */
  require(id: string): AgentIdentity {
    const a = this.agents.get(id);
    if (!a) throw new Error(`unknown agent: ${id}`);
    return a;
  }

  list(): AgentIdentity[] {
    return [...this.agents.values()].map(a => ({ ...a }));
  }

  setStatus(id: string, status: AgentStatus, now: number = Date.now()): AgentIdentity {
    const a = this.require(id);
    a.status = status;
    a.updatedAt = now;
    return { ...a };
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  toJSON(): AgentIdentity[] {
    return this.list();
  }

  static fromJSON(agents: AgentIdentity[]): AgentRegistry {
    const r = new AgentRegistry();
    for (const a of agents) r.agents.set(a.id, { ...a });
    return r;
  }
}
