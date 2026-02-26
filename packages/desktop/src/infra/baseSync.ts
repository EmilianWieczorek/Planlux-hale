/**
 * Base sync – offline-first pricing cache.
 * getRemoteMeta, getRemoteBase, syncBaseIfNeeded.
 */

import type { ApiClient } from "@planlux/shared";

const META_TIMEOUT_MS = 5000;

export interface SyncResult {
  status: "synced" | "offline" | "unchanged" | "error";
  version?: number;
  lastUpdated?: string;
  error?: string;
}

export interface CachedBase {
  version: number;
  lastUpdated: string;
  cennik: unknown[];
  dodatki: unknown[];
  standard: unknown[];
}

export async function getRemoteMeta(
  baseUrl: string,
  fetchFn: typeof fetch,
  timeoutMs = META_TIMEOUT_MS
): Promise<{ version: number; lastUpdated: string } | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const q of ["action=meta", "meta=1"]) {
      try {
        const res = await fetchFn(`${baseUrl}?${q}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = (await res.json()) as { ok?: boolean; meta?: { version: number; lastUpdated: string } };
        if (data?.meta) return { version: data.meta.version, lastUpdated: data.meta.lastUpdated };
      } catch {
        continue;
      }
    }
  } catch {
    /* offline */
  }
  clearTimeout(timeoutId);
  return null;
}

export async function getRemoteBase(api: ApiClient): Promise<CachedBase | null> {
  try {
    const data = await api.getBase();
    if (!data?.ok || !data.cennik) return null;
    return {
      version: data.meta.version,
      lastUpdated: data.meta.lastUpdated,
      cennik: data.cennik,
      dodatki: data.dodatki ?? [],
      standard: data.standard ?? [],
    };
  } catch {
    return null;
  }
}

export async function syncBaseIfNeeded(
  api: ApiClient,
  baseUrl: string,
  fetchFn: typeof fetch,
  getLocalVersion: () => number,
  saveBase: (base: CachedBase) => void,
  logger?: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void }
): Promise<SyncResult> {
  const localVersion = getLocalVersion();
  logger?.info("[baseSync] syncBaseIfNeeded start", { localVersion });

  const meta = await getRemoteMeta(baseUrl, fetchFn);
  if (!meta) {
    logger?.warn("[baseSync] offline or meta fetch failed");
    return {
      status: "offline",
      version: localVersion,
      error: "Offline – używam lokalnej bazy",
    };
  }

  if (meta.version <= localVersion) {
    logger?.info("[baseSync] unchanged", { version: meta.version });
    return { status: "unchanged", version: meta.version, lastUpdated: meta.lastUpdated };
  }

  logger?.info("[baseSync] fetching base", { remoteVersion: meta.version });
  const base = await getRemoteBase(api);
  if (!base) {
    return {
      status: "error",
      version: localVersion,
      error: "Nie udało się pobrać bazy",
    };
  }

  try {
    saveBase(base);
    logger?.info("[baseSync] saved", { version: base.version });
    return {
      status: "synced",
      version: base.version,
      lastUpdated: base.lastUpdated,
    };
  } catch (e) {
    return {
      status: "error",
      version: localVersion,
      error: e instanceof Error ? e.message : "Błąd zapisu",
    };
  }
}
