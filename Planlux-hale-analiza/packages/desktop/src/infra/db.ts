/**
 * DB module – pricing_cache, offers, pdfs.
 * Uses existing schema in shared; provides typed helpers.
 */

import type { CachedBase } from "./baseSync";

type Db = ReturnType<typeof import("better-sqlite3")>;

export function getLocalVersion(db: Db): number {
  const row = db.prepare("SELECT MAX(pricing_version) as v FROM pricing_cache").get() as { v: number | null };
  return row?.v ?? 0;
}

export function getLocalLastUpdated(db: Db): string | null {
  const row = db.prepare("SELECT last_updated FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1").get() as { last_updated: string } | undefined;
  return row?.last_updated ?? null;
}

export function saveBase(db: Db, base: CachedBase): void {
  db.prepare(
    `INSERT OR REPLACE INTO pricing_cache (pricing_version, last_updated, cennik_json, dodatki_json, standard_json, fetched_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(
    base.version,
    base.lastUpdated,
    JSON.stringify(base.cennik),
    JSON.stringify(base.dodatki),
    JSON.stringify(base.standard)
  );
}

export function getCachedBase(db: Db): CachedBase | null {
  const row = db.prepare(
    "SELECT pricing_version, last_updated, cennik_json, dodatki_json, standard_json FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1"
  ).get() as { pricing_version: number; last_updated: string; cennik_json: string; dodatki_json: string; standard_json: string } | undefined;
  if (!row) return null;
  return {
    version: row.pricing_version,
    lastUpdated: row.last_updated,
    cennik: JSON.parse(row.cennik_json),
    dodatki: JSON.parse(row.dodatki_json),
    standard: JSON.parse(row.standard_json),
  };
}

export function insertPdf(
  db: Db,
  params: { id: string; offerId: string | null; userId: string; clientName: string; fileName: string; filePath: string; status: string; totalPln?: number; widthM?: number; lengthM?: number; heightM?: number; areaM2?: number; variantHali?: string; errorMessage?: string }
): void {
  const stmt = db.prepare(
    `INSERT INTO pdfs (id, offer_id, user_id, client_name, file_path, file_name, status, error_message, total_pln, width_m, length_m, height_m, area_m2, variant_hali)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    params.id,
    params.offerId,
    params.userId,
    params.clientName,
    params.filePath,
    params.fileName,
    params.status,
    params.errorMessage ?? null,
    params.totalPln ?? null,
    params.widthM ?? null,
    params.lengthM ?? null,
    params.heightM ?? null,
    params.areaM2 ?? null,
    params.variantHali ?? null
  );
}
