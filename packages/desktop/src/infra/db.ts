/**
 * DB module – pricing_cache, offers, pdfs.
 * Uses existing schema in shared; provides typed helpers.
 */

import type { CachedBase } from "./baseSync";

type Db = ReturnType<typeof import("better-sqlite3")>;

/** DEV-only: dump FK info for pdfs, email_outbox, email_history and database_list. */
export function dumpFkInfo(db: Db): { pdfs: unknown[]; email_outbox: unknown[]; email_history: unknown[]; database_list: unknown[] } {
  const tables = ["pdfs", "email_outbox", "email_history"] as const;
  const result: { pdfs: unknown[]; email_outbox: unknown[]; email_history: unknown[]; database_list: unknown[] } = {
    pdfs: [],
    email_outbox: [],
    email_history: [],
    database_list: [],
  };
  for (const t of tables) {
    try {
      (result as Record<string, unknown[]>)[t] = db.prepare(`PRAGMA foreign_key_list('${t}')`).all();
    } catch {
      (result as Record<string, unknown[]>)[t] = [];
    }
  }
  try {
    result.database_list = db.prepare("PRAGMA database_list").all();
  } catch {
    result.database_list = [];
  }
  if (process.env.NODE_ENV !== "production") {
    console.info("[db] dumpFkInfo", JSON.stringify(result, null, 2));
  }
  return result;
}

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

/**
 * Resolve offer_number to offers_crm.id (for FK-safe inserts).
 * Returns id or null if not found. Throws only on invalid input.
 */
export function getOfferIdByNumber(db: Db, offerNumber: string): string | null {
  if (!offerNumber || !String(offerNumber).trim()) return null;
  const row = db.prepare("SELECT id FROM offers_crm WHERE offer_number = ?").get(String(offerNumber).trim()) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Resolve offer number to offers_crm.id. Throws if not found.
 * Use for email/PDF flow so FK always references existing offer. Column: offer_number.
 */
export function getOfferIdByNumberOrThrow(db: Db, offerNumber: string): string {
  const id = getOfferIdByNumber(db, offerNumber);
  if (!id) throw new Error("Offer not found for number: " + offerNumber);
  return id;
}

/**
 * Latest PDF row for offer (for reuse / duplicate check).
 */
export function getLatestPdfByOfferId(db: Db, offerId: string): { id: string; file_path: string; file_name: string } | null {
  const row = db.prepare(
    "SELECT id, file_path, file_name FROM pdfs WHERE offer_id = ? AND file_path IS NOT NULL AND file_path != '' ORDER BY created_at DESC LIMIT 1"
  ).get(offerId.trim()) as { id: string; file_path: string; file_name: string } | undefined;
  return row ?? null;
}

/**
 * Ensure offer exists in offers_crm. Returns offers_crm.id.
 * If not found by id or offer_number, tries to sync from legacy offers table (minimal row); otherwise throws.
 */
export function ensureOfferCrmRow(db: Db, offerIdOrNumber: string): string {
  const s = String(offerIdOrNumber).trim();
  if (!s) throw new Error("Oferta nie istnieje w bazie CRM – odśwież i spróbuj ponownie.");
  const byId = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(s) as { id: string } | undefined;
  if (byId) return byId.id;
  const byNumber = db.prepare("SELECT id FROM offers_crm WHERE offer_number = ?").get(s) as { id: string } | undefined;
  if (byNumber) return byNumber.id;
  const hasOffers = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers'").get() as { name?: string } | undefined)?.name === "offers";
  const hasCrm = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").get() as { name?: string } | undefined)?.name === "offers_crm";
  if (hasOffers && hasCrm) {
    const offerRow = db.prepare(
      "SELECT id, user_id, client_name, width_m, length_m, height_m, area_m2, variant_hali, base_price_pln, total_pln, created_at, updated_at FROM offers WHERE id = ?"
    ).get(s) as { id: string; user_id: string; client_name: string; width_m: number; length_m: number; height_m: number | null; area_m2: number; variant_hali: string; base_price_pln: number | null; total_pln: number | null; created_at: string; updated_at: string } | undefined;
    if (offerRow) {
      const now = new Date().toISOString();
      const offerNumber = "TEMP-" + offerRow.id.slice(0, 8);
      db.prepare(
        `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, variant_hali, width_m, length_m, height_m, area_m2, base_price_pln, total_pln, created_at, updated_at)
         VALUES (?, ?, ?, 'GENERATED', ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        offerRow.id,
        offerNumber,
        offerRow.user_id,
        offerRow.client_name || "Klient",
        offerRow.variant_hali,
        offerRow.width_m,
        offerRow.length_m,
        offerRow.height_m ?? 0,
        offerRow.area_m2,
        offerRow.base_price_pln ?? 0,
        offerRow.total_pln ?? 0,
        offerRow.created_at || now,
        offerRow.updated_at || now
      );
      return offerRow.id;
    }
  }
  throw new Error("Oferta nie istnieje w bazie CRM – odśwież i spróbuj ponownie.");
}

/**
 * pdfs.offer_id REFERENCES offers_crm(id) (after migration). Check parent exists before insert.
 */
function ensureOfferExistsInOffersCrm(db: Db, offerId: string): void {
  const hasCrm = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").get() as { name?: string } | undefined)?.name === "offers_crm";
  if (!hasCrm) return;
  const existing = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(offerId) as { id: string } | undefined;
  if (!existing) throw new Error(`insertPdf: offerId "${offerId}" not found in offers_crm`);
}

/**
 * pdfs.offer_id must reference an existing offers_crm.id (FK after migration). Never pass null or a fake id.
 * Uses a transaction; on unique constraint rethrows so caller can reuse existing row.
 */
export function insertPdf(
  db: Db,
  params: { id: string; offerId: string; userId: string; clientName: string; fileName: string; filePath: string; status: string; totalPln?: number; widthM?: number; lengthM?: number; heightM?: number; areaM2?: number; variantHali?: string; errorMessage?: string }
): void {
  const offerId = params.offerId?.trim();
  if (!offerId) {
    throw new Error("insertPdf: offerId is required (must reference offers_crm.id)");
  }
  const run = (): void => {
    ensureOfferExistsInOffersCrm(db, offerId);
    const stmt = db.prepare(
      `INSERT INTO pdfs (id, offer_id, user_id, client_name, file_path, file_name, status, error_message, total_pln, width_m, length_m, height_m, area_m2, variant_hali)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    stmt.run(
      params.id,
      offerId,
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
  };
  try {
    const tx = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(run);
    tx();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const numRow = db.prepare("SELECT offer_number FROM offers_crm WHERE id = ?").get(offerId) as { offer_number: string } | undefined;
    const offerNumber = numRow?.offer_number ?? "(unknown)";
    const parentExists = (db.prepare("SELECT 1 FROM offers_crm WHERE id = ?").get(offerId) as unknown) != null;
    const pdfExists = getLatestPdfByOfferId(db, offerId) != null;
    console.error("insertPdf failed", { offerId, offerNumber, parentExists, pdfExists });
    if (msg.includes("FOREIGN KEY") || msg.includes("constraint failed")) {
      console.error("insertPdf FK/constraint", { offerId, offerNumber });
    }
    throw e;
  }
}
