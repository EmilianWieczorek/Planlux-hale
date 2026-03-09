/**
 * Supabase-backed API adapter: getMeta, getBase, logPdf, logEmail, heartbeat.
 * Replaces Google Apps Script backend. Uses tables: base_pricing, pdf_history, email_history, sync_log.
 * Normalizes base_pricing payload from Supabase schema (variant/name/price etc.) to app schema (wariant_hali/Nazwa/cena etc.).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BaseResponse,
  MetaOnlyResponse,
  LogPdfPayload,
  LogEmailPayload,
  HeartbeatPayload,
  ReserveOfferNumberPayload,
  ReserveOfferNumberResponse,
  CennikRow,
  DodatkiRow,
  StandardRow,
} from "@planlux/shared";

type RawRecord = Record<string, unknown>;

/** Parsed base_pricing row payload from Supabase. */
type BasePricingPayload = {
  cennik?: unknown;
  dodatki?: unknown;
  standard?: unknown;
  [k: string]: unknown;
};

function asNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function firstNonEmptyString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    const s = asNonEmptyString(v);
    if (s) return s;
  }
  return undefined;
}

/**
 * Business variant identity.
 *
 * Supabase payloads sometimes contain both:
 * - a short technical code like "T18" (often under `variant`)
 * - a full business variant name like "T18_T35_DACH" (often under `wariant_hali` or `Nazwa`/`name`/`hall_name`)
 *
 * We must NOT key the UI/engine by the short code when the full business key exists,
 * otherwise multiple main variants collapse into one and tiers mix incorrectly.
 */
type VariantKeyHint = "cennik" | "dodatki" | "standard";

function deriveHallVariantKey(raw: Record<string, unknown>, hint: VariantKeyHint): string {
  const key = firstNonEmptyString(
    raw.wariant_hali,
    raw.wariantHali,
    raw.hall_variant,
    raw.hallVariant,
    raw.hall_key,
    raw.hallKey
  );
  if (key) return key;

  // IMPORTANT: in dodatki/standard, `name` is often the addon/element name (NOT hall variant).
  // Only use name-like fields that are known to refer to the hall variant.
  const nameLike =
    hint === "cennik"
      ? firstNonEmptyString(raw.Nazwa, raw.name)
      : hint === "dodatki"
        ? firstNonEmptyString(raw.hall_name, raw.hallName, raw.Nazwa)
        : firstNonEmptyString(raw.Nazwa);
  if (nameLike) return nameLike;

  return firstNonEmptyString(raw.variant, raw.variant_hali) ?? "";
}

function deriveHallVariantLabel(raw: Record<string, unknown>, hint: VariantKeyHint, fallbackKey: string): string {
  const label =
    hint === "cennik"
      ? firstNonEmptyString(raw.Nazwa, raw.name)
      : hint === "dodatki"
        ? firstNonEmptyString(raw.hall_name, raw.hallName, raw.Nazwa)
        : firstNonEmptyString(raw.Nazwa);
  return label ?? fallbackKey;
}

/** Normalize one cennik row: Supabase (variant/name/price/unit) or Polish (wariant_hali/Nazwa/cena/stawka_jedn) -> app canonical. */
function normalizeCennikRow(raw: RawRecord): CennikRow {
  const n = raw as Record<string, unknown>;
  const hasPolishKeys = n.wariant_hali != null && n.Nazwa != null && n.cena != null;
  if (hasPolishKeys) {
    const row = { ...n } as Record<string, unknown>;
    row.stawka_jednostka = n.stawka_jednostka ?? n.stawka_jedn;
    const spec = (v: unknown): string | undefined => (v != null && typeof v === "string" ? v.trim() || undefined : undefined);
    row.Typ_Konstrukcji = spec(n.Typ_Konstrukcji ?? n.construction_type ?? n.konstrukcja) ?? (row.Typ_Konstrukcji as string | undefined);
    row.Typ_Dachu = spec(n.Typ_Dachu ?? n.Dach ?? n.roof_type) ?? (row.Typ_Dachu as string | undefined);
    row.Boki = spec(n.Boki ?? n.walls ?? n.Ściany ?? n.sides) ?? (row.Boki as string | undefined);
    row.Dach = spec(n.Dach ?? n.roof_type ?? n.roof) ?? (row.Dach as string | undefined);
    row.construction_type = row.construction_type ?? row.Typ_Konstrukcji;
    row.roof_type = row.roof_type ?? row.Typ_Dachu ?? row.Dach;
    row.walls = row.walls ?? row.Boki;
    return row as unknown as CennikRow;
  }
  const variantKey = deriveHallVariantKey(n, "cennik");
  return {
    wariant_hali: variantKey,
    Nazwa: deriveHallVariantLabel(n, "cennik", variantKey),
    Typ_Konstrukcji: n.construction_type != null ? String(n.construction_type) : (n.Typ_Konstrukcji as string | undefined),
    Typ_Dachu: n.roof_type != null ? String(n.roof_type) : (n.Typ_Dachu as string | undefined),
    Boki: n.walls != null ? String(n.walls) : (n.sides != null ? String(n.sides) : (n.Boki as string | undefined)),
    Dach: n.roof != null ? String(n.roof) : (n.Dach as string | undefined),
    area_min_m2: toNum(n.area_min_m2, 0),
    area_max_m2: toNum(n.area_max_m2, 0),
    cena: toNum(n.price ?? n.cena, 0),
    stawka_jednostka: (n.unit ?? n.stawka_jednostka ?? n.stawka_jedn) != null ? String(n.unit ?? n.stawka_jednostka ?? n.stawka_jedn) : undefined,
    uwagi: n.notes != null ? String(n.notes) : (n.uwagi as string | undefined),
  };
}

/** Normalize one dodatki row: Supabase (variant/hall_name/addon_name/price/unit/condition) -> app. */
function normalizeDodatkiRow(raw: RawRecord): DodatkiRow {
  if (raw.wariant_hali != null && raw.nazwa != null && raw.stawka != null) {
    return raw as unknown as DodatkiRow;
  }
  const n = raw as Record<string, unknown>;
  const variantKey = deriveHallVariantKey(n, "dodatki");
  return {
    wariant_hali: variantKey,
    Nazwa: deriveHallVariantLabel(n, "dodatki", variantKey),
    nazwa: String(n.addon_name ?? n.nazwa ?? n.name ?? ""),
    stawka: toNum(n.price ?? n.stawka, 0),
    jednostka: String(n.unit ?? n.jednostka ?? ""),
    warunek: n.condition != null ? String(n.condition) : (n.warunek as string | undefined),
    warunek_type: n.condition_type as string | undefined,
    warunek_min: (n.condition_min ?? n.warunek_min) as string | number | undefined,
    warunek_max: (n.condition_max ?? n.warunek_max) as string | number | undefined,
  };
}

/** Normalize one standard row: Supabase (variant/qty/ref_value/notes) -> app (wariant_hali/ilosc/wartosc_ref/uwagi). */
function normalizeStandardRow(raw: RawRecord): StandardRow {
  if (raw.wariant_hali != null && raw.element != null) {
    return raw as unknown as StandardRow;
  }
  const n = raw as Record<string, unknown>;
  const refVal = n.ref_value ?? n.wartosc_ref;
  const wartoscRef: number | string =
    typeof refVal === "number" || typeof refVal === "string" ? refVal : toNum(refVal, 0);
  const variantKey = deriveHallVariantKey(n, "standard");
  return {
    wariant_hali: variantKey,
    element: String(n.element ?? n.name ?? ""),
    ilosc: toNum(n.qty ?? n.ilosc, 1),
    wartosc_ref: wartoscRef,
    jednostka: n.unit != null ? String(n.unit) : (n.jednostka as string | undefined),
    uwagi: n.notes != null ? String(n.notes) : (n.uwagi as string | undefined),
  };
}

function toNum(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v.replace(/\s/g, ""));
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

/** Normalize payload from Supabase base_pricing. Uses payload.cennik, payload.dodatki, payload.standard only (no pricing_surface). */
function normalizeBasePayload(p: Record<string, unknown>): {
  meta: BaseResponse["meta"];
  cennik: CennikRow[];
  dodatki: DodatkiRow[];
  standard: StandardRow[];
} {
  const rawCennik = Array.isArray(p.cennik) ? p.cennik : [];
  const rawDodatki = Array.isArray(p.dodatki) ? p.dodatki : [];
  const rawStandard = Array.isArray(p.standard) ? p.standard : [];
  const cennik = rawCennik.map((r) => normalizeCennikRow(typeof r === "object" && r != null ? (r as RawRecord) : {}));
  const dodatki = rawDodatki.map((r) => normalizeDodatkiRow(typeof r === "object" && r != null ? (r as RawRecord) : {}));
  const standard = rawStandard
    .map((r) => normalizeStandardRow(typeof r === "object" && r != null ? (r as RawRecord) : {}))
    .filter((s) => s.wariant_hali && s.element);
  const meta = (p.meta as BaseResponse["meta"]) ?? { version: 0, lastUpdated: new Date().toISOString() };
  if (process.env.LOG_LEVEL === "debug") {
    const byVariant = new Map<string, string>();
    for (const r of cennik) {
      if (!r?.wariant_hali) continue;
      if (!byVariant.has(r.wariant_hali)) byVariant.set(r.wariant_hali, r.Nazwa ?? r.wariant_hali);
    }
    // eslint-disable-next-line no-console
    console.debug("[apiAdapter] base_pricing fetched", {
      version: meta.version,
      cennik: cennik.length,
      dodatki: dodatki.length,
      standard: standard.length,
      groupedVariants: byVariant.size,
      variantLabels: [...byVariant.values()].slice(0, 20),
      firstCennikKeys: cennik[0] ? Object.keys(cennik[0] as unknown as Record<string, unknown>) : [],
      firstDodatkiKeys: dodatki[0] ? Object.keys(dodatki[0] as unknown as Record<string, unknown>) : [],
      firstStandardKeys: standard[0] ? Object.keys(standard[0] as unknown as Record<string, unknown>) : [],
    });
  }
  return {
    meta,
    cennik,
    dodatki,
    standard,
  };
}

export interface SupabaseApiAdapterConfig {
  supabase: SupabaseClient;
  userId?: string;
  /** Optional: base URL for logging (e.g. Supabase project URL). */
  supabaseUrl?: string;
}

export interface RelationalPricingResult {
  hallVariants: Array<{ variant: string; name: string; tiers: Array<{ min: number; max: number; price: number; unit?: string }> }>;
  cennik: CennikRow[];
  dodatki: DodatkiRow[];
  standard: StandardRow[];
  version: number;
  lastUpdated: string;
}

export function createSupabaseApiAdapter(config: SupabaseApiAdapterConfig): {
  getMeta: () => Promise<MetaOnlyResponse | BaseResponse>;
  getBase: () => Promise<BaseResponse>;
  getRelationalPricing: () => Promise<RelationalPricingResult | null>;
  logPdf: (payload: LogPdfPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  logEmail: (payload: LogEmailPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  heartbeat: (payload: HeartbeatPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  reserveOfferNumber: (payload: ReserveOfferNumberPayload) => Promise<ReserveOfferNumberResponse>;
} {
  const { supabase, userId, supabaseUrl } = config;

  /** Single source: public.base_pricing. RLS: only "authenticated" can read; if anon, query returns 0 rows. */
  const basePricingQuery = () =>
    supabase
      .from("base_pricing")
      .select("payload, version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

  function logSupabaseError(label: string, error: unknown): void {
    const e = error as { message?: string; code?: string; details?: string; hint?: string } | null;
    if (!e) return;
    console.error("[Supabase]", label, {
      message: e.message,
      code: e.code,
      details: e.details,
      hint: e.hint,
    });
  }

  function parsePayload(payload: unknown): Record<string, unknown> {
    if (payload == null) return {};
    if (typeof payload === "object" && !Array.isArray(payload)) return payload as Record<string, unknown>;
    if (typeof payload === "string") {
      try {
        return JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }

  async function getMeta(): Promise<MetaOnlyResponse | BaseResponse> {
    const { data, error } = await basePricingQuery();
    if (error) {
      logSupabaseError("base_pricing getMeta error", error);
      throw new Error(error.message);
    }
    if (!data) {
      console.warn("[Supabase] base_pricing getMeta: 0 rows (check RLS – SELECT only for 'authenticated' role; anon returns empty)");
      return { ok: true, meta: { version: 0, lastUpdated: new Date().toISOString() } };
    }
    const rowVersion = data.version != null ? Number(data.version) : null;
    const p = parsePayload(data.payload);
    if (Object.keys(p).length === 0) {
      return {
        ok: true,
        meta: { version: rowVersion ?? 0, lastUpdated: new Date().toISOString() },
      };
    }
    const payloadMeta = p.meta as { version?: number; lastUpdated?: string } | undefined;
    return {
      ok: true,
      meta: {
        version: rowVersion ?? payloadMeta?.version ?? 0,
        lastUpdated: (payloadMeta?.lastUpdated as string) ?? new Date().toISOString(),
      },
    };
  }

  async function getBase(): Promise<BaseResponse> {
    const url =
      supabaseUrl ??
      (supabase as unknown as { supabaseUrl?: string }).supabaseUrl ??
      "Supabase";
    const fullUrl = url + "/rest/v1/base_pricing?select=payload,version&order=version.desc&limit=1";
    console.log("BASE FETCH URL:", fullUrl);

    const { data: row, error } = await basePricingQuery();
    const errCode = (error as unknown as { code?: string | number })?.code;
    const status = error && typeof errCode === "string" ? 500 : (typeof errCode === "number" ? errCode : 500);
    console.log("BASE FETCH STATUS:", status, "rowCount:", row != null ? 1 : 0, "error:", error ? (error as { message?: string }).message : null);

    if (error) {
      logSupabaseError("base_pricing getBase error", error);
      console.error("BASE_PRICING_EMPTY_SUPABASE", { message: error.message, code: (error as unknown as { code?: string | number }).code, details: (error as { details?: string }).details });
      throw new Error("BASE_PRICING_EMPTY");
    }
    if (row == null) {
      console.warn("BASE_PRICING_EMPTY_SUPABASE", {
        reason: "no row from base_pricing",
        hint: "RLS on base_pricing allows SELECT only for authenticated. Log in or add policy: CREATE POLICY \"Allow anon read base_pricing\" ON base_pricing FOR SELECT TO anon USING (true);",
      });
      throw new Error("BASE_PRICING_EMPTY");
    }

    const rawPayload = parsePayload(row.payload) as Record<string, unknown>;
    const p = {
      cennik: Array.isArray(rawPayload.cennik) ? rawPayload.cennik : [],
      dodatki: Array.isArray(rawPayload.dodatki) ? rawPayload.dodatki : [],
      standard: Array.isArray(rawPayload.standard) ? rawPayload.standard : [],
    };

    console.log("pricing payload keys", Object.keys(rawPayload));
    console.log("cennik count", p.cennik.length);
    console.log("dodatki count", p.dodatki.length);
    console.log("standard count", p.standard.length);

    if (p.cennik.length === 0) {
      console.error("BASE_PRICING_EMPTY_SUPABASE", { payloadKeys: Object.keys(rawPayload) });
      throw new Error("BASE_PRICING_EMPTY");
    }

    const rowVersion = row?.version != null ? Number(row.version) : 0;
    const normalized = normalizeBasePayload({
      ...rawPayload,
      cennik: p.cennik,
      dodatki: p.dodatki,
      standard: p.standard,
    });
    // base_pricing stores spec in payload (jsonb); attach optional payload to each CennikRow so PDF can read row.payload.Typ_*.
    const hasSpecInPayload =
      rawPayload.Typ_Konstrukcji != null || rawPayload.Typ_Dachu != null || rawPayload.Boki != null;
    const specPayload =
      hasSpecInPayload
        ? {
            Typ_Konstrukcji: rawPayload.Typ_Konstrukcji as string | undefined,
            Typ_Dachu: rawPayload.Typ_Dachu as string | undefined,
            Boki: rawPayload.Boki as string | undefined,
          }
        : undefined;
    const cennik: CennikRow[] =
      specPayload != null
        ? normalized.cennik.map((r) => ({ ...r, payload: specPayload }))
        : normalized.cennik;
    return {
      ok: true,
      meta: { ...normalized.meta, version: rowVersion },
      cennik,
      dodatki: normalized.dodatki,
      standard: normalized.standard,
      debug: process.env.LOG_LEVEL === "debug" ? { counts: { cennik: normalized.cennik.length, dodatki: normalized.dodatki.length, standard: normalized.standard.length } } : undefined,
    };
  }

  async function logPdf(payload: LogPdfPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    if (process.env.LOG_LEVEL === "debug") {
      // eslint-disable-next-line no-console
      console.debug("[apiAdapter] logPdf", { id: payload.id, offerId: (payload as { offerId?: string }).offerId });
    }
    const pl = payload as unknown as Record<string, unknown>;
    const offerId = (payload as { offerId?: string }).offerId ?? (pl.offerId as string | undefined);
    const { data, error } = await supabase
      .from("pdf_history")
      .insert({
        offer_id: offerId ?? null,
        meta: {
          id: payload.id,
          userEmail: payload.userEmail,
          clientName: payload.clientName,
          variantHali: payload.variantHali,
          widthM: payload.widthM,
          lengthM: payload.lengthM,
          areaM2: payload.areaM2,
          totalPln: payload.totalPln,
          fileName: payload.fileName,
          createdAt: payload.createdAt,
        },
        created_by: userId ?? payload.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (data as { id: string })?.id };
  }

  async function logEmail(payload: LogEmailPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    if (process.env.LOG_LEVEL === "debug") {
      // eslint-disable-next-line no-console
      console.debug("[apiAdapter] logEmail", { offerId: payload.offerId, toEmail: payload.toEmail });
    }
    const pl = payload as unknown as Record<string, unknown>;
    const offerId = (payload.offerId ?? pl.offerId) as string | undefined;
    const { data, error } = await supabase
      .from("email_history")
      .insert({
        offer_id: offerId ?? null,
        to_email: payload.toEmail,
        subject: payload.subject,
        body_preview: (pl.bodyPreview as string | undefined) ?? null,
        sent_at: payload.sentAt ?? new Date().toISOString(),
        status: payload.status,
        error: payload.errorMessage ?? null,
        meta: {
          id: payload.id,
          userId: payload.userId,
          userEmail: payload.userEmail,
          fromEmail: pl.fromEmail,
          offerId,
        },
        created_by: userId ?? payload.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (data as { id: string })?.id };
  }

  async function heartbeat(payload: HeartbeatPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    const { error } = await supabase.from("sync_log").insert({
      device_id: payload.id,
      user_id: userId ?? payload.userId ?? null,
      action: "heartbeat",
      meta: {
        userEmail: payload.userEmail,
        deviceType: payload.deviceType,
        appVersion: payload.appVersion,
        occurredAt: payload.occurredAt,
      },
    });
    if (error) {
      // RLS może blokować insert (np. brak sesji Supabase, offline). Nie blokujemy działania aplikacji.
      if (process.env.LOG_LEVEL === "debug") {
        const e = error as { message?: string; code?: string };
        console.warn("[Supabase] sync_log heartbeat skipped (RLS or offline)", e?.message ?? e?.code);
      }
      return { ok: true };
    }
    return { ok: true };
  }

  async function getRelationalPricing(): Promise<RelationalPricingResult | null> {
    try {
      const { fetchRelationalPricing } = await import("../../src/services/relationalPricingLoader");
      return fetchRelationalPricing(supabase);
    } catch (e) {
      if (process.env.LOG_LEVEL === "debug") {
        console.debug("[apiAdapter] getRelationalPricing failed", e instanceof Error ? e.message : String(e));
      }
      return null;
    }
  }

  async function reserveOfferNumber(payload: ReserveOfferNumberPayload): Promise<ReserveOfferNumberResponse> {
    if (process.env.LOG_LEVEL === "debug") {
      // eslint-disable-next-line no-console
      console.debug("[apiAdapter] reserveOfferNumber", { offerId: payload.id });
    }
    const { data, error } = await supabase.rpc("rpc_finalize_offer_number", {
      p_offer_id: payload.id,
    });
    if (error) return { ok: false, error: error.message };
    const result = data as { ok?: boolean; offerNumber?: string; error?: string } | null;
    if (!result?.ok || result.error) return { ok: false, error: result?.error ?? "Unknown error" };
    if (process.env.LOG_LEVEL === "debug") {
      // eslint-disable-next-line no-console
      console.debug("[apiAdapter] reserveOfferNumber ok", { offerNumber: result.offerNumber });
    }
    return { ok: true, offerNumber: result.offerNumber };
  }

  return { getMeta, getBase, getRelationalPricing, logPdf, logEmail, heartbeat, reserveOfferNumber };
}
