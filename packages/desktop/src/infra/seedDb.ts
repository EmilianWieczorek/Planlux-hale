/**
 * Seed DB – gotowa baza SQLite dostarczana z aplikacją.
 * Model: BAD DB → REPLACE WITH FRESH SEED DB (copy whole file).
 * Nie naprawiamy częściowo – podmieniamy całą bazę na seed.
 */

import path from "path";
import fs from "fs";

type Db = ReturnType<typeof import("better-sqlite3")>;
type Logger = { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, e?: unknown) => void; error?: (msg: string, e?: unknown) => void };

const SEED_DB_FILENAME = "planlux_seed.db";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Ścieżka do seed DB w zależności od środowiska.
 * Packaged: process.resourcesPath/assets/db/planlux_seed.db
 * Dev: appPath/assets/db lub dirname relative.
 */
export function getSeedDbPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  dirname: string;
}): string | null {
  const { isPackaged, resourcesPath, appPath, dirname } = options;
  if (isPackaged && resourcesPath) {
    const p = path.join(resourcesPath, "assets", "db", SEED_DB_FILENAME);
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.join(appPath, "assets", "db", SEED_DB_FILENAME),
    path.join(dirname, "..", "..", "assets", "db", SEED_DB_FILENAME),
    path.join(dirname, "..", "..", "..", "assets", "db", SEED_DB_FILENAME),
  ];
  for (const p of candidates) {
    const normalized = path.normalize(p);
    if (fs.existsSync(normalized)) return normalized;
  }
  return null;
}

/**
 * Waliduje lokalną bazę. Baza jest NIEPOPRAWNA jeśli:
 * - brak tabel pricing_cache / pricing_surface
 * - pricing_cache puste
 * - pricing_surface ma 0 rekordów
 * - cennik nie parsuje się lub nie jest tablicą
 * - cennik nie ma żadnego wariantu (wariant_hali)
 */
export function validateLocalDatabase(database: Db): ValidationResult {
  try {
    const hasCache = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_cache'").get() as { name?: string } | undefined)?.name === "pricing_cache";
    if (!hasCache) {
      return { ok: false, reason: "missing_pricing_cache_table", details: {} };
    }

    const hasSurface = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined)?.name === "pricing_surface";
    if (!hasSurface) {
      return { ok: false, reason: "missing_pricing_surface_table", details: {} };
    }

    const cacheRow = database.prepare(
      "SELECT cennik_json, dodatki_json, standard_json FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1"
    ).get() as { cennik_json?: string; dodatki_json?: string; standard_json?: string } | undefined;
    if (!cacheRow) {
      return { ok: false, reason: "pricing_cache_empty", details: {} };
    }

    let cennik: unknown[];
    try {
      const parsed = JSON.parse(cacheRow.cennik_json ?? "[]");
      if (!Array.isArray(parsed)) {
        return { ok: false, reason: "cennik_not_array", details: {} };
      }
      cennik = parsed;
    } catch {
      return { ok: false, reason: "cennik_json_invalid", details: {} };
    }

    if (cennik.length === 0) {
      return { ok: false, reason: "cennik_empty", details: {} };
    }

    const hasVariant = cennik.some((r: unknown) => {
      const row = r as Record<string, unknown> | null;
      if (!row || typeof row !== "object") return false;
      const id = String(row.wariant_hali ?? row.variant ?? "").trim();
      return id.length > 0;
    });
    if (!hasVariant) {
      return { ok: false, reason: "no_variants_in_cennik", details: { cennikCount: cennik.length } };
    }

    const surfaceCount = (database.prepare("SELECT COUNT(1) as c FROM pricing_surface").get() as { c?: number })?.c ?? 0;
    if (surfaceCount === 0) {
      return { ok: false, reason: "pricing_surface_empty", details: {} };
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "validation_error",
      details: { error: e instanceof Error ? e.message : String(e) },
    };
  }
}

/**
 * Kopiuje plik seed DB do docelowej ścieżki (np. userData/planlux-hale.db).
 */
export function copySeedToPath(seedPath: string, destPath: string): void {
  fs.copyFileSync(seedPath, destPath);
}

/**
 * Tworzy backup uszkodzonej bazy (planlux-hale.db.broken-YYYYMMDD-HHMMSS.bak),
 * usuwa aktywną bazę i kopiuje seed w jej miejsce.
 */
export function backupAndReplaceWithSeed(dbPath: string, seedPath: string, logger: Logger): void {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
  const backupPath = path.join(dir, `${base}.broken-${stamp}.bak`);
  if (fs.existsSync(dbPath)) {
    try {
      fs.copyFileSync(dbPath, backupPath);
      logger.info("[seed-db] backup created: " + backupPath);
    } catch (e) {
      logger.warn("[seed-db] backup failed", e);
    }
    try {
      fs.unlinkSync(dbPath);
    } catch (e) {
      logger.warn("[seed-db] delete old db failed", e);
      throw e;
    }
  }
  copySeedToPath(seedPath, dbPath);
  logger.info("[seed-db] copied seed database");
  logger.info("[seed-db] replaced with fresh seed database");
}

/**
 * Zwraca wersję seed z pliku seed DB (tabela seed_meta), lub null.
 */
export function getSeedVersionFromFile(seedPath: string): number | null {
  let conn: Db | null = null;
  try {
    const Database = require("better-sqlite3");
    conn = new Database(seedPath, { readonly: true });
    const row = (conn as Db).prepare("SELECT seed_version FROM seed_meta WHERE id = 1").get() as { seed_version?: number } | undefined;
    (conn as Db).close();
    return row?.seed_version ?? null;
  } catch {
    try {
      if (conn != null) conn.close();
    } catch {
      // ignore
    }
    return null;
  }
}
