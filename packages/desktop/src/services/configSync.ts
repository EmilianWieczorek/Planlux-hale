/**
 * Sync config from backend (Supabase base_pricing) to local SQLite cache.
 * Desktop-first: SQLite is source of truth at runtime; Supabase is sync source.
 * Never report "unchanged" when local cache has no usable cennik.
 */

import { getLocalVersion, getCachedBase, loadBaseFromLocalTables, saveBase, type CachedBase } from "../infra/db";
import { seedBaseIfEmpty } from "../infra/seedBase";

type Db = ReturnType<typeof import("better-sqlite3")>;

export interface RelationalPricingResult {
  hallVariants: unknown[];
  cennik: unknown[];
  dodatki: unknown[];
  standard: unknown[];
  version: number;
  lastUpdated: string;
}

export interface BackendApiForConfigSync {
  getMeta(): Promise<{ ok?: boolean; meta?: { version: number; lastUpdated?: string } }>;
  /** @deprecated Prefer getRelationalPricing; base_pricing.payload no longer used for pricing. */
  getBase?(): Promise<{ ok?: boolean; meta?: { version: number; lastUpdated: string }; cennik?: unknown[]; dodatki?: unknown[]; standard?: unknown[] }>;
  /** Load pricing from Supabase relational tables (pricing_surface, addons_surcharges, standard_included). */
  getRelationalPricing?(): Promise<RelationalPricingResult | null>;
}

export type PricingSource = "remote" | "local-fallback" | "seed";

export interface ConfigSyncResult {
  status: "synced" | "offline" | "unchanged" | "error";
  version?: number;
  lastUpdated?: string;
  error?: string;
  /** Set when synced: where the pricing base came from. */
  source?: PricingSource;
}

/** Last sync result – set by syncConfig() for IPC/renderer to read. */
let lastSyncResult: ConfigSyncResult = { status: "unchanged" };

export function getConfigSyncStatus(): ConfigSyncResult {
  return lastSyncResult;
}

/** Normalized variant count from cennik (wariant_hali or variant). */
function getVariantCount(cennik: unknown[]): number {
  const variants = [...new Set(
    (cennik as Array<{ wariant_hali?: string; variant?: string }>)
      .map((r) => (r?.wariant_hali ?? r?.variant ?? "").trim())
      .filter(Boolean)
  )];
  return variants.length;
}

/**
 * 1. Fetch meta from backend (api.getMeta).
 * 2. Compare with local version; if remote > local OR local cache empty/unusable → fetch or fallback.
 * 3. Never treat as "unchanged" when local cache has no usable cennik.
 */
export async function syncConfig(
  db: Db,
  logger?: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, d?: unknown) => void },
  api?: BackendApiForConfigSync
): Promise<ConfigSyncResult> {
  const log = logger ?? { info: () => {}, warn: () => {}, error: () => {} };
  const localVersion = getLocalVersion(db);
  const localCache = getCachedBase(db);
  const localCennikCount = localCache?.cennik?.length ?? 0;
  const localVariantsCount = localCache ? getVariantCount(localCache.cennik) : 0;
  const localCacheUsable = localCennikCount > 0 && localVariantsCount > 0;

  log.info("[configSync] local state", {
    localVersion,
    localCennikCount,
    localVariantsCount,
    localCacheUsable,
  });

  if (!api) {
    log.warn("[configSync] No API – skipping sync");
    if (!localCacheUsable) {
      lastSyncResult = { status: "error", version: localVersion, error: "Brak API i brak lokalnej bazy cennika" };
      return lastSyncResult;
    }
    lastSyncResult = { status: "unchanged", version: localVersion };
    return lastSyncResult;
  }

  let meta: { version: number; lastUpdated?: string } | null = null;
  try {
    const metaResponse = await api.getMeta();
    if (metaResponse?.meta)
      meta = { version: metaResponse.meta.version, lastUpdated: metaResponse.meta.lastUpdated };
    log.info("[configSync] remote meta", { remoteVersion: meta?.version ?? 0 });
  } catch (e) {
    log.warn("[configSync] Backend meta fetch failed – working offline", e instanceof Error ? e.message : String(e));
    lastSyncResult = {
      status: "offline",
      version: localVersion,
      error: "Pracujesz w trybie offline — dane mogą być nieaktualne",
    };
    if (!localCacheUsable) {
      const local = loadBaseFromLocalTables(db);
      if (!local || local.cennik.length === 0) {
        const seeded = seedBaseIfEmpty(db);
        if (seeded) log.info("[configSync] seeded local base (offline, no cache)", { source: "seed" });
        const after = loadBaseFromLocalTables(db);
        if (after && after.cennik.length > 0) {
          saveBase(db, after);
          lastSyncResult = { status: "synced", version: after.version, lastUpdated: after.lastUpdated, source: seeded ? "seed" : "local-fallback" };
        } else {
          lastSyncResult = { status: "error", version: localVersion, error: "Brak bazy cennika (offline, lokalna pusta)" };
        }
        return lastSyncResult;
      }
      saveBase(db, local);
      lastSyncResult = { status: "synced", version: local.version, lastUpdated: local.lastUpdated, source: "local-fallback" };
    }
    return lastSyncResult;
  }

  if (!meta) {
    log.warn("[configSync] No meta from backend");
    if (!localCacheUsable) {
      const local = loadBaseFromLocalTables(db);
      if (local && local.cennik.length > 0) {
        saveBase(db, local);
        lastSyncResult = { status: "synced", version: local.version, lastUpdated: local.lastUpdated, source: "local-fallback" };
        return lastSyncResult;
      }
      lastSyncResult = { status: "error", version: localVersion, error: "Brak wersji konfiguracji i brak lokalnego cennika" };
    } else {
      lastSyncResult = { status: "offline", version: localVersion, error: "Brak wersji konfiguracji" };
    }
    return lastSyncResult;
  }

  const remoteVersion = meta.version;
  const versionSaysUnchanged = remoteVersion <= localVersion;
  const forceRefreshBecauseCacheEmpty = !localCacheUsable;
  const forceRefresh = forceRefreshBecauseCacheEmpty || localVersion === 0 || process.env.LOG_LEVEL === "debug";

  if (!forceRefresh && versionSaysUnchanged) {
    log.info("[configSync] unchanged (version ok, cache usable)", { version: remoteVersion, localCennikCount, localVariantsCount });
    lastSyncResult = { status: "unchanged", version: remoteVersion, lastUpdated: meta.lastUpdated };
    return lastSyncResult;
  }

  if (forceRefreshBecauseCacheEmpty) {
    log.info("[configSync] forcing refresh (local cache empty or no variants)", { localVersion, localCennikCount, localVariantsCount });
  } else if (forceRefresh) {
    log.info("[configSync] forcing refresh (localVersion=0 or debug)", { localVersion });
  }

  log.info("[configSync] fetching pricing (relational first)", { remoteVersion, forceRefresh });
  let baseData: { meta: { version: number; lastUpdated: string }; cennik: unknown[]; dodatki: unknown[]; standard: unknown[] } | null = null;
  let source: PricingSource = "remote";

  // 1) Try relational tables (pricing_surface, addons_surcharges, standard_included) – primary source.
  if (typeof api.getRelationalPricing === "function") {
    try {
      const rel = await api.getRelationalPricing();
      if (rel && Array.isArray(rel.cennik) && rel.cennik.length > 0) {
        baseData = {
          meta: { version: rel.version, lastUpdated: rel.lastUpdated },
          cennik: rel.cennik,
          dodatki: rel.dodatki ?? [],
          standard: rel.standard ?? [],
        };
        source = "remote";
        log.info("[configSync] relational pricing loaded", {
          source: "remote",
          version: baseData.meta.version,
          cennik: baseData.cennik.length,
          dodatki: baseData.dodatki.length,
          standard: baseData.standard.length,
          hallVariants: Array.isArray(rel.hallVariants) ? rel.hallVariants.length : 0,
        });
        if (process.env.LOG_LEVEL === "debug" && baseData.cennik.length > 0) {
          const first = baseData.cennik[0] as Record<string, unknown> | undefined;
          log.info("[configSync] first cennik row spec (PDF)", {
            Typ_Konstrukcji: first?.Typ_Konstrukcji ?? "(brak)",
            Typ_Dachu: first?.Typ_Dachu ?? first?.Dach ?? "(brak)",
            Boki: first?.Boki ?? "(brak)",
          });
        }
      } else {
        log.info("[configSync] getRelationalPricing returned empty (RLS or empty tables)", {
          hasRel: !!rel,
          cennikLength: rel?.cennik?.length ?? 0,
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      const code = (e as { code?: string })?.code;
      log.warn("[configSync] getRelationalPricing failed", {
        message: err.message,
        code: code ?? undefined,
        name: err.name,
      });
    }
  }

  // 2) Fallback: base_pricing.payload (getBase) when relational empty.
  if ((!baseData || baseData.cennik.length === 0) && typeof api.getBase === "function") {
    try {
      const baseRes = await api.getBase();
      if (baseRes?.cennik && Array.isArray(baseRes.cennik) && baseRes.cennik.length > 0) {
        baseData = {
          meta: {
            version: baseRes.meta?.version ?? 1,
            lastUpdated: baseRes.meta?.lastUpdated ?? new Date().toISOString(),
          },
          cennik: baseRes.cennik,
          dodatki: baseRes.dodatki ?? [],
          standard: baseRes.standard ?? [],
        };
        source = "remote";
        log.info("[configSync] base_pricing.payload loaded", {
          cennik: baseData.cennik.length,
          dodatki: baseData.dodatki.length,
          standard: baseData.standard.length,
        });
        if (process.env.LOG_LEVEL === "debug" && baseData.cennik.length > 0) {
          const first = baseData.cennik[0] as Record<string, unknown> | undefined;
          log.info("[configSync] first cennik row from base_pricing.payload (PDF spec)", {
            Typ_Konstrukcji: first?.Typ_Konstrukcji ?? first?.construction_type ?? "(brak)",
            Typ_Dachu: first?.Typ_Dachu ?? first?.Dach ?? first?.roof_type ?? "(brak)",
            Boki: first?.Boki ?? first?.walls ?? "(brak)",
          });
        }
      }
    } catch (e) {
      log.warn("[configSync] getBase (base_pricing.payload) failed", e instanceof Error ? e.message : String(e));
    }
  }

  // 3) Fallback: local SQLite tables (offline cache) + seed if empty.
  if (!baseData || baseData.cennik.length === 0) {
    log.info("[configSync] no relational/base_pricing data, using SQLite fallback / seed");
    let local = loadBaseFromLocalTables(db);
    let usedSeed = false;
    if (!local || local.cennik.length === 0) {
      log.info("[configSync] local tables empty, running seedBaseIfEmpty");
      usedSeed = seedBaseIfEmpty(db);
      if (usedSeed) {
        log.info("[configSync] seedBaseIfEmpty ran – loading from local tables");
        local = loadBaseFromLocalTables(db);
      } else {
        log.warn("[configSync] seedBaseIfEmpty did not run or returned no data (tables may already have rows or be missing)");
      }
    }
    if (local && local.cennik.length > 0) {
      baseData = {
        meta: { version: local.version, lastUpdated: local.lastUpdated },
        cennik: local.cennik,
        dodatki: local.dodatki,
        standard: local.standard,
      };
      source = usedSeed ? "seed" : "local-fallback";
      log.info("[configSync] using local fallback from SQLite", {
        source,
        cennik: baseData.cennik.length,
        dodatki: baseData.dodatki.length,
        standard: baseData.standard.length,
      });
    } else {
      log.error("[configSync] No pricing base available (relational empty, SQLite fallback empty, seed had no data)");
      lastSyncResult = {
        status: "error",
        version: localVersion,
        error: "Brak bazy cennika. Sprawdź połączenie z internetem i kliknij „Synchronizuj bazę”, lub skontaktuj się z supportem.",
      };
      return lastSyncResult;
    }
  }

  if (!baseData || !Array.isArray(baseData.cennik) || baseData.cennik.length === 0) {
    lastSyncResult = { status: "error", version: localVersion, error: "No pricing base available" };
    return lastSyncResult;
  }

  const variants = [...new Set((baseData.cennik as Array<{ wariant_hali?: string; variant?: string }>).map((r) => (r?.wariant_hali ?? r?.variant ?? "").trim()).filter(Boolean))];
  const variantsCount = variants.length;
  const firstRow = baseData.cennik[0] as Record<string, unknown> | undefined;
  const payloadKeys = firstRow ? Object.keys(firstRow) : [];

  log.info("[configSync] payload loaded", {
    version: baseData.meta.version,
    cennik: baseData.cennik.length,
    dodatki: baseData.dodatki.length,
    standard: baseData.standard.length,
    variantCount: variantsCount,
    firstCennikRowKeys: payloadKeys.slice(0, 10),
  });

  if (variantsCount === 0 && baseData.cennik.length > 0) {
    const errMsg = `Pricing sync: zero variants – calculator will not work. First cennik row keys: ${payloadKeys.join(", ")}. Ensure base_pricing.payload.cennik has wariant_hali (or variant) and cena.`;
    log.error("[configSync] " + errMsg);
    lastSyncResult = { status: "error", version: localVersion, error: errMsg };
    return lastSyncResult;
  }
  if (variantsCount === 0 && baseData.cennik.length === 0) {
    log.error("[configSync] base has no cennik rows – cannot overwrite cache");
    lastSyncResult = { status: "error", version: localVersion, error: "Brak pozycji cennika" };
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
    log.info("[configSync] saved", { version: base.version, source });
    if (process.env.LOG_LEVEL === "debug") {
      log.info("[configSync] pricing cache version after", { version: base.version });
    }
    lastSyncResult = { status: "synced", version: base.version, lastUpdated: base.lastUpdated, source };
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
