/**
 * Sync config from Supabase to local SQLite cache.
 * On app start: compare meta version with local; if different, download and save.
 * If Supabase is unavailable, app runs with existing local data (offline).
 */

import type { CachedBase } from "../infra/baseSync";
import { getLocalVersion, saveBase } from "../infra/db";
import { getPricingSurface, getAddons, getStandardIncluded, getMetaVersion } from "./supabaseService";

type Db = ReturnType<typeof import("better-sqlite3")>;

export interface ConfigSyncResult {
  status: "synced" | "offline" | "unchanged" | "error";
  version?: number;
  lastUpdated?: string;
  error?: string;
}

/** Last sync result – set by syncConfig() for IPC/renderer to read. */
let lastSyncResult: ConfigSyncResult = { status: "unchanged" };

export function getConfigSyncStatus(): ConfigSyncResult {
  return lastSyncResult;
}

/**
 * 1. Fetch meta version from Supabase.
 * 2. Compare with local version (pricing_cache).
 * 3. If remote > local: download pricing_surface, addons_surcharges, standard_included and save to pricing_cache.
 * 4. On Supabase error: leave lastSyncResult as offline, do not throw – app continues with local data.
 */
export async function syncConfig(
  db: Db,
  logger?: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void }
): Promise<ConfigSyncResult> {
  const log = logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const localVersion = getLocalVersion(db);

  let meta: { version: number; last_updated?: string } | null = null;
  try {
    meta = await getMetaVersion();
  } catch (e) {
    log.warn("[configSync] Supabase meta fetch failed – working offline", e);
    lastSyncResult = {
      status: "offline",
      version: localVersion,
      error: "Pracujesz w trybie offline — dane mogą być nieaktualne",
    };
    return lastSyncResult;
  }

  if (!meta) {
    log.warn("[configSync] No meta row in Supabase");
    lastSyncResult = { status: "offline", version: localVersion, error: "Brak wersji konfiguracji" };
    return lastSyncResult;
  }

  if (meta.version <= localVersion) {
    log.info("[configSync] unchanged", { version: meta.version });
    lastSyncResult = { status: "unchanged", version: meta.version, lastUpdated: meta.last_updated };
    return lastSyncResult;
  }

  log.info("[configSync] fetching from Supabase", { remoteVersion: meta.version });
  let pricingSurface: unknown[];
  let addons: unknown[];
  let standardIncluded: unknown[];
  try {
    [pricingSurface, addons, standardIncluded] = await Promise.all([
      getPricingSurface(),
      getAddons(),
      getStandardIncluded(),
    ]);
  } catch (e) {
    log.error("[configSync] Supabase fetch failed", e);
    lastSyncResult = {
      status: "offline",
      version: localVersion,
      error: "Pracujesz w trybie offline — dane mogą być nieaktualne",
    };
    return lastSyncResult;
  }

  const base: CachedBase = {
    version: meta.version,
    lastUpdated: meta.last_updated ?? new Date().toISOString(),
    cennik: pricingSurface,
    dodatki: addons,
    standard: standardIncluded,
  };

  try {
    saveBase(db, base);
    log.info("[configSync] saved", { version: base.version });
    lastSyncResult = { status: "synced", version: base.version, lastUpdated: base.lastUpdated };
    return lastSyncResult;
  } catch (e) {
    log.error("[configSync] save failed", e);
    lastSyncResult = {
      status: "error",
      version: localVersion,
      error: e instanceof Error ? e.message : "Błąd zapisu konfiguracji",
    };
    return lastSyncResult;
  }
}
