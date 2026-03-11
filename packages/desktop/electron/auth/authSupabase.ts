/**
 * Auth and users via Supabase (Auth + profiles). No Google Apps Script.
 * Login: signInWithPassword + profile. Sync users: select from profiles (RLS: admin/manager).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRoleRbac } from "@planlux/shared";
import { logger } from "../logger";
import { AppError } from "../errors/AppError";

export type SupabaseAuthUser = { id: string; email: string; role: string; name?: string };
export type LoginResponse = { ok: true; user: SupabaseAuthUser } | { ok: false; error?: string };
export type ListUsersResponse = { ok: true; users: Array<{ email: string; role: string; name?: string; active?: boolean }> } | { ok: false; error?: string };

/** Normalize raw role to app role (uses shared rbac). */
function normalizeRoleFromProfile(r: string): string {
  return normalizeRoleRbac(r);
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

  const defaultRole = "HANDLOWIEC";
  const displayNameFromEmail = (emailNorm.split("@")[0] || "User").trim() || "User";

  if (profileError) {
    const msg = profileError.message ?? "Błąd profilu użytkownika";
    const lower = msg.toLowerCase();
    const isSchemaMissing =
      (lower.includes("could not find table") || lower.includes("schema cache")) && lower.includes("profiles");
    if (isSchemaMissing) {
      await supabase.auth.signOut();
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
    logger.child("auth").warn("[auth] role from Supabase: profile fetch failed – fallback to HANDLOWIEC", {
      userId,
      errorMessage: msg,
      defaultRole,
    });
    return {
      ok: true,
      user: {
        id: userId,
        email: emailNorm,
        role: defaultRole,
        name: displayNameFromEmail,
      },
    };
  }

  if (!profile) {
    logger.child("auth").warn("[auth] role from Supabase: profile null – fallback to HANDLOWIEC (profile returned null)", { userId, email: emailNorm, defaultRole });
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
    return {
      ok: true,
      user: {
        id: userId,
        email: emailNorm,
        role: defaultRole,
        name: displayNameFromEmail,
      },
    };
  }

  const profileRoleRaw = (profile.role as string) ?? defaultRole;
  const role = normalizeRoleFromProfile(profileRoleRaw);
  const displayName = (profile.display_name as string)?.trim() || displayNameFromEmail;
  logger.child("auth").info("[auth] role from Supabase profile", { userId, profileRoleRaw, effectiveRole: role });
  return {
    ok: true,
    user: {
      id: userId,
      email: (profile.email as string) ?? emailNorm,
      role,
      name: displayName,
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
    role: normalizeRoleFromProfile((row.role as string) ?? "SALES"),
    name: (row.display_name as string) ?? undefined,
    active: true,
  }));

  return { ok: true, users };
}

/**
 * Fetch profile role for a user by Supabase auth id (for role repair / hydrate). Returns normalized role or null if fetch fails.
 */
export async function getProfileRoleByUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logger.child("auth").warn("[auth] getProfileRoleByUserId failed", { userId, errorMessage: error.message });
    return null;
  }
  if (!profile || profile.role == null) return null;
  return normalizeRoleFromProfile(String(profile.role));
}
