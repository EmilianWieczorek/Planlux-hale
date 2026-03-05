/**
 * Online-first login with offline fallback. Uses net/online, auth/password, auth/session.
 * Returns normalized { ok, data?, error?: { code, message } } and keeps legacy { user, mustChangePassword } for UI.
 */

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

function normalizeRole(r: string): string {
  const s = (r ?? "").trim().toUpperCase();
  if (s === "ADMIN") return "ADMIN";
  if (s === "SZEF" || s === "BOSS" || s === "MANAGER") return "SZEF";
  return "HANDLOWIEC";
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

  const state = await getOnlineState({
    timeoutMs: deps.onlineTimeoutMs ?? 2000,
    backendUrl: deps.backendUrl,
  });

  const tryOffline = (): LoginResult => {
    const row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(emailNorm) as UserRow | undefined;
    if (!row) return { ok: false, code: AUTH_OFFLINE_USER_NOT_FOUND, message: "Zaloguj się przy połączeniu z internetem (brak danych offline)." };
    if (row.password_unavailable === 1) {
      return { ok: false, code: AUTH_OFFLINE_REQUIRES_ONLINE_LOGIN_ONCE, message: "Zaloguj się raz online, aby aktywować tryb offline." };
    }
    if (!verifyPassword(password, row)) return { ok: false, code: AUTH_INVALID_CREDENTIALS, message: "Nieprawidłowy email lub hasło" };
    if (isLegacyHash(row)) {
      const upgraded = hashPassword(password);
      const hasPua = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
      db.prepare("UPDATE users SET password_hash = ?, password_salt = ?, password_algo_version = ? WHERE id = ?").run(upgraded.hash, upgraded.salt, upgraded.version, row.id);
    }
    const user: SessionUser = {
      id: row.id,
      email: row.email,
      role: normalizeRole(row.role),
      displayName: row.display_name ?? null,
    };
    return {
      ok: true,
      user,
      mustChangePassword: row.must_change_password === 1,
    };
  };

  if (state === "online") {
    try {
      const loginResult = deps.supabaseLogin
        ? await deps.supabaseLogin(emailNorm, password)
        : await deps.backendLogin(deps.backendUrl, emailNorm, password);
      if (loginResult.ok && loginResult.user) {
        const backendUser = loginResult.user;
        const role = normalizeRole(backendUser.role ?? "HANDLOWIEC");
        const displayName = (backendUser.name ?? "").trim() || null;
        const hashed = hashPassword(password);
        const now = new Date().toISOString();
        const hasLastSynced = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "last_synced_at");
        const hasPasswordUnavail = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
        const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(emailNorm) as { id: string } | undefined;
        const backendUserId = (backendUser as { id?: string }).id;
        const userId = backendUserId ?? existing?.id ?? deps.uuid();
        if (existing) {
          if (hasPasswordUnavail) {
            if (hasLastSynced) {
              db.prepare(
                "UPDATE users SET role = ?, display_name = ?, active = 1, password_hash = ?, password_salt = ?, password_algo_version = ?, password_unavailable = 0, last_online_login_at = ?, updated_at = ?, last_synced_at = ? WHERE email = ?"
              ).run(role, displayName, hashed.hash, hashed.salt, hashed.version, now, now, now, emailNorm);
            } else {
              db.prepare(
                "UPDATE users SET role = ?, display_name = ?, active = 1, password_hash = ?, password_salt = ?, password_algo_version = ?, password_unavailable = 0, last_online_login_at = ?, updated_at = ? WHERE email = ?"
              ).run(role, displayName, hashed.hash, hashed.salt, hashed.version, now, now, emailNorm);
            }
          } else if (hasLastSynced) {
            db.prepare(
              "UPDATE users SET role = ?, display_name = ?, active = 1, password_hash = ?, password_salt = ?, password_algo_version = ?, updated_at = ?, last_synced_at = ? WHERE email = ?"
            ).run(role, displayName, hashed.hash, hashed.salt, hashed.version, now, now, emailNorm);
          } else {
            db.prepare(
              "UPDATE users SET role = ?, display_name = ?, active = 1, password_hash = ?, password_salt = ?, password_algo_version = ?, updated_at = ? WHERE email = ?"
            ).run(role, displayName, hashed.hash, hashed.salt, hashed.version, now, emailNorm);
          }
        } else {
          if (hasPasswordUnavail) {
            const vals = hasLastSynced
              ? "?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?, ?"
              : "?, ?, ?, ?, ?, 0, ?, ?, ?, 1, ?, ?";
            const insertSql =
              "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, last_online_login_at, role, display_name, active, created_at, updated_at" +
              (hasLastSynced ? ", last_synced_at) VALUES (" + vals + ")" : ") VALUES (" + vals + ")");
            if (hasLastSynced) {
              db.prepare(insertSql).run(userId, emailNorm, hashed.hash, hashed.salt, hashed.version, now, role, displayName, now, now, now);
            } else {
              db.prepare(insertSql).run(userId, emailNorm, hashed.hash, hashed.salt, hashed.version, now, role, displayName, now, now);
            }
          } else {
            const vals = hasLastSynced ? "?, ?, ?, ?, ?, 1, ?, ?, ?" : "?, ?, ?, ?, ?, 1, ?, ?";
            const insertSql =
              "INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at" +
              (hasLastSynced ? ", last_synced_at) VALUES (" + vals + ")" : ") VALUES (" + vals + ")");
            if (hasLastSynced) {
              db.prepare(insertSql).run(userId, emailNorm, hashed.hash, role, displayName, now, now, now);
            } else {
              db.prepare(insertSql).run(userId, emailNorm, hashed.hash, role, displayName, now, now);
            }
          }
        }
        const user: SessionUser = { id: userId, email: emailNorm, role, displayName };
        const row = db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(userId) as { must_change_password?: number };
        return { ok: true, user, mustChangePassword: row?.must_change_password === 1 };
      }
      const backendError = (loginResult as { error?: string }).error ?? "Nieprawidłowy email lub hasło";
      return { ok: false, code: AUTH_INVALID_CREDENTIALS, message: backendError };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, code: err.code, message: err.message };
      if (isNetworkError(err)) return tryOffline();
      return { ok: false, code: AUTH_BACKEND_ERROR, message: err instanceof Error ? err.message : String(err) };
    }
  }

  if (state === "offline" || state === "unknown") return tryOffline();

  return tryOffline();
}
