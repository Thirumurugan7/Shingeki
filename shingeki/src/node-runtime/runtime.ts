import type { Genome } from '../genome/schema.js';
import type { Step, StepResult } from '../types.js';
import { routerInfer } from '../og/compute-router.js';
import { getUniswapQuote } from '../tools/uniswap.js';
import type { ControlPlane } from '../controls/control-plane.js';

export interface NodeRuntimeOptions {
  nodeId: string;
}

/**
 * Binds a NodeRuntime to a Sigli control plane. When present, every financial
 * tool call the agent emits is authorized against the agent's policy — and
 * logged to the audit trail — before it executes. Blocked or escalated actions
 * are not carried out.
 */
export interface NodeControls {
  plane: ControlPlane;
  /** Identity this runtime acts as; must be registered in the control plane. */
  agentId: string;
}

/** Worker — executes one planned step using Router-backed LLM (0G Compute path). */
export class NodeRuntime {
  constructor(
    private readonly opts: NodeRuntimeOptions,
    private readonly genome: Genome,
    private readonly controls?: NodeControls,
  ) {}

  /**
   * `step.description` should already include PREVIOUS OUTPUT chain when orchestrator passes chained prompts.
   */
  async executeStep(step: Step, _priorContext?: string): Promise<StepResult> {
    const role = step.role ?? 'worker';
    const systemParts = [
      `You are node ${this.opts.nodeId} in the Sigli mesh (${role}).`,
      `Strategy: ${this.genome.strategy}`,
      `Tools (declared): ${this.genome.tools.join(', ')}`,
      `Reflection depth: ${this.genome.reflection_depth}`,
      `Follow the user instruction exactly; cite PREVIOUS OUTPUT when present.`,
    ];
    if (this.genome.tools.includes('uniswap')) {
      systemParts.push(
        'You have access to Uniswap DeFi tools. To get a token swap quote, output a JSON block: ' +
        '{"tool":"uniswap_quote","tokenIn":"0x...","tokenOut":"0x...","amount":"<wei>","chainId":1}. ' +
        'The orchestrator will execute it and return results.',
      );
    }
    if (this.controls) {
      systemParts.push(
        'Financial actions are governed by Sigli. To request authorization for a spend, output a JSON block: ' +
        '{"tool":"spend","amountUsd":<number>,"counterparty":"<name>","memo":"<why>"}. ' +
        'The control plane will APPROVE, ESCALATE, or BLOCK it against your policy — do not assume a spend succeeded until it is approved.',
      );
    }
    const system = systemParts.join('\n');

    const r = await routerInfer(step.description, system, { max_tokens: 2048, temperature: 0.25, model: this.genome.model });

    let output = r.text;
    if (this.controls) output = await this.executeSpendToolCalls(output, step.id);
    if (this.genome.tools.includes('uniswap')) output = await executeUniswapToolCalls(output, this.controls, step.id);

    return {
      stepId: step.id,
      nodeId: this.opts.nodeId,
      output,
      latencyMs: r.latencyMs,
      teeTrace: r.trace,
    };
  }

  /** Scans output for `spend` tool calls and runs each through the control plane. */
  private async executeSpendToolCalls(text: string, task: string): Promise<string> {
    const controls = this.controls!;
    const matches = text.match(/\{[^{}]*"tool"\s*:\s*"spend"[^{}]*\}/g);
    if (!matches) return text;
    let result = text;
    for (const match of matches) {
      try {
        const p = JSON.parse(match) as { amountUsd: number; counterparty?: string; memo?: string };
        const decision = controls.plane.authorize({
          agentId: controls.agentId,
          amount: p.amountUsd,
          counterparty: p.counterparty,
          task: p.memo ?? task,
        });
        const summary =
          `\n\n**Sigli decision:** ${decision.outcome} — ${decision.reason} ` +
          `(rule: ${decision.rule}; agent: ${controls.agentId})`;
        result = result.replace(match, match + summary);
      } catch (e: unknown) {
        result = result.replace(match, match + `\n\n**Sigli error:** ${(e as Error).message}`);
      }
    }
    return result;
  }
}

/**
 * Scans LLM output for embedded uniswap_quote tool calls and executes them.
 * When a control plane is attached and the call carries `authorizeUsd`, the
 * spend is authorized first; a non-APPROVED decision skips the quote.
 */
async function executeUniswapToolCalls(
  text: string,
  controls: NodeControls | undefined,
  task?: string,
): Promise<string> {
  const matches = text.match(/\{[^{}]*"tool"\s*:\s*"uniswap_quote"[^{}]*\}/g);
  if (!matches) return text;
  let result = text;
  for (const match of matches) {
    try {
      const p = JSON.parse(match) as {
        tokenIn: string; tokenOut: string; amount: string;
        chainId: number; swapper?: string;
        authorizeUsd?: number; counterparty?: string;
      };

      if (controls && p.authorizeUsd != null) {
        const decision = controls.plane.authorize({
          agentId: controls.agentId,
          amount: p.authorizeUsd,
          counterparty: p.counterparty ?? 'uniswap',
          task: task ?? 'uniswap swap',
        });
        if (decision.outcome !== 'APPROVED') {
          result = result.replace(
            match,
            match + `\n\n**Sigli ${decision.outcome}:** ${decision.reason} — swap not executed.`,
          );
          continue;
        }
      }

      const quote = await getUniswapQuote({
        tokenIn: p.tokenIn, tokenOut: p.tokenOut, amount: p.amount,
        chainId: p.chainId,
        swapper: p.swapper ?? '0x0000000000000000000000000000000000000001',
      });
      const summary =
        `\n\n**Uniswap Quote:** routing=${quote.routing} | ` +
        `in=${quote.tokenIn.amount} | out=${quote.tokenOut.amount} | ` +
        `gasFeeUSD=${quote.gasFeeUSD} | priceImpact=${quote.priceImpact}% | route=${quote.routeString}`;
      result = result.replace(match, match + summary);
    } catch (e: unknown) {
      result = result.replace(match, match + `\n\n**Uniswap Quote Error:** ${(e as Error).message}`);
    }
  }
  return result;
}
