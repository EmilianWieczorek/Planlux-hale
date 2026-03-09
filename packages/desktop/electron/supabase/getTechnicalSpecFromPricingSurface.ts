/**
 * Fetch technical spec (construction_type, roof_type, walls) from Supabase pricing_surface
 * for PDF "SPECYFIKACJA TECHNICZNA". Matches by variant_hali or variant; if multiple rows,
 * takes the first by lowest area_min_m2.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const FALLBACK = "(brak danych)";

export interface TechnicalSpecResult {
  construction_type: string;
  roof_type: string;
  walls: string;
}

/**
 * Query Supabase table pricing_surface by variant_hali (or variant), order by area_min_m2 asc,
 * take first row; return construction_type, roof_type, walls. Returns null if no row or error.
 */
export async function getTechnicalSpecFromPricingSurfaceSupabase(
  supabase: SupabaseClient,
  variantHali: string
): Promise<TechnicalSpecResult | null> {
  const variant = (variantHali ?? "").trim();
  if (!variant) return null;

  try {
    const columns = "construction_type, roof_type, walls, area_min_m2, variant_hali, variant";
    let rows: unknown[] | null = null;
    const byVariantHali = await supabase
      .from("pricing_surface")
      .select(columns)
      .eq("variant_hali", variant)
      .order("area_min_m2", { ascending: true })
      .limit(1);
    if (!byVariantHali.error && byVariantHali.data?.length) {
      rows = byVariantHali.data;
    } else {
      const byVariant = await supabase
        .from("pricing_surface")
        .select(columns)
        .eq("variant", variant)
        .order("area_min_m2", { ascending: true })
        .limit(1);
      if (!byVariant.error && byVariant.data?.length) rows = byVariant.data;
    }
    if (!rows?.length) return null;

    const first = rows[0] as Record<string, unknown>;
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
