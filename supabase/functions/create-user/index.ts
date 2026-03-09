// Edge Function: create-user (tylko dla roli ADMIN, wywołane z aplikacji z JWT).
// Body: { email, password, displayName?, role? }
// Źródło prawdy uprawnień: JWT → auth user id; role → public.profiles.role (NIE app_users, NIE auth.users metadata).
// verify_jwt = false w config.toml – weryfikacja JWT wykonywana ręcznie (precyzyjne błędy).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

function jsonResponse(body: { ok: boolean; error: string; details?: string }, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Odczyt nagłówka Authorization (case-insensitive; proxy może przekazać lowercase).
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    const authHeaderLength = typeof authHeader === "string" ? authHeader.length : 0;
    console.log("[create-user] step: auth header", { hasHeader: !!authHeader, length: authHeaderLength });

    if (!authHeader || typeof authHeader !== "string") {
      return jsonResponse({ ok: false, error: "Missing Authorization header", details: "Send Authorization: Bearer <jwt>" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ ok: false, error: "Server config error", details: "SUPABASE_URL or SERVICE_ROLE_KEY missing" }, 500);
    }

    // 2. Parsowanie tokena Bearer (Bearer <token> lub bearer <token>).
    const bearerMatch = /^\s*bearer\s+(.+)$/i.exec(authHeader.trim());
    const jwt = bearerMatch ? bearerMatch[1].trim() : authHeader.trim();
    const jwtLength = jwt.length;
    console.log("[create-user] step: token parsed", { jwtLength, hasToken: jwtLength > 0 });

    if (!jwt) {
      return jsonResponse({ ok: false, error: "Invalid Authorization header", details: "Expected: Bearer <token>" }, 401);
    }

    // 3. Weryfikacja JWT: klient z nagłówkiem Authorization z requestu, potem getUser() bez argumentu (kontekst z nagłówka).
    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    const caller = userData?.user;

    console.log("[create-user] step: getUser", {
      hasCaller: !!caller,
      userIdPrefix: caller?.id ? caller.id.slice(0, 8) + "…" : null,
      errorMessage: userError?.message ?? null,
    });

    if (userError || !caller) {
      const details = userError?.message ?? "Token invalid or expired";
      return jsonResponse({ ok: false, error: "Invalid or expired token", details }, 401);
    }

    // 4. Sprawdzenie roli ADMIN w public.profiles (jedno źródło prawdy; NIE używamy app_users).
    const supabaseAuth = createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile, error: profileError } = await supabaseAuth.from("profiles").select("role").eq("id", caller.id).single();

    if (profileError) {
      console.log("[create-user] step: profile error", { message: profileError.message });
      return jsonResponse({ ok: false, error: "Profile lookup failed", details: profileError.message }, 500);
    }

    const roleRaw = (profile?.role as string) ?? "";
    const roleNormalized = roleRaw.trim().toUpperCase();
    console.log("[create-user] step: profile role", { roleRaw, roleNormalized });

    if (roleNormalized !== "ADMIN") {
      return jsonResponse({ ok: false, error: "Only ADMIN can create users", details: `Caller role: ${roleNormalized || "(empty)"}` }, 403);
    }

    const body = await req.json() as { email?: string; password?: string; displayName?: string; role?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email) {
      return jsonResponse({ ok: false, error: "email required" }, 400);
    }

    // 5. Tworzenie użytkownika (auth.admin.createUser) i uzupełnienie profiles.
    const { data: newUser, error: createError } = await supabaseAuth.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: true,
      user_metadata: { display_name: (body.displayName ?? "").trim() || null },
    });

    if (createError) {
      const msg = createError.message ?? "";
      const isDuplicate = /already registered|already exists|duplicate|already been registered/i.test(msg);
      if (isDuplicate) {
        return jsonResponse({ ok: false, error: "User already exists", details: msg }, 409);
      }
      return jsonResponse({ ok: false, error: "Create user failed", details: msg }, 400);
    }

    const newRole = (body.role ?? "SALES").trim().toUpperCase();
    const allowedRoles = ["ADMIN", "MANAGER", "SALES"];
    const profileRole = allowedRoles.includes(newRole) ? newRole : "SALES";

    const { error: updateError } = await supabaseAuth.from("profiles").update({
      display_name: (body.displayName ?? "").trim() || null,
      role: profileRole,
    }).eq("id", newUser.user.id);

    if (updateError) {
      return jsonResponse({ ok: false, error: "Profile update failed", details: updateError.message }, 500);
    }

    console.log("[create-user] step: success", { email, id: newUser.user.id });
    return new Response(
      JSON.stringify({ ok: true, id: newUser.user.id, email: newUser.user.email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[create-user] exception", e);
    return jsonResponse({ ok: false, error: "Internal create-user error", details: String(e) }, 500);
  }
});
