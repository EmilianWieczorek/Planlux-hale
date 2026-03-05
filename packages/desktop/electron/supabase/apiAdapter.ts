/**
 * Supabase-backed API adapter: getMeta, getBase, logPdf, logEmail, heartbeat.
 * Replaces Google Apps Script backend. Uses tables: base_pricing, pdf_history, email_history, sync_log.
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
} from "@planlux/shared";

export interface SupabaseApiAdapterConfig {
  supabase: SupabaseClient;
  userId?: string;
}

export function createSupabaseApiAdapter(config: SupabaseApiAdapterConfig): {
  getMeta: () => Promise<MetaOnlyResponse | BaseResponse>;
  getBase: () => Promise<BaseResponse>;
  logPdf: (payload: LogPdfPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  logEmail: (payload: LogEmailPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  heartbeat: (payload: HeartbeatPayload) => Promise<{ ok: boolean; message?: string; id?: string }>;
  reserveOfferNumber: (payload: ReserveOfferNumberPayload) => Promise<ReserveOfferNumberResponse>;
} {
  const { supabase, userId } = config;

  async function getMeta(): Promise<MetaOnlyResponse | BaseResponse> {
    const { data, error } = await supabase
      .from("base_pricing")
      .select("payload, version, created_at")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.payload) {
      return { ok: true, meta: { version: 0, lastUpdated: new Date().toISOString() } };
    }
    const p = data.payload as Record<string, unknown>;
    const meta = p.meta as { version: number; lastUpdated: string } | undefined;
    return {
      ok: true,
      meta: meta ?? { version: (data.version as number) ?? 0, lastUpdated: (data.created_at as string) ?? new Date().toISOString() },
    };
  }

  async function getBase(): Promise<BaseResponse> {
    const { data, error } = await supabase
      .from("base_pricing")
      .select("payload")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.payload) {
      return {
        ok: true,
        meta: { version: 0, lastUpdated: new Date().toISOString() },
        cennik: [],
        dodatki: [],
        standard: [],
      };
    }
    const p = data.payload as Record<string, unknown>;
    return {
      ok: true,
      meta: (p.meta as BaseResponse["meta"]) ?? { version: 0, lastUpdated: new Date().toISOString() },
      cennik: (p.cennik as BaseResponse["cennik"]) ?? [],
      dodatki: (p.dodatki as BaseResponse["dodatki"]) ?? [],
      standard: (p.standard as BaseResponse["standard"]) ?? [],
    };
  }

  async function logPdf(payload: LogPdfPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    const { data, error } = await supabase
      .from("pdf_history")
      .insert({
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
    const { data, error } = await supabase.rpc("rpc_finalize_offer_number", {
      p_offer_id: payload.id,
    });
    if (error) return { ok: false, error: error.message };
    const result = data as { ok?: boolean; offerNumber?: string; error?: string } | null;
    if (!result?.ok || result.error) return { ok: false, error: result?.error ?? "Unknown error" };
    return { ok: true, offerNumber: result.offerNumber };
  }

  return { getMeta, getBase, logPdf, logEmail, heartbeat, reserveOfferNumber };
}
