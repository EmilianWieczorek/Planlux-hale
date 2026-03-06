// Edge Function: create-user (tylko dla roli ADMIN, wywołane z aplikacji z JWT).
// Body: { email, password, displayName?, role? }
// Używa SUPABASE_SERVICE_ROLE_KEY do auth.admin.createUser() i insert do profiles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

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
      return new Response(JSON.stringify({ ok: false, error: "Server config error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "");

    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: userError } = await supabaseAuth.auth.getUser(jwt);
    if (userError || !caller) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await supabaseAuth.from("profiles").select("role").eq("id", caller.id).single();
    const role = (profile?.role as string) ?? "";
    if (role !== "ADMIN") {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden: only ADMIN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json() as { email?: string; password?: string; displayName?: string; role?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: "email required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: newUser, error: createError } = await supabaseAuth.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: true,
      user_metadata: { display_name: (body.displayName ?? "").trim() || null },
    });

    if (createError) {
      return new Response(JSON.stringify({ ok: false, error: createError.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const newRole = (body.role ?? "SALES").trim().toUpperCase();
    const allowedRoles = ["ADMIN", "MANAGER", "SALES"];
    const profileRole = allowedRoles.includes(newRole) ? newRole : "SALES";

    // Update profile (trigger already inserted row with id, email). Do not set updated_at – profiles table may not have that column (e.g. 20260305 migration).
    const { error: updateError } = await supabaseAuth.from("profiles").update({
      display_name: (body.displayName ?? "").trim() || null,
      role: profileRole,
    }).eq("id", newUser.user.id);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, error: `Profile update failed: ${updateError.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(
      JSON.stringify({ ok: true, id: newUser.user.id, email: newUser.user.email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
