/**
 * Load pricing from Supabase relational tables (pricing_surface, addons_surcharges, standard_included).
 * Builds in-memory HallVariant[] with PricingTier[] and derives cennik/dodatki/standard for cache and engine.
 */

import type { CennikRow, DodatkiRow, StandardRow } from "@planlux/shared";
import type { HallVariant, PricingTier } from "@planlux/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEBUG = process.env.LOG_LEVEL === "debug";

function toNum(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(String(v).replace(/\s/g, ""));
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** First non-empty string from row for given keys (Supabase may return different column casings). */
function firstStr(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const val = row[k];
    if (val != null && String(val).trim() !== "") return String(val).trim();
  }
  return undefined;
}

/** Get first non-empty string from row; tries each key then case-insensitive match on row keys (PostgREST returns lowercase). */
function rowStr(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    let v = row[k];
    if (v == null || String(v).trim() === "") {
      const rowKey = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase());
      v = rowKey != null ? row[rowKey] : undefined;
    }
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function rowNum(row: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const k of keys) {
    const rowKey = Object.keys(row).find((rk) => rk.toLowerCase() === k.toLowerCase()) ?? k;
    const v = row[rowKey];
    if (v != null && (typeof v === "number" || (typeof v === "string" && v.trim() !== ""))) return toNum(v, fallback);
  }
  return fallback;
}

function logReject(table: "addons_surcharges" | "standard_included", rowKeys: string[], reason: string): void {
  console.warn("[pricing][supabase] row rejected", { table, rowKeys, reason });
}

/** Normalized surface row (pricing_surface) with optional spec fields for PDF. */
export interface NormalizedSurfaceRow {
  variant: string;
  name: string;
  area_min_m2: number;
  area_max_m2: number;
  price: number;
  unit?: string;
  construction_type?: string;
  roof_type?: string;
  walls?: string;
  roof?: string;
}

/** Normalize a single row from pricing_surface (column-based or data_json). */
function normalizeSurfaceRow(row: Record<string, unknown>): NormalizedSurfaceRow | null {
  let variant: string;
  let name: string;
  let area_min_m2: number;
  let area_max_m2: number;
  let price: number;
  let unit: string | undefined;
  let construction_type: string | undefined;
  let roof_type: string | undefined;
  let walls: string | undefined;
  let roof: string | undefined;

  if (row.data_json != null && typeof row.data_json === "string") {
    try {
      const parsed = JSON.parse(row.data_json) as Record<string, unknown>;
      return normalizeSurfaceRow(parsed);
    } catch {
      return null;
    }
  }
  if (row.data_json != null && typeof row.data_json === "object" && row.data_json !== null) {
    return normalizeSurfaceRow(row.data_json as Record<string, unknown>);
  }

  variant = str(row.variant ?? row.wariant_hali ?? row.hall_variant);
  name = str(row.name ?? row.Nazwa ?? row.hall_name ?? variant);
  area_min_m2 = toNum(row.area_min_m2 ?? row.area_min, 0);
  area_max_m2 = toNum(row.area_max_m2 ?? row.area_max, 0);
  price = toNum(row.price ?? row.cena, 0);

  if (row.unit != null || row.stawka_jednostka != null || row.stawka_jedn != null) {
    unit = str(row.unit ?? row.stawka_jednostka ?? row.stawka_jedn) || undefined;
  }
  construction_type = firstStr(row, "construction_type", "Typ_Konstrukcji", "constructionType");
  roof_type = firstStr(row, "roof_type", "Typ_Dachu", "roofType");
  walls = firstStr(row, "walls", "Boki", "sides");
  roof = firstStr(row, "roof", "Dach");

  if (!variant) return null;
  return { variant, name, area_min_m2, area_max_m2, price, unit, construction_type, roof_type, walls, roof };
}

/** Group surface rows by variant+name and build HallVariant[]. Meta (Konstrukcja/Dach/Ściany) from first row of each group. */
export function buildHallVariants(surfaceRows: NormalizedSurfaceRow[]): HallVariant[] {
  const byKey = new Map<string, NormalizedSurfaceRow[]>();
  for (const r of surfaceRows) {
    const key = `${r.variant}\n${r.name}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  const result: HallVariant[] = [];
  for (const [key, rows] of byKey) {
    const [variant, name] = key.split("\n");
    const tiers: PricingTier[] = rows
      .sort((a, b) => a.area_min_m2 - b.area_min_m2)
      .map((r) => ({
        min: r.area_min_m2,
        max: r.area_max_m2,
        price: r.price,
        unit: r.unit,
      }));
    const first = rows[0];
    const meta =
      first?.construction_type != null ||
      first?.roof_type != null ||
      first?.walls != null ||
      first?.roof != null
        ? {
            typKonstrukcji: first.construction_type,
            typDachu: first.roof_type,
            boki: first.walls,
            dach: first.roof,
          }
        : undefined;
    result.push({ variant, name, tiers, meta });
  }
  if (DEBUG) {
    console.debug("[relationalPricing] buildHallVariants", {
      rawRows: surfaceRows.length,
      groupedCount: result.length,
      labels: result.map((v) => ({ variant: v.variant, name: v.name, tierCount: v.tiers.length })),
    });
  }
  return result;
}

/** Flatten HallVariant[] to cennik (CennikRow[]) for pricing_cache and calculatePrice. Typ_Konstrukcji/Typ_Dachu/Boki/Dach from variant meta for PDF spec. */
export function hallVariantsToCennik(hallVariants: HallVariant[]): CennikRow[] {
  const cennik: CennikRow[] = [];
  for (const hv of hallVariants) {
    for (const t of hv.tiers) {
      cennik.push({
        wariant_hali: hv.variant,
        Nazwa: hv.name,
        Typ_Konstrukcji: hv.meta?.typKonstrukcji,
        Typ_Dachu: hv.meta?.typDachu,
        Boki: hv.meta?.boki,
        Dach: hv.meta?.dach,
        area_min_m2: t.min,
        area_max_m2: t.max,
        cena: t.price,
        stawka_jednostka: t.unit,
      });
    }
  }
  return cennik;
}

/**
 * Normalize addons_surcharges row. Primary mapping from real Supabase columns; legacy as fallback.
 * Supabase: variant, hall_name, addon_name, price, currency, unit, condition, addon_type, calculation_mode, display_name.
 */
function normalizeAddonsRow(row: Record<string, unknown>): (Omit<DodatkiRow, "Nr" | "Nazwa"> & { warunek?: string; warunek_type?: string }) | null {
  const rowKeys = Object.keys(row);
  if (row.data_json != null && typeof row.data_json === "string") {
    try {
      return normalizeAddonsRow(JSON.parse(row.data_json) as Record<string, unknown>);
    } catch {
      logReject("addons_surcharges", rowKeys, "invalid data_json");
      return null;
    }
  }
  if (row.data_json != null && typeof row.data_json === "object" && row.data_json !== null) {
    return normalizeAddonsRow(row.data_json as Record<string, unknown>);
  }
  const wariant_hali = rowStr(row, "variant", "wariant_hali", "hall_variant", "hall_name", "hallVariant", "hall_key", "hallKey");
  const nazwa = rowStr(row, "addon_name", "display_name", "nazwa", "name");
  const stawka = rowNum(row, 0, "price", "stawka");
  const jednostka = rowStr(row, "unit", "jednostka") || "szt";
  const warunek = rowStr(row, "condition", "warunek") || undefined;
  const warunek_type = rowStr(row, "addon_type", "warunek_type") || undefined;

  if (!wariant_hali) {
    logReject("addons_surcharges", rowKeys, "missing variant (required)");
    return null;
  }
  if (!nazwa) {
    logReject("addons_surcharges", rowKeys, "missing addon_name/display_name/nazwa (required)");
    return null;
  }
  const out = { wariant_hali, nazwa, stawka, jednostka, warunek, warunek_type };
  return out as (Omit<DodatkiRow, "Nr" | "Nazwa"> & { warunek?: string; warunek_type?: string });
}

/**
 * Normalize standard_included row. Primary mapping from real Supabase columns; legacy as fallback.
 * Supabase: variant, element, qty, unit, reference_value, currency, price_unit, notes.
 */
function normalizeStandardRow(row: Record<string, unknown>): (Omit<StandardRow, "Nr" | "stawka" | "Jednostka"> & { ilosc: number; wartosc_ref: number }) | null {
  const rowKeys = Object.keys(row);
  if (row.data_json != null && typeof row.data_json === "string") {
    try {
      return normalizeStandardRow(JSON.parse(row.data_json) as Record<string, unknown>);
    } catch {
      logReject("standard_included", rowKeys, "invalid data_json");
      return null;
    }
  }
  if (row.data_json != null && typeof row.data_json === "object" && row.data_json !== null) {
    return normalizeStandardRow(row.data_json as Record<string, unknown>);
  }
  const wariant_hali = rowStr(row, "variant", "wariant_hali", "hall_variant");
  const element = rowStr(row, "element", "name");
  const ilosc = rowNum(row, 1, "qty", "ilosc");
  const jednostka = rowStr(row, "unit", "jednostka") || undefined;
  const wartosc_ref = rowNum(row, 0, "reference_value", "wartosc_ref", "ref_value");
  const uwagi = rowStr(row, "notes", "uwagi") || undefined;

  if (!wariant_hali) {
    logReject("standard_included", rowKeys, "missing variant (required)");
    return null;
  }
  if (!element) {
    logReject("standard_included", rowKeys, "missing element (required)");
    return null;
  }
  return { wariant_hali, element, ilosc, wartosc_ref, jednostka, uwagi };
}

export interface RelationalPricingResult {
  hallVariants: HallVariant[];
  cennik: CennikRow[];
  dodatki: DodatkiRow[];
  standard: StandardRow[];
  version: number;
  lastUpdated: string;
}

/**
 * Fetch pricing from Supabase relational tables and build HallVariant[] + cennik/dodatki/standard.
 * Returns null if tables are missing or empty (caller should use local fallback/seed).
 */
export async function fetchRelationalPricing(supabase: SupabaseClient): Promise<RelationalPricingResult | null> {
  const version = Math.max(1, Math.floor(Date.now() / 1000));
  const lastUpdated = new Date().toISOString();

  let surfaceRows: Record<string, unknown>[] = [];
  let addonsRows: Record<string, unknown>[] = [];
  let standardRows: Record<string, unknown>[] = [];

  try {
    const { data: surfaceData, error: surfaceError } = await supabase.from("pricing_surface").select("*");
    if (surfaceError) {
      if (DEBUG) console.debug("[relationalPricing] pricing_surface error", surfaceError.message, surfaceError.code);
      return null;
    }
    surfaceRows = (surfaceData ?? []).map((r) => r as Record<string, unknown>);
  } catch (e) {
    if (DEBUG) console.debug("[relationalPricing] pricing_surface exception", e);
    return null;
  }

  // Load ALL addons/standard rows – no .eq("variant") or selectedVariant filter. Filtering happens in renderer/engine.
  try {
    const { data: addonsData, error: addonsError } = await supabase.from("addons_surcharges").select("*");
    const rawAddonsCount = (addonsData ?? []).length;
    console.warn("[pricing][supabase] raw addons query", {
      rawAddonsCount,
      rawAddonsError: addonsError ? { message: addonsError.message, code: (addonsError as { code?: string }).code } : null,
      firstRawAddonRow: addonsData?.[0] ?? null,
    });
    if (!addonsError) addonsRows = (addonsData ?? []).map((r) => r as Record<string, unknown>);
  } catch (e) {
    console.warn("[pricing][supabase] raw addons exception", e);
  }
  try {
    const { data: stdData, error: stdError } = await supabase.from("standard_included").select("*");
    const rawStandardCount = (stdData ?? []).length;
    console.warn("[pricing][supabase] raw standard query", {
      rawStandardCount,
      rawStandardError: stdError ? { message: stdError.message, code: (stdError as { code?: string }).code } : null,
      firstRawStandardRow: stdData?.[0] ?? null,
    });
    if (!stdError) standardRows = (stdData ?? []).map((r) => r as Record<string, unknown>);
  } catch (e) {
    console.warn("[pricing][supabase] raw standard exception", e);
  }

  const normalizedSurface = surfaceRows
    .map((r) => normalizeSurfaceRow(r))
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (normalizedSurface.length === 0) {
    if (DEBUG) console.debug("[relationalPricing] no surface rows after normalize");
    return null;
  }

  if (DEBUG && surfaceRows.length > 0) {
    const firstRaw = surfaceRows[0] as Record<string, unknown>;
    const firstNorm = normalizedSurface[0];
    console.debug("[relationalPricing] first surface row keys (pricing_surface)", Object.keys(firstRaw).sort());
    console.debug("[relationalPricing] first normalized spec (construction_type, roof_type, walls)", {
      construction_type: firstNorm?.construction_type ?? "(brak)",
      roof_type: firstNorm?.roof_type ?? "(brak)",
      walls: firstNorm?.walls ?? "(brak)",
    });
  }

  const hallVariants = buildHallVariants(normalizedSurface);
  let cennik = hallVariantsToCennik(hallVariants);
  cennik = cennik.filter((r) => r && String(r.wariant_hali ?? "").trim() !== "");
  cennik = cennik.map((r) => ({
    ...r,
    Nazwa: r.Nazwa && String(r.Nazwa).trim() !== "" ? r.Nazwa : (r.wariant_hali ?? ""),
  }));
  const uniqueVariants = [...new Set(cennik.map((r) => String(r.wariant_hali ?? "").trim()).filter(Boolean))];
  if (process.env.LOG_LEVEL === "debug" || process.env.PLANLUX_VARIANTS_DEBUG === "1") {
    console.info("[variants][main] relational loader mapped entries:", cennik.length, "unique variants:", uniqueVariants.length);
  }

  const normalizedAddons: Array<Omit<DodatkiRow, "Nr" | "Nazwa"> & { warunek?: string; warunek_type?: string }> = [];
  for (const r of addonsRows) {
    const n = normalizeAddonsRow(r);
    if (n) {
      if (normalizedAddons.length === 0) {
        console.warn("[pricing][supabase] normalized addon sample", n);
      }
      normalizedAddons.push(n);
    }
  }
  const dodatki: DodatkiRow[] = normalizedAddons.map((r) => ({
    wariant_hali: r.wariant_hali,
    nazwa: r.nazwa,
    stawka: r.stawka,
    jednostka: r.jednostka,
    ...(r.warunek != null && r.warunek !== "" && { warunek: r.warunek }),
    ...(r.warunek_type != null && r.warunek_type !== "" && { warunek_type: r.warunek_type }),
  }));

  const normalizedStandards: Array<Omit<StandardRow, "Nr" | "stawka" | "Jednostka"> & { ilosc: number; wartosc_ref: number }> = [];
  for (const r of standardRows) {
    const n = normalizeStandardRow(r);
    if (n) {
      if (normalizedStandards.length === 0) {
        console.warn("[pricing][supabase] normalized standard sample", n);
      }
      normalizedStandards.push(n);
    }
  }
  const standard: StandardRow[] = normalizedStandards.map((r) => ({
    wariant_hali: r.wariant_hali,
    element: r.element,
    ilosc: r.ilosc,
    wartosc_ref: r.wartosc_ref,
    ...(r.jednostka != null && r.jednostka !== "" && { jednostka: r.jednostka }),
    ...(r.uwagi != null && r.uwagi !== "" && { uwagi: r.uwagi }),
  }));

  if (DEBUG) {
    console.debug("[relationalPricing] fetchRelationalPricing", {
      rawSurfaceRows: surfaceRows.length,
      groupedVariants: hallVariants.length,
      variantLabels: hallVariants.map((v) => ({ variant: v.variant, name: v.name })),
      cennikRows: cennik.length,
      dodatkiCount: dodatki.length,
      standardCount: standard.length,
    });
  }

  return {
    hallVariants,
    cennik,
    dodatki,
    standard,
    version,
    lastUpdated,
  };
}
