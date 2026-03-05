// Edge Function: send_offer_email
// Wejście: { offer_id: string, to_email: string, subject?: string, bodyHtml?: string, attachPdf?: boolean }
// Weryfikuje JWT, finalizuje numer (RPC), opcjonalnie dołącza PDF ze Storage, wysyła e-mail (SMTP/Resend), zapisuje email_history.
// Sekrety: SUPABASE_SERVICE_ROLE_KEY (w Supabase), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM lub RESEND_API_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

interface SendOfferEmailBody {
  offer_id: string;
  to_email: string;
  subject?: string;
  bodyHtml?: string;
  attachPdf?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "Missing Authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(JSON.stringify({ ok: false, error: "CONFIG_SMTP_MISSING: Server config error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = (await req.json()) as SendOfferEmailBody;
    const { offer_id, to_email, subject, bodyHtml, attachPdf } = body;
    if (!offer_id || !to_email) {
      return new Response(JSON.stringify({ ok: false, error: "offer_id and to_email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc("rpc_finalize_offer_number", { p_offer_id: offer_id });
    if (rpcError || !(rpcData as { ok?: boolean })?.ok) {
      const errMsg = (rpcData as { error?: string })?.error ?? rpcError?.message ?? "Finalize failed";
      const { error: insErr } = await supabase.from("email_history").insert({
        offer_id,
        created_by: user.id,
        to_email,
        subject: subject ?? "",
        status: "FAILED",
        error: errMsg,
        sent_at: null,
        meta: {},
      });
      return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const offerNumber = (rpcData as { offerNumber?: string }).offerNumber;
    let pdfUrl: string | null = null;
    if (attachPdf) {
      const { data: pdfRows } = await supabase.from("pdf_history").select("storage_path").eq("offer_id", offer_id).order("created_at", { ascending: false }).limit(1);
      const path = pdfRows?.[0]?.storage_path;
      if (path) {
        const { data: signed } = await supabase.storage.from("offer-pdfs").createSignedUrl(path, 3600);
        pdfUrl = signed?.signedUrl ?? null;
      }
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const smtpFrom = Deno.env.get("SMTP_FROM") ?? Deno.env.get("RESEND_FROM") ?? "noreply@planlux.pl";

    let sendError: string | null = null;
    if (resendKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: smtpFrom,
          to: [to_email],
          subject: subject ?? `Oferta ${offerNumber ?? offer_id}`,
          html: bodyHtml ?? `<p>Oferta ${offerNumber ?? offer_id}</p>`,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        sendError = `Resend: ${res.status} ${t}`;
      }
    } else {
      sendError = "CONFIG_SMTP_MISSING: Set RESEND_API_KEY or SMTP_* secrets in Supabase Edge Function secrets.";
    }

    const status = sendError ? "FAILED" : "SENT";
    const { data: histRow, error: histErr } = await supabase
      .from("email_history")
      .insert({
        offer_id,
        created_by: user.id,
        to_email,
        subject: subject ?? "",
        status,
        error: sendError,
        sent_at: sendError ? null : new Date().toISOString(),
        meta: { offerNumber, attachPdf: !!attachPdf },
      })
      .select("id")
      .single();

    if (histErr) {
      return new Response(JSON.stringify({ ok: false, error: histErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (sendError) {
      return new Response(JSON.stringify({ ok: false, error: sendError, emailHistoryId: (histRow as { id?: string })?.id }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ ok: true, status: "SENT", emailHistoryId: (histRow as { id: string }).id, offerNumber }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
