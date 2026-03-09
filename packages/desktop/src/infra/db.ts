/**
 * DB module – pricing_cache, offers, pdfs.
 * Uses existing schema in shared; provides typed helpers.
 */

type Db = ReturnType<typeof import("better-sqlite3")>;

/** Cached pricing base (from Supabase or local fallback). */
export interface CachedBase {
  version: number;
  lastUpdated: string;
  cennik: unknown[];
  dodatki: unknown[];
  standard: unknown[];
}

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

/** Local version from config_sync_meta if present, else from pricing_cache. */
export function getLocalVersion(db: Db): number {
  try {
    const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='config_sync_meta'").get() as { name?: string } | undefined;
    if (hasMeta?.name) {
      const metaRow = db.prepare("SELECT version FROM config_sync_meta WHERE id = 1").get() as { version: number } | undefined;
      if (metaRow != null) return metaRow.version;
    }
  } catch {
    // ignore
  }
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
  updateConfigSyncMeta(db, base.version);
  writeBaseToLocalTables(db, base);
}

/** Row from cennik may have Typ_Konstrukcji, Typ_Dachu, Boki (or construction_type, roof_type, walls). */
function getSpecFromCennikRow(row: unknown): { construction_type: string | null; roof_type: string | null; walls: string | null } {
  const r = row as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return { construction_type: null, roof_type: null, walls: null };
  const construction_type = (r.Typ_Konstrukcji ?? r.construction_type) != null ? String(r.Typ_Konstrukcji ?? r.construction_type).trim() || null : null;
  const roof_type = (r.Typ_Dachu ?? r.Dach ?? r.roof_type) != null ? String(r.Typ_Dachu ?? r.Dach ?? r.roof_type).trim() || null : null;
  const walls = (r.Boki ?? r.walls) != null ? String(r.Boki ?? r.walls).trim() || null : null;
  return { construction_type, roof_type, walls };
}

/** Write base to pricing_surface, addons_surcharges, standard_included so local fallback has data. */
export function writeBaseToLocalTables(db: Db, base: CachedBase): void {
  try {
    const hasSurface = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined;
    if (!hasSurface?.name) return;
    const surfaceCols = db.prepare("PRAGMA table_info(pricing_surface)").all() as Array<{ name: string }>;
    const hasSpecCols = surfaceCols.some((c) => c.name === "construction_type");
    db.prepare("DELETE FROM pricing_surface").run();
    const insSurface = hasSpecCols
      ? db.prepare("INSERT INTO pricing_surface (data_json, construction_type, roof_type, walls) VALUES (?, ?, ?, ?)")
      : db.prepare("INSERT INTO pricing_surface (data_json) VALUES (?)");
    for (const row of base.cennik) {
      if (hasSpecCols) {
        const spec = getSpecFromCennikRow(row);
        insSurface.run(JSON.stringify(row), spec.construction_type, spec.roof_type, spec.walls);
      } else {
        insSurface.run(JSON.stringify(row));
      }
    }
    db.prepare("DELETE FROM addons_surcharges").run();
    const insAddons = db.prepare("INSERT INTO addons_surcharges (data_json) VALUES (?)");
    for (const row of base.dodatki) {
      insAddons.run(JSON.stringify(row));
    }
    db.prepare("DELETE FROM standard_included").run();
    const insStandard = db.prepare("INSERT INTO standard_included (data_json) VALUES (?)");
    for (const row of base.standard) {
      insStandard.run(JSON.stringify(row));
    }
  } catch {
    // ignore
  }
}

/** Update config_sync_meta.version and last_synced_at after a successful base save. */
export function updateConfigSyncMeta(db: Db, version: number): void {
  try {
    const now = new Date().toISOString();
    db.prepare("UPDATE config_sync_meta SET version = ?, last_synced_at = ? WHERE id = 1").run(version, now);
  } catch {
    // Table may not exist in older DBs
  }
}

/**
 * Load base pricing from local SQLite tables (pricing_surface, addons_surcharges, standard_included).
 * Used when Supabase base_pricing returns empty or fetch fails.
 * Returns null if tables are missing or cennik would be empty.
 */
export function loadBaseFromLocalTables(db: Db): CachedBase | null {
  try {
    const hasMeta = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='config_sync_meta'").get() as { name?: string } | undefined;
    const hasSurface = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined;
    if (!hasMeta?.name || !hasSurface?.name) return null;

    const metaRow = db.prepare("SELECT version FROM config_sync_meta WHERE id = 1").get() as { version: number } | undefined;
    const version = metaRow?.version ?? 1;
    const lastUpdated = new Date().toISOString();

    const surfaceCols = db.prepare("PRAGMA table_info(pricing_surface)").all() as Array<{ name: string }>;
    const hasSpecCols = surfaceCols.some((c) => c.name === "construction_type");
    const cennikRows = hasSpecCols
      ? (db.prepare("SELECT data_json, construction_type, roof_type, walls FROM pricing_surface").all() as Array<{
          data_json: string;
          construction_type: string | null;
          roof_type: string | null;
          walls: string | null;
        }>)
      : (db.prepare("SELECT data_json FROM pricing_surface").all() as Array<{ data_json: string }>);
    const cennik: unknown[] = [];
    for (const row of cennikRows) {
      try {
        const parsed = JSON.parse(row.data_json);
        const obj = typeof parsed === "object" && parsed != null ? parsed : {};
        if (hasSpecCols && "construction_type" in row) {
          const r = row as { construction_type?: string | null; roof_type?: string | null; walls?: string | null };
          if (r.construction_type != null && r.construction_type !== "" && parsed.Typ_Konstrukcji == null) (obj as Record<string, unknown>).Typ_Konstrukcji = r.construction_type;
          if (r.roof_type != null && r.roof_type !== "" && parsed.Typ_Dachu == null && parsed.Dach == null) (obj as Record<string, unknown>).Typ_Dachu = r.roof_type;
          if (r.walls != null && r.walls !== "" && parsed.Boki == null) (obj as Record<string, unknown>).Boki = r.walls;
        }
        cennik.push(obj);
      } catch {
        // skip invalid row
      }
    }

    let dodatki: unknown[] = [];
    try {
      const addonsRows = db.prepare("SELECT data_json FROM addons_surcharges").all() as Array<{ data_json: string }>;
      for (const row of addonsRows) {
        try {
          const parsed = JSON.parse(row.data_json);
          dodatki.push(typeof parsed === "object" && parsed != null ? parsed : row.data_json);
        } catch {
          // skip
        }
      }
    } catch {
      // table may not exist
    }

    let standard: unknown[] = [];
    try {
      const stdRows = db.prepare("SELECT data_json FROM standard_included").all() as Array<{ data_json: string }>;
      for (const row of stdRows) {
        try {
          const parsed = JSON.parse(row.data_json);
          standard.push(typeof parsed === "object" && parsed != null ? parsed : row.data_json);
        } catch {
          // skip
        }
      }
    } catch {
      // table may not exist
    }

    if (cennik.length === 0) return null;
    return { version, lastUpdated, cennik, dodatki, standard };
  } catch {
    return null;
  }
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

const SPEC_FALLBACK = "(brak danych)";

/**
 * Get technical spec (construction_type, roof_type, walls) from pricing_surface for a variant.
 * Matches by variant_hali or variant; if multiple rows exist, takes the first by lowest area_min_m2.
 * Returns SPEC_FALLBACK for any missing value.
 */
export function getTechnicalSpecFromPricingSurface(
  db: Db,
  variantHali: string
): { construction_type: string; roof_type: string; walls: string } | null {
  try {
    const hasSurface = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined;
    if (!hasSurface?.name) return null;
    const surfaceCols = db.prepare("PRAGMA table_info(pricing_surface)").all() as Array<{ name: string }>;
    const hasSpecCols = surfaceCols.some((c) => c.name === "construction_type");
    const rows = hasSpecCols
      ? (db.prepare("SELECT data_json, construction_type, roof_type, walls FROM pricing_surface").all() as Array<{
          data_json: string;
          construction_type: string | null;
          roof_type: string | null;
          walls: string | null;
        }>)
      : (db.prepare("SELECT data_json FROM pricing_surface").all() as Array<{ data_json: string }>);
    const variantNorm = (variantHali ?? "").trim();
    const candidates: { area_min_m2: number; construction_type: string | null; roof_type: string | null; walls: string | null }[] = [];
    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.data_json) as Record<string, unknown>;
      } catch {
        continue;
      }
      const rowVariant = (String(parsed.wariant_hali ?? parsed.variant ?? "").trim());
      if (rowVariant !== variantNorm) continue;
      const area_min_m2 = typeof parsed.area_min_m2 === "number" ? parsed.area_min_m2 : Number(parsed.area_min_m2) || 0;
      const r = row as { construction_type?: string | null; roof_type?: string | null; walls?: string | null };
      candidates.push({
        area_min_m2,
        construction_type: hasSpecCols && r.construction_type != null ? String(r.construction_type).trim() || null : (parsed.construction_type != null ? String(parsed.construction_type).trim() : null) ?? (parsed.Typ_Konstrukcji != null ? String(parsed.Typ_Konstrukcji).trim() : null) ?? null,
        roof_type: hasSpecCols && r.roof_type != null ? String(r.roof_type).trim() || null : (parsed.roof_type != null ? String(parsed.roof_type).trim() : null) ?? (parsed.Typ_Dachu != null ? String(parsed.Typ_Dachu).trim() : null) ?? (parsed.Dach != null ? String(parsed.Dach).trim() : null) ?? null,
        walls: hasSpecCols && r.walls != null ? String(r.walls).trim() || null : (parsed.walls != null ? String(parsed.walls).trim() : null) ?? (parsed.Boki != null ? String(parsed.Boki).trim() : null) ?? null,
      });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.area_min_m2 - b.area_min_m2);
    const first = candidates[0];
    return {
      construction_type: first.construction_type ?? SPEC_FALLBACK,
      roof_type: first.roof_type ?? SPEC_FALLBACK,
      walls: first.walls ?? SPEC_FALLBACK,
    };
  } catch {
    return null;
  }
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
