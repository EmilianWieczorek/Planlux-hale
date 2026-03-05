/**
 * Logger: levels, file output (userData/logs/app.log), rotation, redaction.
 * No secrets in logs. Use after app.getPath('userData') is available.
 */

import fs from "fs";
import path from "path";
import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BACKUPS = 3;
const LOG_DIR = "logs";
const LOG_FILE = "app.log";

let logDir: string | null = null;
let fileStream: fs.WriteStream | null = null;
let minLevel: LogLevel = "info";

export function initLogger(userDataPath: string, opts?: { level?: LogLevel }): void {
  try {
    logDir = path.join(userDataPath, LOG_DIR);
    fs.mkdirSync(logDir, { recursive: true });
    minLevel =
      opts?.level ??
      (process.env.LOG_LEVEL as LogLevel) ??
      (process.env.PLANLUX_LOG_LEVEL as LogLevel) ??
      (process.env.NODE_ENV === "production" ? "warn" : "info");
  } catch (e) {
    logDir = null;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function getStream(): fs.WriteStream | null {
  if (!logDir) return null;
  if (fileStream) return fileStream;
  try {
    const logPath = path.join(logDir, LOG_FILE);
    const stat = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
    if (stat && stat.size >= MAX_FILE_BYTES) {
      for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
        const from = path.join(logDir, i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`);
        const to = path.join(logDir, `${LOG_FILE}.${i}`);
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
    }
    fileStream = fs.createWriteStream(logPath, { flags: "a" });
    return fileStream;
  } catch {
    return null;
  }
}

function format(level: string, scope: string, msg: string, meta?: unknown, correlationId?: string): string {
  const ts = new Date().toISOString();
  const cid = correlationId ? ` [${correlationId}]` : "";
  const scopePart = scope ? ` [${scope}]` : "";
  const metaPart = meta !== undefined ? ` ${JSON.stringify(redact(meta))}` : "";
  return `${ts} [${level.toUpperCase()}]${scopePart}${cid} ${msg}${metaPart}\n`;
}

export type LoggerInstance = {
  child(scope: string): LoggerInstance;
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
};

function create(scope: string): LoggerInstance {
  return {
    child(childScope: string) {
      return create(scope ? `${scope}:${childScope}` : childScope);
    },
    debug(msg: string, meta?: unknown) {
      if (!shouldLog("debug")) return;
      const line = format("debug", scope, msg, meta);
      if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV_SERVER_URL) console.log(line.trim());
      getStream()?.write(line);
    },
    info(msg: string, meta?: unknown) {
      if (!shouldLog("info")) return;
      const line = format("info", scope, msg, meta);
      if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV_SERVER_URL) console.log(line.trim());
      getStream()?.write(line);
    },
    warn(msg: string, meta?: unknown) {
      if (!shouldLog("warn")) return;
      const line = format("warn", scope, msg, meta);
      console.warn(line.trim());
      getStream()?.write(line);
    },
    error(msg: string, meta?: unknown) {
      if (!shouldLog("error")) return;
      const line = format("error", scope, msg, meta);
      console.error(line.trim());
      getStream()?.write(line);
    },
  };
}

export const logger = create("app");
export { redact };
