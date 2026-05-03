/**
 * Fail fast before `run` — never log secret values.
 */

export interface EnvCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function checkRunEnv(): EnvCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.ROUTER_API_KEY?.trim()) {
    errors.push('ROUTER_API_KEY is missing — Router inference will fail.');
  }

  if (!process.env.PRIVATE_KEY?.trim()) {
    warnings.push('PRIVATE_KEY unset — 0G Log / KV verification steps will be skipped.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function printEnvReport(r: EnvCheckResult, log: (s: string) => void) {
  for (const w of r.warnings) log(`[env] ${w}`);
  for (const e of r.errors) log(`[env] ERROR: ${e}`);
}
