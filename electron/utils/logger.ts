type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR'
}

function format(level: LogLevel, category: string, message: string, extra?: unknown): string {
  const ts = new Date().toISOString()
  const base = `${ts} [${LEVEL_PREFIX[level]}] [${category}] ${message}`
  if (extra !== undefined) {
    const detail = extra instanceof Error ? extra.message : JSON.stringify(extra)
    return `${base} — ${detail}`
  }
  return base
}

function createLogger(category: string) {
  return {
    debug(msg: string, extra?: unknown) { console.log(format('debug', category, msg, extra)) },
    info(msg: string, extra?: unknown) { console.log(format('info', category, msg, extra)) },
    warn(msg: string, extra?: unknown) { console.warn(format('warn', category, msg, extra)) },
    error(msg: string, extra?: unknown) { console.error(format('error', category, msg, extra)) }
  }
}

export type Logger = ReturnType<typeof createLogger>
export { createLogger }
