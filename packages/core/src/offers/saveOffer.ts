import type { SupabaseClient } from "@supabase/supabase-js";

export interface SaveOfferInput {
  userId: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
  clientCompany?: string;
  clientAddress?: string;
  variant: string;
  width: number;
  length: number;
  height?: number;
  area: number;
  totalPrice: number;
}

export interface SavedOffer {
  id: string;
  user_id: string;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  client_company?: string | null;
  client_address?: string | null;
  variant_hali: string;
  width_m: number;
  length_m: number;
  height_m?: number | null;
  area_m2: number;
  total_pln: number;
  created_at?: string;
  updated_at?: string;
}

function cleanOpt(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

/**
 * Save an offer to Supabase `public.offers`.
 * Designed to be called from the Electron main process (via IPC), using the existing Supabase client.
 */
export async function saveOffer(supabase: SupabaseClient, input: SaveOfferInput): Promise<SavedOffer> {
  if (process.env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug("[offers] saving offer", {
      userId: input.userId,
      clientName: input.clientName,
      variant: input.variant,
      area: input.area,
      totalPrice: input.totalPrice,
    });
  }

  const row = {
    user_id: input.userId,
    client_name: input.clientName,
    client_email: cleanOpt(input.clientEmail),
    client_phone: cleanOpt(input.clientPhone),
    client_company: cleanOpt(input.clientCompany),
    client_address: cleanOpt(input.clientAddress),
    variant_hali: input.variant,
    width_m: input.width,
    length_m: input.length,
    height_m: input.height ?? null,
    area_m2: input.area,
    total_pln: input.totalPrice,
  };

  const { data, error } = await supabase.from("offers").insert(row).select("*").single();
  if (error) {
    const details = (error as unknown as { details?: string; hint?: string; code?: string }).details;
    const hint = (error as unknown as { hint?: string }).hint;
    const code = (error as unknown as { code?: string }).code;
    throw new Error(`[offers] Supabase insert failed: ${error.message}${code ? ` (${code})` : ""}${details ? ` – ${details}` : ""}${hint ? ` – ${hint}` : ""}`);
  }
  if (!data || typeof (data as { id?: unknown }).id !== "string") {
    throw new Error("[offers] Supabase insert returned no row/id");
  }

  const saved = data as unknown as SavedOffer;
  if (process.env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug("[offers] offer saved", { id: saved.id });
  }
  return saved;
}

