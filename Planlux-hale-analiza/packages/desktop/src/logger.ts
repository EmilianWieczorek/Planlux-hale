/**
 * Logger – debug + file log (file optional for MVP).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const minLevel: LogLevel = (process.env.PLANLUX_LOG_LEVEL as LogLevel) ?? (process.env.NODE_ENV === "production" ? "warn" : "info");

function shouldLog(level: LogLevel): boolean {
  return LEVEL[level] >= LEVEL[minLevel];
}

function format(level: string, msg: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : "";
  return `[${ts}] [${level.toUpperCase()}] ${msg}${suffix}`;
}

export const logger = {
  debug(msg: string, data?: unknown) {
    if (shouldLog("debug")) console.log(format("debug", msg, data));
  },
  info(msg: string, data?: unknown) {
    if (shouldLog("info")) console.log(format("info", msg, data));
  },
  warn(msg: string, data?: unknown) {
    if (shouldLog("warn")) console.warn(format("warn", msg, data));
  },
  error(msg: string, err?: unknown) {
    if (shouldLog("error")) {
      const payload = err instanceof Error ? { message: err.message, stack: err.stack } : err;
      console.error(format("error", msg, payload));
    }
  },
};
