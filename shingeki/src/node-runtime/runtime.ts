import type { Genome } from '../genome/schema.js';
import type { Step, StepResult } from '../types.js';
import { routerInfer } from '../og/compute-router.js';

export interface NodeRuntimeOptions {
  nodeId: string;
}

/** Worker — executes one planned step using Router-backed LLM (0G Compute path). */
export class NodeRuntime {
  constructor(
    private readonly opts: NodeRuntimeOptions,
    private readonly genome: Genome,
  ) {}

  /**
   * `step.description` should already include PREVIOUS OUTPUT chain when orchestrator passes chained prompts.
   */
  async executeStep(step: Step, _priorContext?: string): Promise<StepResult> {
    const role = step.role ?? 'worker';
    const system = [
      `You are node ${this.opts.nodeId} in the Shingeki mesh (${role}).`,
      `Strategy: ${this.genome.strategy}`,
      `Tools (declared): ${this.genome.tools.join(', ')}`,
      `Reflection depth: ${this.genome.reflection_depth}`,
      `Follow the user instruction exactly; cite PREVIOUS OUTPUT when present.`,
    ].join('\n');

    const r = await routerInfer(step.description, system, { max_tokens: 2048, temperature: 0.25, model: this.genome.model });
    return {
      stepId: step.id,
      nodeId: this.opts.nodeId,
      output: r.text,
      latencyMs: r.latencyMs,
      teeTrace: r.trace,
    };
  }
}
