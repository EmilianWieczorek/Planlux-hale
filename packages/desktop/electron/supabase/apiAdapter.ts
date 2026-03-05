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

/** Normalize one cennik row: Supabase (variant/name/price/unit) or Polish (wariant_hali/Nazwa/cena/stawka_jedn) -> app canonical. */
function normalizeCennikRow(raw: RawRecord): CennikRow {
  const n = raw as Record<string, unknown>;
  const hasPolishKeys = n.wariant_hali != null && n.Nazwa != null && n.cena != null;
  if (hasPolishKeys) {
    const row = { ...n } as Record<string, unknown>;
    row.stawka_jednostka = n.stawka_jednostka ?? n.stawka_jedn;
    return row as unknown as CennikRow;
  }
  return {
    wariant_hali: String(n.variant ?? n.wariant_hali ?? ""),
    Nazwa: String(n.name ?? n.Nazwa ?? n.variant ?? ""),
    Typ_Konstrukcji: n.construction_type != null ? String(n.construction_type) : (n.Typ_Konstrukcji as string | undefined),
    Typ_Dachu: n.roof_type != null ? String(n.roof_type) : (n.Typ_Dachu as string | undefined),
    Boki: n.sides != null ? String(n.sides) : (n.Boki as string | undefined),
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
  return {
    wariant_hali: String(n.variant ?? n.hall_name ?? n.wariant_hali ?? ""),
    Nazwa: n.hall_name != null ? String(n.hall_name) : (n.Nazwa as string | undefined),
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
  return {
    wariant_hali: String(n.variant ?? n.wariant_hali ?? ""),
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
    // eslint-disable-next-line no-console
    console.debug("[apiAdapter] base_pricing fetched", {
      version: meta.version,
      cennik: cennik.length,
      dodatki: dodatki.length,
      standard: standard.length,
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

export function createSupabaseApiAdapter(config: SupabaseApiAdapterConfig): {
  getMeta: () => Promise<MetaOnlyResponse | BaseResponse>;
  getBase: () => Promise<BaseResponse>;
  logPdf: (payload: LogPdfPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  logEmail: (payload: LogEmailPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  heartbeat: (payload: HeartbeatPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  reserveOfferNumber: (payload: ReserveOfferNumberPayload) => Promise<ReserveOfferNumberResponse>;
} {
  const { supabase, userId, supabaseUrl } = config;

  /** Single source: base_pricing. Query: select payload, version from base_pricing order by version desc limit 1 */
  const basePricingQuery = () =>
    supabase
      .from("base_pricing")
      .select("payload, version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

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
    if (error) throw new Error(error.message);
    if (!data) {
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
    const { data: row, error } = await basePricingQuery();
    if (process.env.LOG_LEVEL === "debug") {
      const url = supabaseUrl ?? (supabase as any).supabaseUrl ?? "Supabase";
      const fullUrl = url + "/rest/v1/base_pricing?select=payload,version";
      const responseStatus = error ? (error as any).code ?? 500 : 200;
      const body =
        error != null
          ? JSON.stringify({ error: (error as any).message, code: (error as any).code })
          : row != null
            ? JSON.stringify({ version: row.version, payloadKeys: row.payload != null && typeof row.payload === "object" ? Object.keys(row.payload as object) : null })
            : "null";
      console.log("BASE FETCH URL:", fullUrl, "STATUS:", responseStatus, "BODY:", body.slice(0, 500));
    }
    if (error) {
      throw new Error("BASE_PRICING_EMPTY");
    }
    const rowVersion = row?.version != null ? Number(row.version) : 0;
    const p = (parsePayload(row?.payload) ?? {}) as BasePricingPayload;
    const cennikArr = Array.isArray(p.cennik) ? p.cennik : [];
    const dodatkiArr = Array.isArray(p.dodatki) ? p.dodatki : [];
    const standardArr = Array.isArray(p.standard) ? p.standard : [];
    const hasValidStructure =
      typeof rowVersion === "number" &&
      Array.isArray(cennikArr) &&
      Array.isArray(dodatkiArr) &&
      Array.isArray(standardArr);
    if (!hasValidStructure || cennikArr.length === 0) {
      throw new Error("BASE_PRICING_EMPTY");
    }
    if (process.env.LOG_LEVEL === "debug") {
      console.log("pricing payload keys", Object.keys(p), "version", rowVersion, "cennik", cennikArr.length, "dodatki", dodatkiArr.length, "standard", standardArr.length);
    }
    const normalized = normalizeBasePayload({
      ...p,
      cennik: cennikArr,
      dodatki: dodatkiArr,
      standard: standardArr,
    } as Record<string, unknown>);
    return {
      ok: true,
      meta: { ...normalized.meta, version: rowVersion },
      cennik: normalized.cennik,
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
      user_id: userId ?? payload.userId,
      action: "heartbeat",
      meta: {
        userEmail: payload.userEmail,
        deviceType: payload.deviceType,
        appVersion: payload.appVersion,
        occurredAt: payload.occurredAt,
      },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
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

  return { getMeta, getBase, logPdf, logEmail, heartbeat, reserveOfferNumber };
}
