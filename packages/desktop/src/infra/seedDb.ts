/**
 * Seed DB – gotowa baza pricingu dostarczana z aplikacją.
 * Przy pierwszym uruchomieniu lub pustym/uszkodzonym pricingu odtwarzamy dane tylko z tabel pricingowych.
 * Nie nadpisujemy ofert, użytkowników ani sesji.
 */

import path from "path";
import fs from "fs";

type Db = ReturnType<typeof import("better-sqlite3")>;
type Logger = { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, e?: unknown) => void };

const SEED_DB_FILENAME = "planlux_seed.db";

/**
 * Ścieżka do seed DB w zależności od środowiska.
 * - Packaged: process.resourcesPath/assets/db/planlux_seed.db
 * - Dev (run from dist): __dirname = dist/infra, assets w dist/assets lub packages/desktop/assets
 */
export function getSeedDbPath(options: {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  /** dist/infra when running from dist/electron/main.js → dist is parent of electron */
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
 * Odtwarza tylko warstwę pricingu w istniejącej bazie użytkownika z seed DB.
 * Nie dotyka tabel: users, offers, pdfs, emails, outbox, activity, sessions.
 * Kopiuje/ nadpisuje: config_sync_meta (id=1), pricing_cache, pricing_surface, addons_surcharges, standard_included.
 */
export function restorePricingFromSeedDb(userDb: Db, seedPath: string, logger: Logger): boolean {
  let seedDb: Db | null = null;
  try {
    const Database = require("better-sqlite3");
    seedDb = new Database(seedPath, { readonly: true });
  } catch (e) {
    logger.warn("[seed-db] could not open seed database", e);
    return false;
  }

  const s = seedDb;
  if (!s) return false;

  try {
    const hasSeedCache = (s.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_cache'").get() as { name?: string } | undefined)?.name === "pricing_cache";
    if (!hasSeedCache) {
      logger.warn("[seed-db] seed database has no pricing_cache table");
      return false;
    }

    const seedRow = s.prepare(
      "SELECT pricing_version, last_updated, cennik_json, dodatki_json, standard_json FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1"
    ).get() as { pricing_version: number; last_updated: string; cennik_json: string; dodatki_json: string; standard_json: string } | undefined;
    if (!seedRow) {
      logger.warn("[seed-db] seed pricing_cache is empty");
      return false;
    }

    userDb.exec("DELETE FROM pricing_cache");
    userDb.prepare(
      `INSERT INTO pricing_cache (pricing_version, last_updated, cennik_json, dodatki_json, standard_json, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      seedRow.pricing_version,
      seedRow.last_updated,
      seedRow.cennik_json,
      seedRow.dodatki_json,
      seedRow.standard_json
    );

    const hasSurface = (userDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined)?.name === "pricing_surface";
    if (hasSurface) {
      userDb.prepare("DELETE FROM pricing_surface").run();
      const surfaceRows = s.prepare("SELECT data_json FROM pricing_surface").all() as Array<{ data_json: string }>;
      const insSurface = userDb.prepare("INSERT INTO pricing_surface (data_json) VALUES (?)");
      for (const r of surfaceRows) {
        insSurface.run(r.data_json);
      }
    }

    const hasAddons = (userDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='addons_surcharges'").get() as { name?: string } | undefined)?.name === "addons_surcharges";
    if (hasAddons) {
      userDb.prepare("DELETE FROM addons_surcharges").run();
      const addonsRows = s.prepare("SELECT data_json FROM addons_surcharges").all() as Array<{ data_json: string }>;
      const insAddons = userDb.prepare("INSERT INTO addons_surcharges (data_json) VALUES (?)");
      for (const r of addonsRows) {
        insAddons.run(r.data_json);
      }
    }

    const hasStandard = (userDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='standard_included'").get() as { name?: string } | undefined)?.name === "standard_included";
    if (hasStandard) {
      userDb.prepare("DELETE FROM standard_included").run();
      const standardRows = s.prepare("SELECT data_json FROM standard_included").all() as Array<{ data_json: string }>;
      const insStandard = userDb.prepare("INSERT INTO standard_included (data_json) VALUES (?)");
      for (const r of standardRows) {
        insStandard.run(r.data_json);
      }
    }

    const hasMeta = (userDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='config_sync_meta'").get() as { name?: string } | undefined)?.name === "config_sync_meta";
    if (hasMeta) {
      userDb.prepare("INSERT OR REPLACE INTO config_sync_meta (id, version, last_synced_at) VALUES (1, ?, ?)").run(seedRow.pricing_version, seedRow.last_updated);
    }

    let seedVersion: number | null = null;
    try {
      const meta = s.prepare("SELECT seed_version FROM seed_meta WHERE id = 1").get() as { seed_version?: number } | undefined;
      seedVersion = meta?.seed_version ?? null;
    } catch {
      // seed_meta may not exist in older seed files
    }
    s.close();

    logger.info("[seed-db] pricing restored from seed database", {
      cennik_json_length: seedRow.cennik_json.length,
      seed_version: seedVersion ?? "unknown",
    });
    return true;
  } catch (e) {
    logger.warn("[seed-db] restore from seed failed", e);
    try {
      s.close();
    } catch {
      // ignore
    }
    return false;
  }
}

/**
 * Zwraca wersję seed z pliku seed DB (bez otwierania user DB).
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
