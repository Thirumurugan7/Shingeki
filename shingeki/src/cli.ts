#!/usr/bin/env node
/**
 * Shingeki CLI — demo [--mesh] [--preset gpu|japan] | hub | node
 *
 * Demo narrative: distributed mesh → parallel competition (step 1) → live genome evolution
 * → per-step 0G verifiable traces + TEE line.
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ethers } from 'ethers';

import { genomeFromConfig, type AgentMeshConfig, type Genome } from './genome/schema.js';
import { MeshOrchestrator } from './orchestrator/orchestrator.js';
import { loadKvEnv, ShingekiKv } from './og/kv.js';
import { MeshHub } from './coordination/ws-hub.js';
import { runWorkerHost } from './coordination/worker-host.js';
import { createMeshStepExecutor, hubUrlFromEnv, openOrchestratorSession } from './coordination/mesh-orchestrator-ws.js';
import type { NodeCapability, Plan, Step, StepResult } from './types.js';
import { NodeRuntime } from './node-runtime/runtime.js';
import {
  GPU_LLM_RESEARCH_GOAL,
  JAPAN_TRIP_GOAL,
  planJapanTrip,
  planResearchAnalyzeDecide,
} from './planner/research-plan.js';
import { appendTraceWithRetry } from './og/log.js';
import { checkDemoEnv, printEnvReport } from './config/env-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const shingekiRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });
config({ path: path.join(shingekiRoot, '.env') });

function loadAgentMesh(configPath: string): AgentMeshConfig {
  const raw = fs.readFileSync(configPath, 'utf8');
  return parseYaml(raw) as AgentMeshConfig;
}

function parseDemoArgs(argv: string[]): { mesh: boolean; preset: 'gpu' | 'japan'; rest: string[] } {
  let mesh = false;
  let preset: 'gpu' | 'japan' = 'gpu';
  const out: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--mesh' || a === '-m') mesh = true;
    else if (a === '--preset' && argv[i + 1]) {
      const p = argv[i + 1]!.toLowerCase();
      if (p === 'gpu' || p === 'japan') preset = p as 'gpu' | 'japan';
      i += 1;
    } else if (a.startsWith('-')) out.push(a);
    else out.push(a);
    i += 1;
  }
  return { mesh, preset, rest: out };
}

function buildPlan(taskId: string, preset: 'gpu' | 'japan'): Plan {
  if (preset === 'japan') return planJapanTrip(taskId);
  return planResearchAnalyzeDecide(taskId);
}

function taskSummary(preset: 'gpu' | 'japan'): string {
  return preset === 'japan' ? JAPAN_TRIP_GOAL : GPU_LLM_RESEARCH_GOAL;
}

/** Prominent [Verification] block for judges + crypto-native story. */
async function verifyStepOnChain(
  wallet: ethers.Wallet | null,
  stepDisplay: number,
  result: StepResult,
  taskLabel: string,
) {
  const tee =
    (result.teeTrace as { tee_verified?: boolean } | undefined)?.tee_verified === true;

  if (!wallet) {
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} — 0G Log Store skipped (set PRIVATE_KEY in .env)`);
    console.log(`  Router x_0g_trace / TEE verified: ${tee}`);
    return;
  }

  const indexerRpc = process.env.INDEXER_RPC ?? loadKvEnv().indexerRpc;
  const rpcUrl = loadKvEnv().rpcUrl;
  const entry = {
    step: stepDisplay,
    node: result.nodeId,
    input: taskLabel.slice(0, 500),
    output: result.output.slice(0, 2000),
    signature: tee ? 'tee:router' : undefined,
    timestamp: Date.now(),
  };

  try {
    const { rootHash } = await appendTraceWithRetry(indexerRpc, rpcUrl, wallet, entry);
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} logged to 0G`);
    console.log(`  Trace ID: ${rootHash}`);
    console.log(`  TEE Verified: ${tee}`);
  } catch (e: unknown) {
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} — upload failed: ${(e as Error).message}`);
    console.log(`  Router TEE (from response): ${tee}`);
  }
}

async function cmdDemo() {
  const argv = process.argv.slice(3);
  const { mesh, preset, rest } = parseDemoArgs(argv);
  const taskOverride = rest.join(' ').trim();

  const envReport = checkDemoEnv();
  printEnvReport(envReport, console.log);
  if (!envReport.ok) {
    console.error('\nFix .env (see repo .env.example) and retry.');
    process.exit(1);
  }

  const cfgPath = path.join(shingekiRoot, 'agentmesh.example.yaml');
  const cfg = loadAgentMesh(cfgPath);
  const genome = genomeFromConfig(cfg);
  const genomeRef = { current: genome };

  const taskId = `task-${Date.now()}`;
  const plan = buildPlan(taskId, preset);
  const summary = taskOverride || taskSummary(preset);

  const evolveThreshold = Number(process.env.SHINGEKI_EVOLVE_THRESHOLD ?? '0.55');

  console.log('─── Shingeki demo ───');
  console.log('Goal:', summary.split('\n').map(l => l.trim()).join(' '));
  console.log('Preset:', preset, mesh ? '| mesh (hub + workers)' : '| local (in-process nodes)');
  console.log(`Evolution threshold (score < → mutate): ${evolveThreshold}`);
  console.log();

  const nodes: NodeCapability[] = [
    { id: 'node-1', capabilities: ['llm', 'executor'], latencyMs: 120, stake: 10 },
    { id: 'node-2', capabilities: ['llm', 'critic'], latencyMs: 200, stake: 10 },
  ];

  const log = (line: string) => console.log(line);

  const pk = process.env.PRIVATE_KEY;
  const wallet = pk
    ? new ethers.Wallet(pk, new ethers.JsonRpcProvider(loadKvEnv().rpcUrl))
    : null;

  const planOpts = {
    maxAttemptsPerStep: nodes.length,
    log,
    parallelFirstStep: true,
    parallelWidth: 2,
    meshViz: true,
    evolution: {
      ref: genomeRef,
      threshold: evolveThreshold,
    },
    afterEachStep: async ({ stepIndex, result }: { stepIndex: number; result: StepResult }) => {
      await verifyStepOnChain(wallet, stepIndex + 1, result, summary);
    },
  };

  if (mesh) {
    const hubUrl = hubUrlFromEnv();
    const minNodes = Math.max(2, cfg.mesh?.min_nodes ?? 2);
    log(`[Orchestrator] connecting hub ${hubUrl} (need ${minNodes} workers)`);
    const ws = await openOrchestratorSession(hubUrl, minNodes, 120_000, log);

    const orch = new MeshOrchestrator(nodes);
    const exec = createMeshStepExecutor(ws, () => genomeRef.current, { stepTimeoutMs: 240_000 });

    const wrapMesh: typeof exec = async args => {
      log(`[${args.node.id}] executing step: ${args.step.title ?? args.step.id}`);
      log(`[${args.node.id}] calling 0G Compute (${genomeRef.current.model})`);
      const r = await exec(args);
      log(`[${args.node.id}] result received (latency: ${(r.latencyMs / 1000).toFixed(1)}s)`);
      log(`[${args.node.id}] STEP_RESULT received at orchestrator`);
      return r;
    };

    const results = await orch.executePlan(plan, wrapMesh, planOpts);

    await finalize(results, genomeRef.current, taskId);
    ws.close();
    return;
  }

  const orch = new MeshOrchestrator(nodes);

  const localExec = async (args: {
    node: NodeCapability;
    step: Step;
    priorContext: string;
    stepIndex: number;
  }) => {
    const label = args.step.title ?? args.step.id;
    log(`[${args.node.id}] executing step: ${label}`);
    log(`[${args.node.id}] calling 0G Compute (${genomeRef.current.model})`);
    const runtime = new NodeRuntime({ nodeId: args.node.id }, genomeRef.current);
    const r = await runtime.executeStep(args.step);
    log(`[${args.node.id}] result received (latency: ${(r.latencyMs / 1000).toFixed(1)}s)`);
    return r;
  };

  const results = await orch.executePlan(plan, localExec, planOpts);

  await finalize(results, genomeRef.current, taskId);
}

async function finalize(results: StepResult[], genome: Genome, taskId: string) {
  const pk = process.env.PRIVATE_KEY;
  if (pk) {
    try {
      const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(loadKvEnv().rpcUrl));
      const kv = new ShingekiKv(wallet, loadKvEnv());
      const ver = Date.now();
      await kv.setJson(
        `mesh:genome:${taskId}`,
        { genomeId: genome.id, taskId, stepCount: results.length },
        ver,
      );
      console.log('\n[0G KV] genome checkpoint written version', ver);
    } catch (e: unknown) {
      console.warn('[0G KV] skip:', (e as Error).message);
    }
  } else {
    console.log('\n(PRIVATE_KEY unset — genome KV checkpoint skipped)');
  }

  console.log('\n─── Final synthesis (last step output excerpt) ───');
  const last = results[results.length - 1]?.output ?? '';
  console.log(last.slice(0, 4000));
  console.log('\nDone.', taskId, '| active genome:', genome.id);
}

function cmdHub() {
  const port = Number(process.env.SHINGEKI_HUB_PORT ?? 8765);
  const authToken = process.env.SHINGEKI_HUB_TOKEN;
  const hub = new MeshHub({ port, authToken });
  hub.listen();
  console.log(`Shingeki hub listening on ws://127.0.0.1:${port}`);
  console.log(
    authToken
      ? 'Hub auth: enabled — clients must set SHINGEKI_HUB_TOKEN (not logged)'
      : 'Hub auth: disabled — set SHINGEKI_HUB_TOKEN for shared-secret mode',
  );
  console.log('Start workers: NODE_ID=node-1 npm run node   (separate terminals)');
}

function cmdNode() {
  const cfgPath = path.join(shingekiRoot, 'agentmesh.example.yaml');
  const cfg = loadAgentMesh(cfgPath);
  const genome = genomeFromConfig(cfg);

  const url = hubUrlFromEnv();
  const nodeId =
    process.env.NODE_ID ??
    process.env.SHINGEKI_NODE_ID ??
    `node-${Math.random().toString(36).slice(2, 8)}`;

  runWorkerHost(url, nodeId, genome, ['llm'], console.log);
  console.log(`Worker ${nodeId} → ${url}`);
}

async function main() {
  const cmd = process.argv[2] ?? 'demo';
  if (cmd === 'demo') await cmdDemo();
  else if (cmd === 'hub') cmdHub();
  else if (cmd === 'node') cmdNode();
  else {
    console.log(`Usage: node --import tsx src/cli.ts <demo|hub|node> [demo flags]`);
    console.log(`  demo                    GPU research (parallel step 1 + evolution + 0G verification)`);
    console.log(`  demo --mesh             hub + workers (same)`);
    console.log(`  SHINGEKI_EVOLVE_THRESHOLD=0.55   score below → genome mutates`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
