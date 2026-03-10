/**
 * Fetch technical spec (construction_type, roof_type, walls) from Supabase pricing_surface
 * for PDF "SPECYFIKACJA TECHNICZNA". Uses only variant, name, construction_type, roof_type, walls.
 * No area_min_m2 / area_max_m2. Matches by variant; returns first matching row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const FALLBACK = "(brak danych)";

export interface TechnicalSpecResult {
  construction_type: string;
  roof_type: string;
  walls: string;
}

const SELECT_COLUMNS = "id, variant, name, construction_type, roof_type, walls";

/**
 * Query Supabase pricing_surface by variant (or variant_hali if column exists).
 * Uses only columns that exist: variant, name, construction_type, roof_type, walls. No area columns.
 */
export async function getTechnicalSpecFromPricingSurfaceSupabase(
  supabase: SupabaseClient,
  variantHali: string
): Promise<TechnicalSpecResult | null> {
  const variant = (variantHali ?? "").trim();
  if (!variant) return null;

  try {
    const { data: rows, error } = await supabase
      .from("pricing_surface")
      .select(SELECT_COLUMNS)
      .limit(200);

    if (error) return null;

    const list = (rows ?? []) as Record<string, unknown>[];
    const norm = (s: string) =>
      (s ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || (s ?? "").trim();
    const variantNorm = norm(variant);
    const first = list.find((row) => {
      const rv = norm(String(row.variant_hali ?? row.variant ?? row.name ?? ""));
      return rv && rv === variantNorm;
    });
    if (!first) return null;

    const construction_type =
      first.construction_type != null && String(first.construction_type).trim()
        ? String(first.construction_type).trim()
        : FALLBACK;
    const roof_type =
      first.roof_type != null && String(first.roof_type).trim()
        ? String(first.roof_type).trim()
        : FALLBACK;
    const walls =
      first.walls != null && String(first.walls).trim()
        ? String(first.walls).trim()
        : FALLBACK;

    return { construction_type, roof_type, walls };
  } catch {
    return null;
  }
}
