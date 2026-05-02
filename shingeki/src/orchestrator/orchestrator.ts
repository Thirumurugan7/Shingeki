import type { Genome } from '../genome/schema.js';
import { evaluateOutput } from '../genome/evaluate.js';
import { applyMutation } from '../genome/mutation.js';
import type { NodeCapability, Plan, Step, StepResult } from '../types.js';
import { formatMeshViz } from '../mesh/viz.js';

export type StepExecutor = (args: {
  node: NodeCapability;
  step: Step;
  priorContext: string;
  stepIndex: number;
}) => Promise<StepResult>;

export interface ExecutePlanOptions {
  maxAttemptsPerStep?: number;
  log?: (line: string) => void;
  /** Run step 1 on multiple nodes in parallel and keep best-scoring output (mesh intelligence). Default true. */
  parallelFirstStep?: boolean;
  parallelWidth?: number;
  /** Live evolution: score each step output; mutate genome when below threshold. */
  evolution?: {
    ref: { current: Genome };
    threshold: number;
  };
  /** After each completed step (await — use for 0G log + [Verification] block). */
  afterEachStep?: (args: { stepIndex: number; result: StepResult }) => Promise<void>;
  /** Print [Mesh] ASCII bar when routing changes. Default true. */
  meshViz?: boolean;
  /**
   * Resume after crash: skip completed steps. `priorResults.length` must equal `nextStepIndex`.
   * Orchestrator continues from step index `nextStepIndex`.
   */
  resume?: {
    nextStepIndex: number;
    priorResults: StepResult[];
  };
}

/** Mesh orchestrator — parallel competition on step 1, chaining, retries, evolution hooks. */
export class MeshOrchestrator {
  private rr = 0;

  constructor(private readonly nodes: NodeCapability[]) {
    if (nodes.length === 0) throw new Error('no nodes registered');
  }

  private pickStartIndex(): number {
    const i = this.rr % this.nodes.length;
    this.rr += 1;
    return i;
  }

  private logMesh(log: (s: string) => void, activeIds: Set<string>, meshViz: boolean) {
    if (!meshViz) return;
    log(formatMeshViz(this.nodes, activeIds));
  }

  private runEvolution(
    result: StepResult,
    opts: ExecutePlanOptions,
    log: (s: string) => void,
  ) {
    const ev = opts.evolution;
    if (!ev) return;
    const score = evaluateOutput(result.output);
    const g = ev.ref.current;
    log(`[Genome] ${g.id} score: ${score.toFixed(2)}`);
    if (score < ev.threshold) {
      ev.ref.current = applyMutation(g);
      log(`[Genome] mutated → ${ev.ref.current.id} (threshold ${ev.threshold})`);
    } else {
      log(`[Genome] promoted → ${g.id} (score ≥ ${ev.threshold})`);
    }
  }

  async executePlan(plan: Plan, executor: StepExecutor, options?: ExecutePlanOptions): Promise<StepResult[]> {
    const log = options?.log ?? ((_s: string) => {});
    const maxAttempts = options?.maxAttemptsPerStep ?? this.nodes.length;
    const meshViz = options?.meshViz !== false;
    const parallelFirst = options?.parallelFirstStep !== false;
    const parallelW = Math.min(options?.parallelWidth ?? 2, this.nodes.length);

    const resume = options?.resume;
    const nextIdx = resume?.nextStepIndex ?? 0;
    const priorResults = resume?.priorResults ?? [];
    if (resume && priorResults.length !== nextIdx) {
      throw new Error(
        `resume mismatch: nextStepIndex=${nextIdx} but priorResults.length=${priorResults.length}`,
      );
    }
    if (nextIdx > plan.steps.length) {
      throw new Error(`resume nextStepIndex ${nextIdx} exceeds plan (${plan.steps.length} steps)`);
    }

    log('[Orchestrator] Plan:');
    plan.steps.forEach((s, i) => {
      const role = (s as Step & { role?: string }).role ?? 'worker';
      log(`  ${i + 1}. ${s.title ?? s.id} (${role})`);
    });
    if (nextIdx > 0) {
      log(`[Orchestrator] resuming from step ${nextIdx + 1} (${priorResults.length} completed)`);
    }

    const results: StepResult[] = [...priorResults];
    let priorContext = '';
    for (let i = 0; i < priorResults.length && i < plan.steps.length; i++) {
      const sid = plan.steps[i]!.id;
      priorContext += `\n\n### ${sid}\n${priorResults[i]!.output}`;
    }

    for (let si = nextIdx; si < plan.steps.length; si++) {
      const step = plan.steps[si]!;
      const label = step.title ?? step.id;

      const fullPrior =
        priorContext.length > 0
          ? `${step.description}\n\n--- PREVIOUS OUTPUT (chain) ---\n${priorContext.slice(-24_000)}`
          : step.description;
      const stepForLlm: Step = { ...step, description: fullPrior };

      /** Parallel competition — step index 0 only */
      if (si === 0 && parallelFirst && this.nodes.length >= 2) {
        const competing = this.nodes.slice(0, parallelW);
        log(
          `[Routing] Step ${si + 1} (${label}) → PARALLEL ${competing.map(n => n.id).join(' + ')}`,
        );
        this.logMesh(log, new Set(competing.map(n => n.id)), meshViz);

        const settled = await Promise.allSettled(
          competing.map(node =>
            executor({ node, step: stepForLlm, priorContext, stepIndex: si }),
          ),
        );

        this.logMesh(log, new Set(), meshViz);

        const ok: StepResult[] = [];
        for (let i = 0; i < settled.length; i++) {
          const node = competing[i]!;
          const r = settled[i]!;
          if (r.status === 'fulfilled') ok.push(r.value);
          else log(`[Orchestrator] ${node.id} failed (parallel leg): ${r.reason}`);
        }
        if (ok.length === 0) throw new Error('all parallel workers failed step 1');

        const scored = ok.map(r => ({ r, s: evaluateOutput(r.output) }));
        const best = scored.reduce((a, b) => (a.s >= b.s ? a : b));
        log(
          `[Orchestrator] competition scores: ${scored.map(x => `${x.r.nodeId}=${x.s.toFixed(2)}`).join(', ')}`,
        );
        log(`[Orchestrator] winner → ${best.r.nodeId}`);
        for (const x of scored) {
          if (x.r.nodeId !== best.r.nodeId) {
            log(`[Orchestrator] discarded clone output from ${x.r.nodeId}`);
          }
        }

        results.push(best.r);
        priorContext += `\n\n### ${step.id}\n${best.r.output}`;
        this.runEvolution(best.r, options ?? {}, log);
        await options?.afterEachStep?.({ stepIndex: si, result: best.r });
        continue;
      }

      /** Sequential steps with retry rotation */
      let attempt = 0;
      const start = this.pickStartIndex();
      let lastErr: Error | null = null;

      while (attempt < maxAttempts) {
        const nodeIdx = (start + attempt) % this.nodes.length;
        const node = this.nodes[nodeIdx]!;

        log(`[Routing] Step ${si + 1} (${label}) → ${node.id}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
        this.logMesh(log, new Set([node.id]), meshViz);

        try {
          const r = await executor({
            node,
            step: stepForLlm,
            priorContext,
            stepIndex: si,
          });

          this.logMesh(log, new Set(), meshViz);

          results.push(r);
          priorContext += `\n\n### ${step.id}\n${r.output}`;
          this.runEvolution(r, options ?? {}, log);
          await options?.afterEachStep?.({ stepIndex: si, result: r });
          lastErr = null;
          break;
        } catch (e: unknown) {
          this.logMesh(log, new Set(), meshViz);
          lastErr = e instanceof Error ? e : new Error(String(e));
          log(`[Orchestrator] ${node.id} failed: ${lastErr.message}`);
          log(`[Orchestrator] reassigning step → try another node`);
          attempt += 1;
        }
      }

      if (lastErr != null) throw lastErr;
    }

    return results;
  }
}
