/**
 * Backup DB, verify app not busy, run installer, quit.
 */

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import type { ReleaseInfo } from "./types";
import { setStatus } from "./updateState";

export interface InstallUpdateDeps {
  getDbPath: () => string;
  userDataPath: string;
  getBusyReasons: () => string[];
  quitApp: () => void;
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}

const BACKUPS_DIR = "backups";
const BACKUP_PREFIX = "db-backup-";
const BACKUP_SUFFIX = ".db";

function isPathInsideDir(candidate: string, dir: string): boolean {
  const normalized = path.normalize(candidate);
  const base = path.normalize(dir);
  return normalized === base || normalized.startsWith(base + path.sep);
}

/**
 * Copy DB to userData/backups/db-backup-{timestamp}.db
 */
function backupDatabase(dbPath: string, userDataPath: string, logger: InstallUpdateDeps["logger"]): string {
  const dir = path.join(userDataPath, BACKUPS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dir, `${BACKUP_PREFIX}${timestamp}${BACKUP_SUFFIX}`);
  fs.copyFileSync(dbPath, dest);
  logger.info("[updates] DB backup created", { path: dest });
  return dest;
}

/**
 * Run installer: backup DB, check busy, spawn installer, quit.
 * installerPath must be under userData/updates/ and .exe.
 */
export async function runInstaller(
  installerPath: string,
  _release: ReleaseInfo,
  deps: InstallUpdateDeps
): Promise<void> {
  const { getDbPath, userDataPath, getBusyReasons, quitApp, logger } = deps;

  setStatus("installing", _release);

  const busy = getBusyReasons();
  if (busy.length > 0) {
    const msg = "Instalacja zablokowana: " + busy.join(", ");
    logger.warn("[updates] install blocked", { reasons: busy });
    setStatus("error", _release, msg);
    throw new Error(msg);
  }

  const normalizedPath = path.normalize(installerPath);
  const updatesDir = path.join(userDataPath, "updates");
  if (!isPathInsideDir(normalizedPath, updatesDir)) {
    logger.error("[updates] installer path validation failed", { path: normalizedPath });
    setStatus("error", _release, "Nieprawidłowa ścieżka instalatora.");
    throw new Error("Installer path must be inside userData/updates");
  }
  if (path.extname(normalizedPath).toLowerCase() !== ".exe") {
    setStatus("error", _release, "Nieprawidłowy plik instalatora.");
    throw new Error("Installer must be .exe");
  }
  if (!fs.existsSync(normalizedPath)) {
    setStatus("error", _release, "Plik instalatora nie istnieje.");
    throw new Error("Installer file not found");
  }

  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    backupDatabase(dbPath, userDataPath, logger);
  }

  logger.info("[updates] installing", { path: normalizedPath });

  const child = spawn(normalizedPath, [], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();

  quitApp();
}
