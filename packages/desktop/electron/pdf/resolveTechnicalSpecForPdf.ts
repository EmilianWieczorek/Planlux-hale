/**
 * Single source of truth for PDF technical spec (Konstrukcja, Dach, Ściany).
 * Used by both preview (generatePdfPreview) and final (pdf:generate).
 * Resolves from Supabase pricing_surface with robust variant matching; never uses pricing.base.row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const FALLBACK = "(brak danych)";

export interface TechnicalSpecResult {
  construction_type: string;
  roof_type: string;
  walls: string;
}

/** Normalize variant for matching: trim, uppercase, remove Polish diacritics, collapse spaces/hyphens to underscore. */
function normalizeVariant(s: string): string {
  const t = (s ?? "").trim().toUpperCase();
  const noDiacritics = t
    .replace(/Ą/g, "A")
    .replace(/Ć/g, "C")
    .replace(/Ę/g, "E")
    .replace(/Ł/g, "L")
    .replace(/Ń/g, "N")
    .replace(/Ó/g, "O")
    .replace(/Ś/g, "S")
    .replace(/Ź/g, "Z")
    .replace(/Ż/g, "Z")
    .replace(/ą/g, "A")
    .replace(/ć/g, "C")
    .replace(/ę/g, "E")
    .replace(/ł/g, "L")
    .replace(/ń/g, "N")
    .replace(/ó/g, "O")
    .replace(/ś/g, "S")
    .replace(/ź/g, "Z")
    .replace(/ż/g, "Z");
  return noDiacritics.replace(/[\s-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || t;
}

/** Optional: map app variant id to possible DB variant values (for flexible matching). */
const VARIANT_TO_PRICING_SURFACE_KEYS: Record<string, string[]> = {
  PLYTA_WARSTWOWA: ["PLYTA_WARSTWOWA", "PŁYTA_WARSTWOWA", "PLYTA WARSTWOWA", "HALA CAŁOŚĆ Z PŁYTY WARSTWOWEJ"],
  TERM_60_PNEU: ["TERM_60_PNEU", "TERM 60 PNEU", "PŁYTA 60 MM - DACH PNEUMATYCZNY"],
  T18_T35_DACH: ["T18_T35_DACH", "T18 T35 DACH", "BLACHA T-18 T-35"],
  PLANDEKA: ["PLANDEKA"],
  PLANDEKA_T18: ["PLANDEKA_T18", "PLANDEKA T18"],
};

function getPossibleMatchValues(appVariant: string): string[] {
  const normalized = normalizeVariant(appVariant);
  const mapped = VARIANT_TO_PRICING_SURFACE_KEYS[appVariant] ?? VARIANT_TO_PRICING_SURFACE_KEYS[normalized];
  const list = mapped ? [...mapped, appVariant, normalized] : [appVariant, normalized];
  return [...new Set(list.map((v) => normalizeVariant(v)))];
}

function rowVariant(row: Record<string, unknown>): string {
  const v = row.variant_hali ?? row.variant ?? row.hall_variant ?? "";
  return normalizeVariant(String(v ?? ""));
}

export type ResolveTechnicalSpecLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
};

/**
 * Resolve technical spec from Supabase pricing_surface with robust variant matching.
 * Fetches rows, normalizes variant, filters by match (exact normalized or mapping), sorts by area_min_m2, takes first.
 */
export async function resolveTechnicalSpecFromSupabase(
  supabase: SupabaseClient,
  variantHali: string,
  logger: ResolveTechnicalSpecLogger
): Promise<TechnicalSpecResult | null> {
  const requested = (variantHali ?? "").trim();
  const normalizedRequested = normalizeVariant(requested);
  const possibleValues = getPossibleMatchValues(requested);

  logger.info("[pdf] technical spec resolver start", {
    variantHali: requested,
    normalizedVariantHali: normalizedRequested,
    possibleMatchValues: possibleValues.slice(0, 10),
  });

  try {
    const columns = "id, construction_type, roof_type, walls, area_min_m2, variant_hali, variant";
    const { data: rows, error } = await supabase
      .from("pricing_surface")
      .select(columns)
      .limit(200);

    if (error) {
      logger.warn("[pdf] technical spec resolver Supabase error", { message: error.message, code: error.code });
      return null;
    }

    const list = (rows ?? []) as Record<string, unknown>[];
    const candidates = list.filter((row) => {
      const rv = rowVariant(row);
      return rv && (possibleValues.includes(rv) || rv === normalizedRequested);
    });

    candidates.sort((a, b) => {
      const am = Number(a.area_min_m2 ?? 0);
      const bm = Number(b.area_min_m2 ?? 0);
      return am - bm;
    });

    const firstFive = candidates.slice(0, 5).map((r) => ({
      id: r.id,
      variant: r.variant ?? r.variant_hali,
      construction_type: r.construction_type ?? null,
      roof_type: r.roof_type ?? null,
      walls: r.walls ?? null,
      area_min_m2: r.area_min_m2 ?? null,
    }));
    logger.info("[pdf] technical spec resolver candidates", {
      totalRows: list.length,
      matchCount: candidates.length,
      firstFive,
    });

    const selected = candidates[0];
    if (!selected) {
      logger.warn("[pdf] technical spec resolver no match", {
        reason: list.length === 0 ? "no rows found" : "variant mismatch",
        variantHali: requested,
        normalizedRequested,
      });
      return null;
    }

    logger.info("[pdf] technical spec resolver selected row", {
      id: selected.id,
      variant: selected.variant ?? selected.variant_hali,
      construction_type: selected.construction_type ?? "(empty)",
      roof_type: selected.roof_type ?? "(empty)",
      walls: selected.walls ?? "(empty)",
    });

    const construction_type =
      selected.construction_type != null && String(selected.construction_type).trim()
        ? String(selected.construction_type).trim()
        : FALLBACK;
    const roof_type =
      selected.roof_type != null && String(selected.roof_type).trim()
        ? String(selected.roof_type).trim()
        : FALLBACK;
    const walls =
      selected.walls != null && String(selected.walls).trim()
        ? String(selected.walls).trim()
        : FALLBACK;

    const hasEmpty = construction_type === FALLBACK || roof_type === FALLBACK || walls === FALLBACK;
    if (hasEmpty) {
      logger.warn("[pdf] technical spec resolver empty fields in selected row", {
        id: selected.id,
        construction_type: construction_type === FALLBACK ? "empty" : "ok",
        roof_type: roof_type === FALLBACK ? "empty" : "ok",
        walls: walls === FALLBACK ? "empty" : "ok",
      });
    }

    return { construction_type, roof_type, walls };
  } catch (e) {
    logger.warn("[pdf] technical spec resolver exception", e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Single resolver: try Supabase (with robust matching), then local SQLite pricing_surface.
 * Always returns TechnicalSpecResult; uses FALLBACK when no row or error.
 */
export async function resolveTechnicalSpecForPdf(
  variantHali: string,
  options: {
    getSupabase?: () => SupabaseClient | null;
    getDb?: () => ReturnType<typeof import("better-sqlite3")>;
    logger: ResolveTechnicalSpecLogger;
  }
): Promise<TechnicalSpecResult> {
  const { getSupabase, getDb, logger } = options;
  const fallbackResult: TechnicalSpecResult = {
    construction_type: FALLBACK,
    roof_type: FALLBACK,
    walls: FALLBACK,
  };

  const requested = (variantHali ?? "").trim();
  if (!requested) {
    logger.warn("[pdf] technical spec resolver no variant", { reason: "empty variantHali" });
    return fallbackResult;
  }

  if (getSupabase) {
    const supabase = getSupabase();
    if (supabase) {
      const fromSupabase = await resolveTechnicalSpecFromSupabase(supabase, variantHali, logger);
      if (fromSupabase) {
        logger.info("[pdf] technical spec payload final", {
          source: "pricing_surface",
          construction_type: fromSupabase.construction_type,
          roof_type: fromSupabase.roof_type,
          walls: fromSupabase.walls,
        });
        return fromSupabase;
      }
    }
  }

  if (getDb) {
    try {
      const { getTechnicalSpecFromPricingSurface } = await import("../../src/infra/db");
      const db = getDb();
      const fromLocal = getTechnicalSpecFromPricingSurface(db, variantHali);
      if (fromLocal && (fromLocal.construction_type !== FALLBACK || fromLocal.roof_type !== FALLBACK || fromLocal.walls !== FALLBACK)) {
        logger.info("[pdf] technical spec payload final", {
          source: "pricing_surface_local",
          construction_type: fromLocal.construction_type,
          roof_type: fromLocal.roof_type,
          walls: fromLocal.walls,
        });
        return fromLocal;
      }
    } catch (e) {
      logger.warn("[pdf] technical spec resolver local db failed", e instanceof Error ? e.message : String(e));
    }
  }

  logger.warn("[pdf] technical spec resolver no match", {
    reason: "no rows found or variant mismatch",
    variantHali: requested,
  });
  logger.info("[pdf] technical spec payload final", {
    source: "fallback",
    construction_type: FALLBACK,
    roof_type: FALLBACK,
    walls: FALLBACK,
  });
  return fallbackResult;
}
