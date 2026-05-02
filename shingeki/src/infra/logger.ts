/**
 * Structured JSON logs to stdout — parseable by agents (Datadog, CloudWatch, Loki).
 * Set LOG_LEVEL=debug|info|warn|error (default info). Human-friendly when LOG_PRETTY=1.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(): Level {
  const v = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  if (v === 'debug' || v === 'warn' || v === 'error') return v;
  return 'info';
}

const minLevel = LEVEL_ORDER[parseLevel()];
const pretty = process.env.LOG_PRETTY === '1' || process.env.LOG_PRETTY === 'true';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVEL_ORDER[level] < minLevel) return;
  const rec = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: 'shingeki',
    ...fields,
  };
  if (pretty) {
    const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
    console[level === 'error' ? 'error' : 'log'](`[${level}] ${msg}${extra}`);
  } else {
    (level === 'error' ? console.error : console.log)(JSON.stringify(rec));
  }
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) =>
      emit('debug', msg, { component, ...fields }),
    info: (msg: string, fields?: Record<string, unknown>) =>
      emit('info', msg, { component, ...fields }),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      emit('warn', msg, { component, ...fields }),
    error: (msg: string, fields?: Record<string, unknown>) =>
      emit('error', msg, { component, ...fields }),
  };
}

export const log = createLogger('shingeki');
