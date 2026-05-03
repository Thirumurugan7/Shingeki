import type { Genome } from '../genome/schema.js';
import type { Step, StepResult } from '../types.js';
import { routerInfer } from '../og/compute-router.js';
import { getUniswapQuote } from '../tools/uniswap.js';

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
    const systemParts = [
      `You are node ${this.opts.nodeId} in the Shingeki mesh (${role}).`,
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
    const system = systemParts.join('\n');

    const r = await routerInfer(step.description, system, { max_tokens: 2048, temperature: 0.25, model: this.genome.model });
    const output = this.genome.tools.includes('uniswap')
      ? await executeUniswapToolCalls(r.text)
      : r.text;
    return {
      stepId: step.id,
      nodeId: this.opts.nodeId,
      output,
      latencyMs: r.latencyMs,
      teeTrace: r.trace,
    };
  }
}

/** Scans LLM output for embedded uniswap_quote tool calls and executes them. */
async function executeUniswapToolCalls(text: string): Promise<string> {
  const matches = text.match(/\{[^{}]*"tool"\s*:\s*"uniswap_quote"[^{}]*\}/g);
  if (!matches) return text;
  let result = text;
  for (const match of matches) {
    try {
      const p = JSON.parse(match) as {
        tokenIn: string; tokenOut: string; amount: string;
        chainId: number; swapper?: string;
      };
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
