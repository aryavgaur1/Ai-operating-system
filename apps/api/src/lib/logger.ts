// ============================================================
// Structured logging — every log line is a single-line JSON
// object so it's easy to grep, ship to a log aggregator later,
// or just read in the terminal. Covers: server lifecycle, auth
// events, email sends, Notion API calls, and errors.
// ============================================================

type Level = 'info' | 'warn' | 'error';

function write(level: Level, event: string, detail: Record<string, unknown> = {}) {
  const line = {
    time: new Date().toISOString(),
    level,
    event,
    ...detail,
  };
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(JSON.stringify(line));
}

export const logger = {
  info: (event: string, detail?: Record<string, unknown>) => write('info', event, detail),
  warn: (event: string, detail?: Record<string, unknown>) => write('warn', event, detail),
  error: (event: string, detail?: Record<string, unknown>) => write('error', event, detail),
};
