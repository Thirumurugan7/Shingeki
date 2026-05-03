#!/usr/bin/env node
/**
 * Shingeki CLI — run [--mesh] [--preset gpu|japan] | hub | node   (alias: demo)
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { exec } from 'node:child_process';
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
import { splitCompoundTask } from './orchestrator/planner.js';
import { planToRequiredRoles } from './orchestrator/orchestrator.js';
import { appendTraceWithRetry } from './og/log.js';
import { checkRunEnv, printEnvReport } from './config/env-check.js';
import {
  assertHubProductionSafe,
  assertMeshClientProductionSafe,
  hubPort,
} from './config/runtime-config.js';
import {
  defaultCheckpointDir,
  readCheckpoint,
  writeCheckpointAtomic,
  type DemoCheckpoint,
} from './infra/checkpoint.js';
import { addLineageEntry } from './infra/lineage-store.js';
import { routerInfer } from './og/compute-router.js';
import type { NodeCapabilities } from './coordination/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const shingekiRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });
config({ path: path.join(shingekiRoot, '.env') });

function loadAgentMesh(configPath: string): AgentMeshConfig {
  const raw = fs.readFileSync(configPath, 'utf8');
  return parseYaml(raw) as AgentMeshConfig;
}

function parseRunArgs(argv: string[]): {
  mesh: boolean;
  preset: 'gpu' | 'japan';
  resumeTaskId?: string;
  taskIdArg?: string;
  taskArg?: string;
  rest: string[];
} {
  let mesh = false;
  let preset: 'gpu' | 'japan' = 'gpu';
  let resumeTaskId: string | undefined;
  let taskIdArg: string | undefined;
  let taskArg: string | undefined;
  const out: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--mesh' || a === '-m') mesh = true;
    else if (a === '--preset' && argv[i + 1]) {
      const p = argv[i + 1]!.toLowerCase();
      if (p === 'gpu' || p === 'japan') preset = p as 'gpu' | 'japan';
      i += 1;
    } else if (a === '--resume' && argv[i + 1]) {
      resumeTaskId = argv[i + 1]!;
      i += 1;
    } else if (a === '--task-id' && argv[i + 1]) {
      taskIdArg = argv[i + 1]!;
      i += 1;
    } else if (a === '--task' && argv[i + 1]) {
      taskArg = argv[i + 1]!;
      i += 1;
    } else out.push(a);
    i += 1;
  }
  return { mesh, preset, resumeTaskId, taskIdArg, taskArg, rest: out };
}

function buildPlan(taskId: string, preset: 'gpu' | 'japan'): Plan {
  if (preset === 'japan') return planJapanTrip(taskId);
  return planResearchAnalyzeDecide(taskId);
}

function taskSummary(preset: 'gpu' | 'japan'): string {
  return preset === 'japan' ? JAPAN_TRIP_GOAL : GPU_LLM_RESEARCH_GOAL;
}

async function verifyStepOnChain(
  wallet: ethers.Wallet | null,
  stepDisplay: number,
  result: StepResult,
  taskLabel: string,
) {
  const tee =
    (result.teeTrace as { tee_verified?: boolean } | undefined)?.tee_verified === true;
  const evalTee = result.evalResult?.tee_verified === true;

  if (!wallet) {
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} — 0G Log Store skipped (set PRIVATE_KEY in .env)`);
    console.log(`  Router TEE: ${tee}  Eval TEE: ${evalTee}  Eval path: ${result.evalResult?.path ?? 'n/a'}`);
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
    rootHash: undefined,
  };

  try {
    const { rootHash } = await appendTraceWithRetry(indexerRpc, rpcUrl, wallet, entry);
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} logged to 0G`);
    console.log(`  Trace ID   : ${rootHash}`);
    console.log(`  Router TEE : ${tee}`);
    console.log(`  Eval score : ${result.evalResult?.score?.toFixed(2) ?? 'n/a'} (${result.evalResult?.path ?? 'n/a'})`);
    console.log(`  Eval TEE   : ${evalTee}`);
  } catch (e: unknown) {
    console.log('');
    console.log('[Verification]');
    console.log(`  Step ${stepDisplay} — upload failed: ${(e as Error).message}`);
    console.log(`  Router TEE: ${tee}  Eval path: ${result.evalResult?.path ?? 'n/a'}`);
  }
}

async function cmdRun() {
  const argv = process.argv.slice(3);
  const { mesh, preset, resumeTaskId, taskIdArg, taskArg, rest } = parseRunArgs(argv);
  const taskOverride = rest.join(' ').trim();

  const envReport = checkRunEnv();
  printEnvReport(envReport, console.log);
  if (!envReport.ok) {
    console.error('\nFix .env (see repo .env.example) and retry.');
    process.exit(1);
  }

  const checkpointDir = defaultCheckpointDir(shingekiRoot);
  let cp: DemoCheckpoint | null = null;
  if (resumeTaskId) {
    cp = readCheckpoint(checkpointDir, resumeTaskId);
    if (!cp) { console.error(`No checkpoint for "${resumeTaskId}" under ${checkpointDir}`); process.exit(1); }
    if (cp.preset !== preset) { console.error(`Checkpoint preset ${cp.preset} does not match --preset ${preset}`); process.exit(1); }
    if (cp.mesh !== mesh) { console.error(`Checkpoint mesh=${cp.mesh} does not match current mesh flag (${mesh})`); process.exit(1); }
    if (cp.results.length !== cp.nextStepIndex) { console.error('Checkpoint corrupt: results.length must equal nextStepIndex'); process.exit(1); }
  }

  const cfgPath = path.join(shingekiRoot, 'agentmesh.example.yaml');
  const cfg = loadAgentMesh(cfgPath);
  const baseGenome = genomeFromConfig(cfg);
  const genomeRef = { current: cp?.genome ?? baseGenome };

  const taskId = cp?.taskId ?? taskIdArg ?? `task-${Date.now()}`;
  if (taskIdArg && cp && cp.taskId !== taskIdArg) {
    console.error('--task-id must match checkpoint task id when using --resume');
    process.exit(1);
  }

  const plan = taskArg ? splitCompoundTask(taskId, taskArg) : buildPlan(taskId, preset);
  const summary = cp?.summary ?? (taskArg ?? (taskOverride || taskSummary(preset)));
  const evolveThreshold = cp?.evolveThreshold ?? Number(process.env.SHINGEKI_EVOLVE_THRESHOLD ?? '0.55');

  const rollingResults: StepResult[] = cp ? [...cp.results] : [];

  const persistCheckpoint = (stepIndex: number, result: StepResult) => {
    rollingResults[stepIndex] = result;
    const slice = rollingResults.slice(0, stepIndex + 1);
    const payload: DemoCheckpoint = {
      version: 1, taskId, preset, mesh,
      nextStepIndex: stepIndex + 1,
      results: slice,
      genome: genomeRef.current,
      evolveThreshold, summary,
      updatedAt: Date.now(),
    };
    writeCheckpointAtomic(checkpointDir, payload);
  };

  console.log('─── Shingeki run ───');
  console.log('Goal:', summary.split('\n').map(l => l.trim()).join(' '));
  console.log('Preset:', preset, mesh ? '| mesh (hub + workers)' : '| local (in-process nodes)');
  console.log(`Evolution threshold (score < → mutate): ${evolveThreshold}`);
  if (cp) {
    console.log(`Resume: ${checkpointDir} | next step index ${cp.nextStepIndex} / ${plan.steps.length}`);
  } else {
    console.log(`Checkpoint dir: ${checkpointDir}`);
  }
  console.log();

  const log = (line: string) => console.log(line);

  // Derive node pool from the plan's domain requirements — self-organizing local mesh.
  const requiredRoles = planToRequiredRoles(plan);
  const nodes: NodeCapability[] = [];
  let nodeSeq = 1;
  for (const [domain, count] of Object.entries(requiredRoles)) {
    for (let ni = 0; ni < count; ni++) {
      nodes.push({
        id: `node-${nodeSeq++}`,
        capabilities: ['llm', domain],
        specialization: domain === 'general' ? [] : [domain],
        latencyMs: 100 + nodeSeq * 20,
        stake: 10,
      });
    }
  }
  const rolesSummary = Object.entries(requiredRoles)
    .map(([r, n]) => `${n} ${r} specialist${n > 1 ? 's' : ''}`)
    .join(', ');
  log(`Shingeki spawned ${nodes.length} nodes: ${rolesSummary}`);

  const pk = process.env.PRIVATE_KEY;
  const wallet = pk
    ? new ethers.Wallet(pk, new ethers.JsonRpcProvider(loadKvEnv().rpcUrl))
    : null;

  const resumeOpts =
    cp && cp.nextStepIndex > 0 && cp.nextStepIndex <= plan.steps.length
      ? { nextStepIndex: cp.nextStepIndex, priorResults: [...cp.results] }
      : undefined;

  if (cp && cp.nextStepIndex >= plan.steps.length) {
    console.log('[Orchestrator] checkpoint complete — running finalize only.');
    await finalize(cp.results, genomeRef.current, taskId);
    return;
  }

  const planOpts = {
    maxAttemptsPerStep: nodes.length,
    log,
    parallelFirstStep: true,
    parallelWidth: 2,
    meshViz: true,
    evolution: {
      ref: genomeRef,
      threshold: evolveThreshold,
      taskDescription: summary,
      onLineageEntry: (entry: Parameters<typeof addLineageEntry>[0]) => {
        addLineageEntry(entry);
        // In mesh mode, also send to hub so the viewer sees it.
        if (mesh && meshWs && meshWs.readyState === 1 /* OPEN */) {
          meshWs.send(JSON.stringify({ type: 'GENOME_LINEAGE', payload: entry }));
        }
      },
    },
    resume: resumeOpts,
    afterEachStep: async ({ stepIndex, result }: { stepIndex: number; result: StepResult }) => {
      persistCheckpoint(stepIndex, result);
      await verifyStepOnChain(wallet, stepIndex + 1, result, summary);
    },
  };

  // meshWs is set if --mesh mode; used by onLineageEntry closure above.
  let meshWs: import('ws').WebSocket | null = null;

  if (mesh) {
    assertMeshClientProductionSafe();
    const hubUrl = hubUrlFromEnv();
    const minNodes = Math.max(2, cfg.mesh?.min_nodes ?? 2);
    log(`[Orchestrator] connecting hub ${hubUrl} (need ${minNodes} workers)`);
    const { ws, workerIds, capabilities } = await openOrchestratorSession(hubUrl, minNodes, 120_000, log);
    meshWs = ws;

    // Build NodeCapability from actual registered IDs + advertised capabilities.
    const defaultRoles = ['executor', 'critic'];
    const meshNodes: NodeCapability[] = workerIds.map((id, i) => {
      const cap = capabilities[id];
      return {
        id,
        capabilities: ['llm', cap?.role ?? defaultRoles[i % defaultRoles.length]!],
        role: cap?.role,
        specialization: cap?.specialization ?? [],
        latencyMs: cap?.latency_ms,
      };
    });
    log(`[Orchestrator] routing over: ${meshNodes.map(n => `${n.id}(${n.role ?? 'general'})`).join(', ')}`);

    const orch = new MeshOrchestrator(meshNodes);
    const exec = createMeshStepExecutor(ws, () => genomeRef.current, { stepTimeoutMs: 240_000 });

    const wrapMesh: typeof exec = async args => {
      log(`[${args.node.id}] executing step: ${args.step.title ?? args.step.id}`);
      log(`[${args.node.id}] calling 0G Compute (${genomeRef.current.model})`);
      const r = await exec(args);
      log(`[${args.node.id}] result received (latency: ${(r.latencyMs / 1000).toFixed(1)}s)`);
      return r;
    };

    const results = await orch.executePlan(plan, wrapMesh, planOpts);
    await finalize(results, genomeRef.current, taskId);
    ws.close();
    return;
  }

  const orch = new MeshOrchestrator(nodes);

  const localExec = async (args: { node: NodeCapability; step: Step; priorContext: string; stepIndex: number }) => {
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
      await kv.setJson(`mesh:genome:${taskId}`, { genomeId: genome.id, taskId, stepCount: results.length }, ver);
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

async function cmdHub() {
  assertHubProductionSafe();
  const port = hubPort();
  const rawTok = process.env.SHINGEKI_HUB_TOKEN?.trim();
  const hub = new MeshHub({ port, authToken: rawTok || undefined });
  let closer: (() => Promise<void>) | undefined;
  let tls = false;
  try {
    const r = await hub.listen();
    closer = r.close;
    tls = r.tls;
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
  const h = tls ? 'https' : 'http';
  const w = tls ? 'wss' : 'ws';
  const viewerUrl = `${h}://127.0.0.1:${port}/viewer`;
  console.log(`Shingeki hub listening on ${w}://127.0.0.1:${port}`);
  console.log(
    `${h}://127.0.0.1:${port}/health   /ready   /metrics   /status   /lineage   /checkpoints   /checkpoint   POST /api/run`,
  );
  console.log(`Hub viewer (lineage + task checkpoints): ${viewerUrl}`);
  console.log(
    rawTok
      ? 'Hub auth: enabled — clients must set SHINGEKI_HUB_TOKEN (not logged)'
      : 'Hub auth: disabled — set SHINGEKI_HUB_TOKEN for shared-secret mode',
  );
  console.log('Start workers: NODE_ID=node-1 npm run node   (separate terminals)');

  // Auto-open viewer in interactive sessions.
  if (process.stdout.isTTY && !process.env.CI) {
    setTimeout(() => {
      exec(`open "${viewerUrl}" 2>/dev/null || xdg-open "${viewerUrl}" 2>/dev/null || true`, () => {});
    }, 600);
  }

  const shutdown = async () => {
    if (closer) await closer();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

async function cmdNode() {
  assertMeshClientProductionSafe();
  const cfgPath = path.join(shingekiRoot, 'agentmesh.example.yaml');
  const cfg = loadAgentMesh(cfgPath);
  const genome = genomeFromConfig(cfg);

  const url = hubUrlFromEnv();
  const nodeId =
    process.env.NODE_ID ??
    process.env.SHINGEKI_NODE_ID ??
    `node-${Math.random().toString(36).slice(2, 8)}`;

  const role = (process.env.NODE_ROLE ?? 'general') as NodeCapabilities['role'];
  const specialization = (process.env.NODE_SPECIALIZATION ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const costWeight = parseFloat(process.env.NODE_COST_WEIGHT ?? '1.0');

  // Warm-up inference call to measure self-reported latency.
  let latencyMs = 500;
  try {
    const t0 = Date.now();
    await routerInfer('ping', undefined, { max_tokens: 1 });
    latencyMs = Date.now() - t0;
  } catch {
    // Warmup failure is non-fatal; use default.
  }

  const nodeCapabilities: NodeCapabilities = {
    role,
    latency_ms: latencyMs,
    cost_weight: costWeight,
    specialization,
  };

  console.log(`Worker ${nodeId} → ${url}  role=${role} latency=${latencyMs}ms specialization=[${specialization.join(',')}]`);
  const host = runWorkerHost(url, nodeId, genome, ['llm'], nodeCapabilities, console.log);
  const stop = () => { host.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

async function main() {
  const cmd = process.argv[2] ?? 'run';
  if (cmd === 'run' || cmd === 'demo') await cmdRun();
  else if (cmd === 'hub') await cmdHub();
  else if (cmd === 'node') await cmdNode();
  else {
    console.log(`Usage: node --import tsx src/cli.ts <run|hub|node> [flags]`);
    console.log(`  run                          orchestrate task (parallel step 1 + evolution + 0G verification)`);
    console.log(`  run --preset japan           structured Japan-trip preset`);
    console.log(`  run --mesh                   distributed workers via hub (+ lineage viewer)`);
    console.log(`  run --resume task-…          continue after crash (checkpoint)`);
    console.log(`  run --task "…"               free-form task (semicolon-separated steps; infers domains)`);
    console.log(`  demo                         alias for run (same behavior)`);
    console.log(`  hub                          start hub + open genome lineage viewer`);
    console.log(`  node                         start worker (NODE_ID, NODE_ROLE, NODE_SPECIALIZATION)`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
