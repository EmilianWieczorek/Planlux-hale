"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveOffer = saveOffer;
function cleanOpt(v) {
    const s = (v ?? "").trim();
    return s.length ? s : null;
}
const TARGET_TABLE = "public.offers";
/**
 * Save an offer to Supabase `public.offers`.
 * Table requires explicit columns: variant, client_name, width_m, length_m, height_m, area_m2, total_pln, user_id.
 * Optional payload_json for debugging.
 */
async function saveOffer(supabase, input) {
    const payload = {
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
    if (!payload.variant_hali) {
        throw new Error("[offers] variant_hali missing");
    }
    const row = {
        user_id: payload.user_id,
        client_name: payload.client_name,
        client_email: payload.client_email,
        client_phone: payload.client_phone,
        client_company: payload.client_company,
        client_address: payload.client_address,
        variant: payload.variant_hali,
        width_m: payload.width_m,
        length_m: payload.length_m,
        height_m: payload.height_m,
        area_m2: payload.area_m2,
        total_pln: payload.total_pln,
        payload_json: payload,
    };
    const insertRowKeys = Object.keys(row);
    // eslint-disable-next-line no-console
    console.info("[offers] saveOffer insert", {
        targetTable: TARGET_TABLE,
        insertRowKeys,
    });
    const { data, error } = await supabase.from("offers").insert(row).select("id").single();
    if (error) {
        const code = error.code;
        const details = error.details;
        const hint = error.hint;
        // eslint-disable-next-line no-console
        console.error("[offers] saveOffer error", {
            targetTable: TARGET_TABLE,
            insertRowKeys,
            errorMessage: error.message,
            code,
            details,
            hint,
        });
        const enriched = new Error(`[offers] Supabase insert failed: ${error.message}${code ? ` (${code})` : ""}${details ? ` – ${details}` : ""}${hint ? ` – ${hint}` : ""}`);
        enriched.code = code;
        enriched.details = details;
        enriched.hint = hint;
        throw enriched;
    }
    if (!data || typeof data.id !== "string") {
        throw new Error("[offers] Supabase insert returned no row/id");
    }
    const rowData = data;
    const saved = {
        id: rowData.id,
        user_id: payload.user_id,
        client_name: payload.client_name,
        client_email: payload.client_email,
        client_phone: payload.client_phone,
        client_company: payload.client_company,
        client_address: payload.client_address,
        variant_hali: payload.variant_hali,
        width_m: payload.width_m,
        length_m: payload.length_m,
        height_m: payload.height_m,
        area_m2: payload.area_m2,
        total_pln: payload.total_pln,
        created_at: undefined,
        updated_at: undefined,
    };
    // eslint-disable-next-line no-console
    console.info("[offers] saveOffer success", { targetTable: TARGET_TABLE, id: saved.id });
    return saved;
}
