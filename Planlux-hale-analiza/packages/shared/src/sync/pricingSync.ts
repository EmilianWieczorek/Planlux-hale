/**
 * Synchronizacja bazy cennika: GET meta → porównanie version → GET base → zapis lokalny.
 * Działa offline (brak zapisu przy braku połączenia).
 */

import type { ApiClient } from "../api/client";
import type { BaseResponse } from "../api/types";

export interface PricingSyncStorage {
  getLocalVersion(): number;
  savePricingSnapshot(version: number, lastUpdated: string, data: BaseResponse): void;
}

export interface PricingSyncResult {
  updated: boolean;
  version: number;
  error?: string;
}

export async function syncPricingIfNewer(
  api: ApiClient,
  storage: PricingSyncStorage
): Promise<PricingSyncResult> {
  const localVersion = storage.getLocalVersion();

  let meta: BaseResponse | { meta: { version: number; lastUpdated: string }; ok: boolean };
  try {
    meta = await api.getMeta() as BaseResponse | { meta: { version: number; lastUpdated: string }; ok: boolean };
  } catch (e) {
    return {
      updated: false,
      version: localVersion,
      error: e instanceof Error ? e.message : "Network error",
    };
  }

  const remoteVersion = meta.meta?.version ?? 0;
  if (remoteVersion <= localVersion) {
    return { updated: false, version: localVersion };
  }

  let full: BaseResponse;
  try {
    full = await api.getBase();
  } catch (e) {
    return {
      updated: false,
      version: localVersion,
      error: e instanceof Error ? e.message : "Failed to fetch base",
    };
  }

  if (!full.ok || !full.cennik) {
    return {
      updated: false,
      version: localVersion,
      error: "Invalid base response",
    };
  }

  storage.savePricingSnapshot(
    full.meta.version,
    full.meta.lastUpdated,
    full
  );

  return {
    updated: true,
    version: full.meta.version,
  };
}
