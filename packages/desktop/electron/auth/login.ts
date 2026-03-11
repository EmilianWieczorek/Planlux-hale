/**
 * Supabase-only login (online required).
 * No offline mode. Local SQLite is NOT a source of truth for auth; at most it's a technical store for FK integrity.
 */

import { normalizeRoleRbac } from "@planlux/shared";
import { getOnlineState } from "../net/online";
import { hashPassword, verifyPassword, isLegacyHash } from "./password";
import type { SessionUser } from "./session";
import { AppError } from "../errors/AppError";

export const AUTH_INVALID_CREDENTIALS = "AUTH_INVALID_CREDENTIALS";
export const AUTH_OFFLINE_REQUIRES_ONLINE_LOGIN_ONCE = "AUTH_OFFLINE_REQUIRES_ONLINE_LOGIN_ONCE";
export const AUTH_OFFLINE_USER_NOT_FOUND = "AUTH_OFFLINE_USER_NOT_FOUND";
export const AUTH_BACKEND_ERROR = "AUTH_BACKEND_ERROR";
export const AUTH_UNKNOWN_ERROR = "AUTH_UNKNOWN_ERROR";
export const AUTH_SESSION_EXPIRED = "AUTH_SESSION_EXPIRED";
export const AUTH_USER_NOT_IN_SUPABASE_AUTH = "AUTH_USER_NOT_IN_SUPABASE_AUTH";
export const AUTH_ONLINE_REQUIRED = "AUTH_ONLINE_REQUIRED";

export type LoginSuccess = {
  ok: true;
  user: SessionUser;
  mustChangePassword: boolean;
  /** For session-based requireRole (main process stores by this). */
  token?: string;
};

export type LoginError = {
  ok: false;
  code: string;
  message: string;
};

export type LoginResult = LoginSuccess | LoginError;

type UserRow = {
  id: string;
  email: string;
  role: string;
  password_hash: string;
  password_salt?: string | null;
  password_algo_version?: number | null;
  password_unavailable?: number | null;
  display_name: string | null;
  must_change_password?: number;
};

/** Minimal DB interface for login (avoids coupling to better-sqlite3). */
export type DbLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

type BackendLogin = (baseUrl: string, email: string, password: string) => Promise<
  | { ok: true; user: { id?: string; email: string; role: string; name?: string } }
  | { ok: false; error?: string }
>;

/** When set, used for online login instead of backendLogin; user.id (e.g. Supabase auth uid) is used as userId. */
type SupabaseLogin = (email: string, password: string) => Promise<
  | { ok: true; user: { id: string; email: string; role: string; name?: string } }
  | { ok: false; error?: string }
>;

/** Map normalized role (ADMIN/SZEF/HANDLOWIEC) to DB enum. Tables may use (ADMIN,BOSS,SALESPERSON) or (HANDLOWIEC,SZEF,ADMIN). */
function roleForDb(db: DbLike, normalizedRole: string): string {
  const roleUpper = (normalizedRole ?? "").trim().toUpperCase();
  try {
    const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
    const sqlDef = (sqlRow?.sql ?? "").toUpperCase();
    if (sqlDef.includes("'BOSS'") && sqlDef.includes("'SALESPERSON'")) {
      if (roleUpper === "ADMIN") return "ADMIN";
      if (roleUpper === "SZEF") return "BOSS";
      return "SALESPERSON";
    }
  } catch {
    // ignore
  }
  return normalizedRole;
}

/** Ensure local users row exists before any dependent inserts (avoids SQLITE_CONSTRAINT_FOREIGNKEY). */
function ensureLocalUserExists(
  db: DbLike,
  params: { id: string; email: string; display_name: string | null; role: string; password_hash: string; created_at: string }
): void {
  const colNames = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!colNames.includes("id") || !colNames.includes("email") || !colNames.includes("password_hash")) return;
  const roleDb = roleForDb(db, params.role);
  const displayName = params.display_name ?? "";
  const now = params.created_at;
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, display_name, role, active, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
  ).run(params.id, params.email, displayName, roleDb, params.password_hash, now, now);
  db.prepare("UPDATE users SET email = ?, display_name = ?, role = ?, active = 1 WHERE id = ?").run(
    params.email,
    displayName,
    roleDb,
    params.id
  );
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    const name = (err.name ?? "").toLowerCase();
    if (name === "aborterror" || msg.includes("abort") || msg.includes("timeout") || msg.includes("network") || msg.includes("fetch")) return true;
  }
  return false;
}

export type PerformLoginDeps = {
  getDb: () => DbLike;
  backendUrl: string;
  backendLogin: BackendLogin;
  /** If set, used for online login instead of backendLogin; user.id from response is used as local userId. */
  supabaseLogin?: SupabaseLogin;
  onlineTimeoutMs?: number;
  uuid: () => string;
};

/**
 * Single login entrypoint: online-first, then offline fallback on network failure.
 * Does not create session; caller (IPC) creates session and sets currentUser from result.
 */
export async function performLogin(
  email: string,
  password: string,
  deps: PerformLoginDeps
): Promise<LoginResult> {
  const emailNorm = email.trim().toLowerCase();
  const db = deps.getDb();

  // Hard requirement: Supabase-only login (no backendLogin, no offline fallback).
  if (!deps.supabaseLogin) {
    return { ok: false, code: AUTH_BACKEND_ERROR, message: "Supabase login is not configured" };
  }

  // Best-effort connectivity check (for clearer error).
  const state = await getOnlineState({
    timeoutMs: deps.onlineTimeoutMs ?? 2000,
    backendUrl: deps.backendUrl,
  });
  if (state !== "online") {
    return { ok: false, code: AUTH_ONLINE_REQUIRED, message: "Brak połączenia z serwerem. Aplikacja wymaga internetu." };
  }

  try {
    const loginResult = await deps.supabaseLogin(emailNorm, password);
    if (!loginResult.ok || !loginResult.user) {
      const errMsg = ("error" in loginResult && loginResult.error ? loginResult.error : undefined) ?? "Nieprawidłowy email lub hasło";
      return { ok: false, code: AUTH_INVALID_CREDENTIALS, message: errMsg };
    }

    const u = loginResult.user;
    const role = normalizeRoleRbac(u.role ?? "HANDLOWIEC");
    const displayName = (u.name ?? "").trim() || null;

    // Technical: keep local FK integrity (pdfs/offers tables reference users). Not used for auth decisions.
    const hashed = hashPassword(password);
    const now = new Date().toISOString();
    ensureLocalUserExists(db, {
      id: u.id,
      email: emailNorm,
      display_name: displayName,
      role,
      password_hash: hashed.hash,
      created_at: now,
    });

    const user: SessionUser = { id: u.id, email: emailNorm, role, displayName };
    return { ok: true, user, mustChangePassword: false };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
    if (isNetworkError(err)) {
      return { ok: false, code: AUTH_ONLINE_REQUIRED, message: "Brak połączenia z serwerem. Aplikacja wymaga internetu." };
    }
    return { ok: false, code: AUTH_UNKNOWN_ERROR, message: err instanceof Error ? err.message : String(err) };
  }
}
