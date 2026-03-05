/**
 * Sync config from backend (Supabase base_pricing) to local SQLite cache.
 * Uses api.getMeta() / api.getBase() – no Supabase client in renderer.
 * On app start: compare meta version with local; if different, download and save.
 */

import type { CachedBase } from "../infra/baseSync";
import { getLocalVersion, saveBase } from "../infra/db";

type Db = ReturnType<typeof import("better-sqlite3")>;

export interface BackendApiForConfigSync {
  getMeta(): Promise<{ ok?: boolean; meta?: { version: number; lastUpdated?: string } }>;
  getBase(): Promise<{ ok?: boolean; meta?: { version: number; lastUpdated: string }; cennik?: unknown[]; dodatki?: unknown[]; standard?: unknown[] }>;
}

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
 * 1. Fetch meta from backend (api.getMeta).
 * 2. Compare with local version (pricing_cache).
 * 3. If remote > local: fetch full base (api.getBase) and save to pricing_cache.
 * 4. On error: leave lastSyncResult as offline, do not throw – app continues with local data.
 */
export async function syncConfig(
  db: Db,
  logger?: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void },
  api?: BackendApiForConfigSync
): Promise<ConfigSyncResult> {
  const log = logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const localVersion = getLocalVersion(db);

  if (!api) {
    log.warn("[configSync] No API – skipping sync");
    lastSyncResult = { status: "unchanged", version: localVersion };
    return lastSyncResult;
  }

  let meta: { version: number; lastUpdated?: string } | null = null;
  try {
    const metaResponse = await api.getMeta();
    if (metaResponse?.meta)
      meta = { version: metaResponse.meta.version, lastUpdated: metaResponse.meta.lastUpdated };
  } catch (e) {
    log.warn("[configSync] Backend meta fetch failed – working offline", e);
    lastSyncResult = {
      status: "offline",
      version: localVersion,
      error: "Pracujesz w trybie offline — dane mogą być nieaktualne",
    };
    return lastSyncResult;
  }

  if (!meta) {
    log.warn("[configSync] No meta from backend");
    lastSyncResult = { status: "offline", version: localVersion, error: "Brak wersji konfiguracji" };
    return lastSyncResult;
  }

  const forceRefresh = process.env.LOG_LEVEL === "debug";
  if (!forceRefresh && meta.version <= localVersion) {
    log.info("[configSync] unchanged", { version: meta.version });
    lastSyncResult = { status: "unchanged", version: meta.version, lastUpdated: meta.lastUpdated };
    return lastSyncResult;
  }

  if (forceRefresh) {
    log.info("[configSync] pricing cache version before", { localVersion });
  }
  log.info("[configSync] fetching base", { version: meta.version, forceRefresh: forceRefresh || undefined });
  let baseData: { meta: { version: number; lastUpdated: string }; cennik: unknown[]; dodatki: unknown[]; standard: unknown[] };
  try {
    const res = await api.getBase();
    if (!res?.ok || !res.meta) throw new Error("Invalid base response");
    baseData = {
      meta: res.meta,
      cennik: res.cennik ?? [],
      dodatki: res.dodatki ?? [],
      standard: res.standard ?? [],
    };
  } catch (e) {
    log.error("[configSync] Backend base fetch failed", e);
    lastSyncResult = {
      status: "offline",
      version: localVersion,
      error: "Pracujesz w trybie offline — dane mogą być nieaktualne",
    };
    return lastSyncResult;
  }

  log.info("[configSync] payload loaded", {
    version: baseData.meta.version,
    cennik: baseData.cennik.length,
    dodatki: baseData.dodatki.length,
    standard: baseData.standard.length,
  });

  const variants = [...new Set((baseData.cennik as Array<{ wariant_hali?: string; variant?: string }>).map((r) => (r.wariant_hali ?? r.variant ?? "").trim()).filter(Boolean))];
  const variantsCount = variants.length;
  if (process.env.LOG_LEVEL === "debug") {
    log.info("[configSync] variants after fetch", { count: variantsCount, first5: variants.slice(0, 5) });
  }
  if (variantsCount === 0 && baseData.cennik.length > 0) {
    const firstRow = baseData.cennik[0] as Record<string, unknown>;
    const payloadKeys = Object.keys(firstRow);
    const errMsg = `Pricing sync: zero variants – calculator will not work. Payload keys on first cennik row: ${payloadKeys.join(", ")}. Ensure base_pricing.payload.cennik has wariant_hali (or variant) and cena.`;
    log.error("[configSync] " + errMsg);
    lastSyncResult = { status: "error", version: localVersion, error: errMsg };
    return lastSyncResult;
  }
  if (variantsCount === 0 && baseData.cennik.length === 0) {
    log.warn("[configSync] base has no cennik rows – not overwriting cache");
    lastSyncResult = { status: "unchanged", version: localVersion, error: "Brak pozycji cennika" };
    return lastSyncResult;
  }

  const base: CachedBase = {
    version: baseData.meta.version,
    lastUpdated: baseData.meta.lastUpdated ?? new Date().toISOString(),
    cennik: baseData.cennik,
    dodatki: baseData.dodatki,
    standard: baseData.standard,
  };

  try {
    saveBase(db, base);
    log.info("[configSync] saved", { version: base.version });
    if (process.env.LOG_LEVEL === "debug") {
      log.info("[configSync] pricing cache version after", { version: base.version });
    }
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
