/**
 * Auth and users via Supabase (Auth + profiles). No Google Apps Script.
 * Login: signInWithPassword + profile. Sync users: select from profiles (RLS: admin/manager).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger";
import { AppError } from "../errors/AppError";

export type SupabaseAuthUser = { id: string; email: string; role: string; name?: string };
export type LoginResponse = { ok: true; user: SupabaseAuthUser } | { ok: false; error?: string };
export type ListUsersResponse = { ok: true; users: Array<{ email: string; role: string; name?: string; active?: boolean }> } | { ok: false; error?: string };

function normalizeRole(r: string): string {
  const s = (r ?? "").trim().toUpperCase();
  if (s === "ADMIN") return "ADMIN";
  if (s === "SZEF" || s === "BOSS" || s === "MANAGER") return "SZEF";
  return "HANDLOWIEC";
}

/**
 * Login via Supabase Auth; returns profile (id, email, role, display_name) for session.
 */
export async function loginViaSupabase(
  supabase: SupabaseClient,
  email: string,
  password: string
): Promise<LoginResponse> {
  const emailNorm = email.trim().toLowerCase();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password,
  });

  if (authError) {
    const authLog = logger.child("auth");

    // Default: invalid credentials.
    let code = "AUTH_INVALID_CREDENTIALS";
    let message = authError.message || "Nieprawidłowy login lub hasło.";

    // Diagnostics: check legacy app_users (read-only) to see if user exists there but not in Auth.
    try {
      const { data: legacyUser, error: legacyError } = await supabase
        .from("app_users")
        .select("id, email, name, role")
        .eq("email", emailNorm)
        .maybeSingle();

      if (!legacyError && legacyUser) {
        code = "AUTH_USER_NOT_IN_SUPABASE_AUTH";
        message =
          "Użytkownik istnieje w starej tabeli app_users, ale nie w Supabase Auth. Utwórz konto w Auth (Admin) lub użyj bootstrapu.";
        authLog.warn("User exists in app_users but not Supabase Auth", {
          email: emailNorm,
          appUsersId: (legacyUser as { id?: string }).id,
        });
      }
    } catch (e) {
      authLog.warn("Failed to check app_users for legacy user", {
        email: emailNorm,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    authLog.error("Supabase login failed", {
      email: emailNorm,
      errorMessage: authError.message,
      errorStatus: (authError as { status?: number }).status,
      code,
    });

    throw new AppError(code, message, { expose: true });
  }

  const userId = authData.user?.id;
  if (!userId) {
    logger.child("auth").error("Supabase login: no user in response", { email: emailNorm });
    return { ok: false, error: "Brak użytkownika w odpowiedzi" };
  }

  logger.child("auth").info("Supabase login success", {
    userId,
    email: authData.user?.email ?? emailNorm,
  });

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    await supabase.auth.signOut();
    const msg = profileError.message ?? "Błąd profilu użytkownika";
    const lower = msg.toLowerCase();
    const isSchemaMissing =
      (lower.includes("could not find table") || lower.includes("schema cache")) && lower.includes("profiles");
    if (isSchemaMissing) {
      logger.child("auth").error("Supabase profile fetch failed – profiles table missing", {
        userId,
        errorMessage: msg,
      });
      throw new AppError(
        "SUPABASE_SCHEMA_MISSING",
        "Brakuje tabeli profiles w Supabase. Uruchom migracje.",
        { expose: true, details: { hint: "Run: supabase db push" } }
      );
    }
    logger.child("auth").error("Supabase profile fetch failed", {
      userId,
      errorMessage: msg,
    });
    return { ok: false, error: msg };
  }

  if (!profile) {
    logger.child("auth").warn("Profile missing for user after login", { userId, email: emailNorm });
    try {
      const { error: insertErr } = await supabase.from("profiles").insert({
        id: userId,
        email: emailNorm,
      });
      if (insertErr) {
        logger.child("auth").warn("Could not auto-create profile", {
          userId,
          errorMessage: insertErr.message,
        });
      }
    } catch (e) {
      logger.child("auth").warn("Could not auto-create profile", {
        userId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const role = normalizeRole((profile?.role as string) ?? "SALES");
  const displayName = (profile?.display_name as string) ?? null;
  return {
    ok: true,
    user: {
      id: userId,
      email: (profile?.email as string) ?? emailNorm,
      role,
      name: displayName ?? undefined,
    },
  };
}

/**
 * List profiles (RLS: caller must be admin or manager to see all). For sync to local users table.
 */
export async function listProfilesFromSupabase(supabase: SupabaseClient): Promise<ListUsersResponse> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, role")
    .order("email");

  if (error) {
    return { ok: false, error: error.message };
  }

  const users = (data ?? []).map((row) => ({
    email: (row.email as string) ?? "",
    role: normalizeRole((row.role as string) ?? "SALES"),
    name: (row.display_name as string) ?? undefined,
    active: true,
  }));

  return { ok: true, users };
}

/**
 * DEV-only helper: bootstrap a user from legacy app_users into Supabase Auth + profiles via Edge Function create-user.
 * Caller must enforce mode==='dev' and ADMIN role.
 */
export async function bootstrapUserFromAppUsers(
  supabase: SupabaseClient,
  email: string,
  newPassword: string
): Promise<
  | { ok: true; email: string; userId: string | null; appUsersId: string | null }
  | { ok: false; error: string }
> {
  const emailNorm = email.trim().toLowerCase();
  if (!emailNorm) return { ok: false, error: "Email jest wymagany" };
  if (!newPassword) return { ok: false, error: "Hasło jest wymagane" };

  const log = logger.child("auth");

  const { data: legacyUser, error: legacyError } = await supabase
    .from("app_users")
    .select("id, email, name, role")
    .eq("email", emailNorm)
    .maybeSingle();

  if (legacyError) {
    log.error("Bootstrap from app_users failed (select)", {
      email: emailNorm,
      errorMessage: legacyError.message,
    });
    return { ok: false, error: legacyError.message };
  }
  if (!legacyUser) {
    return { ok: false, error: "Nie znaleziono użytkownika w app_users" };
  }

  const legacyId = (legacyUser as { id?: string }).id ?? null;
  const displayName = (legacyUser as { name?: string }).name ?? undefined;
  const roleRaw = (legacyUser as { role?: string }).role ?? "HANDLOWIEC";

  const { data, error } = await supabase.functions.invoke("create-user", {
    body: { email: emailNorm, password: newPassword, displayName, role: roleRaw },
  });
  if (error) {
    const msg =
      (data as { error?: string })?.error ??
      error.message ??
      "Błąd tworzenia użytkownika. Użyj Supabase Dashboard → Authentication → Users lub wdróż Edge Function create-user.";
    log.error("Bootstrap from app_users failed (create-user)", { email: emailNorm, errorMessage: msg });
    return { ok: false, error: msg };
  }
  if ((data as { ok?: boolean })?.ok !== true) {
    const msg = (data as { error?: string })?.error ?? "Błąd tworzenia użytkownika";
    log.error("Bootstrap from app_users failed (create-user payload)", { email: emailNorm, errorMessage: msg });
    return { ok: false, error: msg };
  }

  const userId = (data as { userId?: string }).userId ?? null;

  // Best-effort profile upsert (id from response if available, fallback to legacy id).
  const profileId = userId ?? legacyId;
  if (profileId) {
    try {
      const { error: upsertErr } = await supabase.from("profiles").upsert(
        {
          id: profileId,
          email: emailNorm,
          display_name: displayName,
          role: roleRaw,
        },
        { onConflict: "id" }
      );
      if (upsertErr) {
        log.warn("Bootstrap from app_users: profile upsert failed", {
          email: emailNorm,
          userId: profileId,
          errorMessage: upsertErr.message,
        });
      }
    } catch (e) {
      log.warn("Bootstrap from app_users: profile upsert threw", {
        email: emailNorm,
        userId: profileId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info("Bootstrap from app_users completed", {
    email: emailNorm,
    userId,
    appUsersId: legacyId,
  });

  return { ok: true, email: emailNorm, userId, appUsersId: legacyId };
}
