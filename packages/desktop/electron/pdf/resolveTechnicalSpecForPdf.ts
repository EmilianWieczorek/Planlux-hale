/**
 * DIAGNOSTYKA: czy aplikacja widzi rekordy z pricing_surface.
 * Trzy proste zapytania do Supabase + dokładne logi. Bez SQLite, bez aliasów.
 */

import type { SupabaseClient, PostgrestSingleResponse } from "@supabase/supabase-js";

const FALLBACK = "(brak danych)";

export interface TechnicalSpecResult {
  construction_type: string;
  roof_type: string;
  walls: string;
}

export type ResolveTechnicalSpecLogger = {
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
};

/** Minimalny typ wiersza z pricing_surface, używany tylko w tej diagnostyce. */
interface PricingSurfaceRow {
  variant: string | null;
  construction_type: string | null;
  roof_type: string | null;
  walls: string | null;
}

const COLS = "variant, construction_type, roof_type, walls";

function rowUsable(row: PricingSurfaceRow): boolean {
  const ct = row.construction_type != null && String(row.construction_type).trim() !== "";
  const rt = row.roof_type != null && String(row.roof_type).trim() !== "";
  const w = row.walls != null && String(row.walls).trim() !== "";
  return ct || rt || w;
}

function toResult(row: PricingSurfaceRow): TechnicalSpecResult {
  return {
    construction_type:
      row.construction_type != null && String(row.construction_type).trim()
        ? String(row.construction_type).trim()
        : FALLBACK,
    roof_type:
      row.roof_type != null && String(row.roof_type).trim()
        ? String(row.roof_type).trim()
        : FALLBACK,
    walls:
      row.walls != null && String(row.walls).trim()
        ? String(row.walls).trim()
        : FALLBACK,
  };
}

async function runSupabaseQueryWithTimeout<T>(
  label: string,
  query: PromiseLike<PostgrestSingleResponse<T>>,
  logger: ResolveTechnicalSpecLogger,
  timeoutMs = 7_000
): Promise<PostgrestSingleResponse<T>> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<PostgrestSingleResponse<T>>((resolve) => {
    timeoutHandle = setTimeout(() => {
      logger.warn("[PLANLUX_PDF_DEBUG] resolveTechnicalSpec timeout", { label, timeoutMs });
      resolve({
        data: null,
        error: { message: `resolveTechnicalSpec timeout after ${timeoutMs}ms`, code: "TIMEOUT" },
        count: null,
        status: 0,
        statusText: "TIMEOUT",
      } as unknown as PostgrestSingleResponse<T>);
    }, timeoutMs);
  });

  const result = (await Promise.race([query, timeoutPromise])) as PostgrestSingleResponse<T>;
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return result;
}

export async function resolveTechnicalSpecForPdf(
  variantHali: string,
  options: {
    getSupabase?: () => SupabaseClient | null;
    getDb?: () => ReturnType<typeof import("better-sqlite3")>;
    logger: ResolveTechnicalSpecLogger;
  }
): Promise<TechnicalSpecResult> {
  const { getSupabase, logger } = options;
  const fallback: TechnicalSpecResult = {
    construction_type: FALLBACK,
    roof_type: FALLBACK,
    walls: FALLBACK,
  };

  logger.info("[pdf] diagnostic start", { variantHali: variantHali ?? "(brak)" });

  const supabase = getSupabase?.() ?? null;
  if (!supabase) {
    logger.warn("[PLANLUX_PDF_DEBUG] resolveTechnicalSpecForPdf: no Supabase client");
    return fallback;
  }

  // A) limit 20
  const qA = await runSupabaseQueryWithTimeout<PricingSurfaceRow[]>(
    "A_limit20",
    supabase.from("pricing_surface").select(COLS).limit(20),
    logger
  );
  logger.info("[PLANLUX_PDF_DEBUG] resolveTechnicalSpec query A (limit 20)", {
    error: qA.error ? { message: qA.error.message, code: qA.error.code, details: qA.error.details } : null,
    count: qA.data?.length ?? 0,
    data: qA.data ?? [],
  });
  if (qA.data?.length) {
    const firstUsable = qA.data.find(rowUsable);
    if (firstUsable) {
      logger.info("[pdf] diagnostic return from A (first row with data)");
      return toResult(firstUsable);
    }
  }

  // B) variant = 'PLANDEKA'
  const qB = await runSupabaseQueryWithTimeout<PricingSurfaceRow[]>(
    "B_variant_PLANDEKA",
    supabase.from("pricing_surface").select(COLS).eq("variant", "PLANDEKA").limit(5),
    logger
  );
  logger.info("[PLANLUX_PDF_DEBUG] resolveTechnicalSpec query B (variant = 'PLANDEKA')", {
    error: qB.error ? { message: qB.error.message, code: qB.error.code, details: qB.error.details } : null,
    count: qB.data?.length ?? 0,
    data: qB.data ?? [],
  });
  if (qB.data?.length) {
    const firstUsable = qB.data.find(rowUsable);
    if (firstUsable) {
      logger.info("[pdf] diagnostic return from B");
      return toResult(firstUsable);
    }
  }

  // C) variant ilike '%PLANDEKA%'
  const qC = await runSupabaseQueryWithTimeout<PricingSurfaceRow[]>(
    "C_variant_ilike_PLANDEKA",
    supabase.from("pricing_surface").select(COLS).ilike("variant", "%PLANDEKA%").limit(5),
    logger
  );
  logger.info("[PLANLUX_PDF_DEBUG] resolveTechnicalSpec query C (variant ilike '%PLANDEKA%')", {
    error: qC.error ? { message: qC.error.message, code: qC.error.code, details: qC.error.details } : null,
    count: qC.data?.length ?? 0,
    data: qC.data ?? [],
  });
  if (qC.data?.length) {
    const firstUsable = qC.data.find(rowUsable);
    if (firstUsable) {
      logger.info("[pdf] diagnostic return from C");
      return toResult(firstUsable);
    }
  }

  logger.warn("[PLANLUX_PDF_DEBUG] resolveTechnicalSpecForPdf: no usable row in any query, using fallback");
  return fallback;
}

/** Stub na czas diagnostyki (testy / ewentualne importy). */
export const VARIANT_ALIASES: Record<string, string[]> = {};
/** Stub na czas diagnostyki. */
export function getPossibleMatchValues(_appVariant: string): string[] {
  return [];
}
/** Stub na czas diagnostyki. */
export async function resolveTechnicalSpecFromSupabase(): Promise<TechnicalSpecResult | null> {
  return null;
}
