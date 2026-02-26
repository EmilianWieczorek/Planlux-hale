/**
 * Implementacja PricingSyncStorage dla Electron – SQLite (better-sqlite3).
 * Używać w procesie main z istniejącą instancją bazy.
 */

import type { BaseResponse } from "@planlux/shared";
import type { PricingSyncStorage } from "@planlux/shared";

export function createPricingSyncStorage(db: { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => { pricing_version: number } | undefined } }): PricingSyncStorage {
  return {
    getLocalVersion(): number {
      const row = db.prepare(
        "SELECT MAX(pricing_version) AS pricing_version FROM pricing_cache"
      ).get();
      return (row?.pricing_version as number) ?? 0;
    },

    savePricingSnapshot(version: number, lastUpdated: string, data: BaseResponse): void {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO pricing_cache (pricing_version, last_updated, cennik_json, dodatki_json, standard_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      );
      stmt.run(
        version,
        lastUpdated,
        JSON.stringify(data.cennik ?? []),
        JSON.stringify(data.dodatki ?? []),
        JSON.stringify(data.standard ?? [])
      );
    },
  };
}
