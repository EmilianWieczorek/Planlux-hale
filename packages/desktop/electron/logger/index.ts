/**
 * Logger: levels, file output (userData/planlux.log), rotation to planlux.old.log, redaction.
 * No secrets in logs. Use after app.getPath('userData') is available.
 */

import fs from "fs";
import path from "path";
import { redact } from "./redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const LOG_FILE = "planlux.log";
const LOG_FILE_OLD = "planlux.old.log";

let logPath: string | null = null;
let fileStream: fs.WriteStream | null = null;
let minLevel: LogLevel = "info";

export function initLogger(userDataPath: string, opts?: { level?: LogLevel }): void {
  try {
    logPath = path.join(userDataPath, LOG_FILE);
    minLevel =
      opts?.level ??
      (process.env.LOG_LEVEL as LogLevel) ??
      (process.env.PLANLUX_LOG_LEVEL as LogLevel) ??
      (process.env.NODE_ENV === "production" ? "warn" : "info");
  } catch {
    logPath = null;
  }
}

/** Returns current log file path for diagnostics/export. */
export function getLogPath(): string | null {
  return logPath;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function ensureRotate(): void {
  if (!logPath) return;
  try {
    if (fs.existsSync(logPath)) {
      const stat = fs.statSync(logPath);
      if (stat.size >= MAX_FILE_BYTES) {
        const oldPath = path.join(path.dirname(logPath), LOG_FILE_OLD);
        if (fileStream) {
          fileStream.end();
          fileStream = null;
        }
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        fs.renameSync(logPath, oldPath);
      }
    }
  } catch {
    // ignore
  }
}

function getStream(): fs.WriteStream | null {
  if (!logPath) return null;
  if (fileStream) return fileStream;
  try {
    ensureRotate();
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

/** Write a line to planlux.log from any process (e.g. renderer via IPC). Level and message only. */
export function writeLogLine(level: LogLevel, message: string, data?: unknown): void {
  if (!shouldLog(level)) return;
  const line = format(level, "", message, data);
  if (level === "error") console.error(line.trim());
  else if (level === "warn") console.warn(line.trim());
  else if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV_SERVER_URL) console.log(line.trim());
  getStream()?.write(line);
}

export type LoggerInstance = {
  child(scope: string): LoggerInstance;
  log(msg: string, meta?: unknown): void;
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
    log(msg: string, meta?: unknown) {
      if (!shouldLog("info")) return;
      const line = format("info", scope, msg, meta);
      if (process.env.NODE_ENV !== "production" || process.env.VITE_DEV_SERVER_URL) console.log(line.trim());
      getStream()?.write(line);
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
