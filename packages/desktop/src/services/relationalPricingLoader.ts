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

/** Normalize a single row from pricing_surface (column-based or data_json). */
function normalizeSurfaceRow(row: Record<string, unknown>): { variant: string; name: string; area_min_m2: number; area_max_m2: number; price: number; unit?: string } | null {
  let variant: string;
  let name: string;
  let area_min_m2: number;
  let area_max_m2: number;
  let price: number;
  let unit: string | undefined;

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

  if (!variant) return null;
  return { variant, name, area_min_m2, area_max_m2, price, unit };
}

/** Group surface rows by variant+name and build HallVariant[]. */
export function buildHallVariants(surfaceRows: Array<{ variant: string; name: string; area_min_m2: number; area_max_m2: number; price: number; unit?: string }>): HallVariant[] {
  const byKey = new Map<string, typeof surfaceRows>();
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
    result.push({ variant, name, tiers });
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

/** Flatten HallVariant[] to cennik (CennikRow[]) for pricing_cache and calculatePrice. */
export function hallVariantsToCennik(hallVariants: HallVariant[]): CennikRow[] {
  const cennik: CennikRow[] = [];
  for (const hv of hallVariants) {
    for (const t of hv.tiers) {
      cennik.push({
        wariant_hali: hv.variant,
        Nazwa: hv.name,
        area_min_m2: t.min,
        area_max_m2: t.max,
        cena: t.price,
        stawka_jednostka: t.unit,
      });
    }
  }
  return cennik;
}

/** Normalize addons row (column-based or data_json). */
function normalizeAddonsRow(row: Record<string, unknown>): { wariant_hali: string; nazwa: string; stawka: number; jednostka: string } | null {
  if (row.data_json != null && typeof row.data_json === "string") {
    try {
      return normalizeAddonsRow(JSON.parse(row.data_json) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (row.data_json != null && typeof row.data_json === "object" && row.data_json !== null) {
    return normalizeAddonsRow(row.data_json as Record<string, unknown>);
  }
  const wariant_hali = str(row.wariant_hali ?? row.variant ?? row.hall_name);
  const nazwa = str(row.nazwa ?? row.addon_name ?? row.name);
  const stawka = toNum(row.stawka ?? row.price, 0);
  const jednostka = str(row.jednostka ?? row.unit ?? "szt");
  if (!wariant_hali || !nazwa) return null;
  return { wariant_hali, nazwa, stawka, jednostka };
}

/** Normalize standard row (column-based or data_json). */
function normalizeStandardRow(row: Record<string, unknown>): { wariant_hali: string; element: string; ilosc: number; wartosc_ref: number } | null {
  if (row.data_json != null && typeof row.data_json === "string") {
    try {
      return normalizeStandardRow(JSON.parse(row.data_json) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (row.data_json != null && typeof row.data_json === "object" && row.data_json !== null) {
    return normalizeStandardRow(row.data_json as Record<string, unknown>);
  }
  const wariant_hali = str(row.wariant_hali ?? row.variant);
  const element = str(row.element ?? row.name);
  const ilosc = toNum(row.ilosc ?? row.qty, 1);
  const wartosc_ref = toNum(row.wartosc_ref ?? row.ref_value, 0);
  if (!wariant_hali || !element) return null;
  return { wariant_hali, element, ilosc, wartosc_ref };
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

  try {
    const { data: addonsData, error: addonsError } = await supabase.from("addons_surcharges").select("*");
    if (!addonsError) addonsRows = (addonsData ?? []).map((r) => r as Record<string, unknown>);
  } catch {
    // optional
  }
  try {
    const { data: stdData, error: stdError } = await supabase.from("standard_included").select("*");
    if (!stdError) standardRows = (stdData ?? []).map((r) => r as Record<string, unknown>);
  } catch {
    // optional
  }

  const normalizedSurface = surfaceRows
    .map((r) => normalizeSurfaceRow(r))
    .filter((r): r is NonNullable<typeof r> => r != null);

  if (normalizedSurface.length === 0) {
    if (DEBUG) console.debug("[relationalPricing] no surface rows after normalize");
    return null;
  }

  const hallVariants = buildHallVariants(normalizedSurface);
  const cennik = hallVariantsToCennik(hallVariants);

  const dodatki: DodatkiRow[] = addonsRows
    .map((r) => normalizeAddonsRow(r))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({
      wariant_hali: r.wariant_hali,
      nazwa: r.nazwa,
      stawka: r.stawka,
      jednostka: r.jednostka,
    }));

  const standard: StandardRow[] = standardRows
    .map((r) => normalizeStandardRow(r))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({
      wariant_hali: r.wariant_hali,
      element: r.element,
      ilosc: r.ilosc,
      wartosc_ref: r.wartosc_ref,
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
