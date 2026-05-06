export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function levelValue(l: LogLevel): number {
  return LEVELS[l] ?? LEVELS.info;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLog(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function currentLogLevel(): LogLevel {
  const env = process.env.LOG_LEVEL as LogLevel | undefined;
  return env || 'info';
}

function shouldLog(level: LogLevel): boolean {
  return levelValue(level) >= levelValue(currentLogLevel());
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) {
      console.debug(formatLog('debug', message, meta));
    }
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) {
      console.info(formatLog('info', message, meta));
    }
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) {
      console.warn(formatLog('warn', message, meta));
    }
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) {
      console.error(formatLog('error', message, meta));
    }
  },
};
