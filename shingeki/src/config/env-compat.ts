/**
 * Environment-variable compatibility shim for the shingeki → sigli rename.
 *
 * The documented prefix is now `SIGLI_`, but existing deployments use
 * `SHINGEKI_`. This module mirrors the two prefixes in both directions at
 * import time, so either name resolves to the same value and old configs keep
 * working. Whichever prefix is already set wins; we never overwrite.
 *
 * Importing this module has the side effect of populating `process.env`.
 * It is idempotent and safe to import from multiple entry points.
 */
const NEW = 'SIGLI_';
const OLD = 'SHINGEKI_';

function mirror(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue;
    if (key.startsWith(OLD)) {
      const alias = NEW + key.slice(OLD.length);
      if (process.env[alias] == null) process.env[alias] = value;
    } else if (key.startsWith(NEW)) {
      const alias = OLD + key.slice(NEW.length);
      if (process.env[alias] == null) process.env[alias] = value;
    }
  }
}

mirror();

export {};
