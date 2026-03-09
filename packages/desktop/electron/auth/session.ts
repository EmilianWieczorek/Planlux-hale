/**
 * In-memory session store with expiry. Single-window app: one active session.
 * TTL from config.session.ttlHours. No secrets in logs.
 */

import crypto from "crypto";
import { getConfig } from "../config";

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
};

export type Session = {
  userId: string;
  email: string;
  role: string;
  displayName: string | null;
  issuedAt: number;
  expiresAt: number;
  token: string;
  /** Supabase JWT (access_token) when user logged in online; needed for Edge Functions (e.g. create-user). */
  supabaseAccessToken?: string | null;
};

function getTtlMs(): number {
  return getConfig().session.ttlHours * 60 * 60 * 1000;
}

const sessions = new Map<string, Session>();

/** Current session token for this process (single-user). */
let currentToken: string | null = null;

export type CreateSessionOptions = {
  /** Set when user logged in via Supabase (online); used for Edge Function calls (e.g. create-user). */
  supabaseAccessToken?: string | null;
};

export function createSession(user: SessionUser, options?: CreateSessionOptions): Session {
  const now = Date.now();
  const token = crypto.randomBytes(24).toString("base64url");
  const session: Session = {
    userId: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName ?? null,
    issuedAt: now,
    expiresAt: now + getTtlMs(),
    token,
    supabaseAccessToken: options?.supabaseAccessToken ?? null,
  };
  sessions.set(token, session);
  currentToken = token;
  return session;
}

export function getSession(token?: string | null): Session | null {
  const t = token ?? currentToken;
  if (!t) return null;
  return sessions.get(t) ?? null;
}

export function getCurrentSession(): Session | null {
  return getSession(currentToken);
}

export function setCurrentToken(token: string | null): void {
  currentToken = token;
}

/** Update the current session's role and/or displayName in place (e.g. after role repair from Supabase). */
export function updateCurrentSessionUser(updates: { role?: string; displayName?: string | null }): void {
  const t = currentToken;
  if (!t) return;
  const s = sessions.get(t);
  if (!s) return;
  if (updates.role !== undefined) (s as Session).role = updates.role;
  if (updates.displayName !== undefined) (s as Session).displayName = updates.displayName ?? null;
}

export function revokeSession(token?: string | null): void {
  const t = token ?? currentToken;
  if (t) sessions.delete(t);
  if (t === currentToken) currentToken = null;
}

export function isSessionValid(session: Session | null): boolean {
  if (!session) return false;
  return session.expiresAt > Date.now();
}

export function getSessionTtlHours(): number {
  return getConfig().session.ttlHours;
}

/**
 * Returns session user if token is valid and not expired; otherwise throws.
 * Use for requireRole: getSessionForRole(token, allowedRoles) then check role.
 */
export function requireValidSession(token?: string | null): Session {
  const session = getSession(token);
  if (!session) throw new Error("AUTH_SESSION_EXPIRED");
  if (!isSessionValid(session)) {
    revokeSession(session.token);
    throw new Error("AUTH_SESSION_EXPIRED");
  }
  return session;
}

/**
 * Require valid session and role. Returns session user payload.
 */
export function requireRole(sessionToken: string | null | undefined, allowedRoles: string[]): SessionUser {
  const session = requireValidSession(sessionToken);
  const sessionRoleUpper = (session.role ?? "").trim().toUpperCase();
  const allowed = allowedRoles.some((r) => (r ?? "").trim().toUpperCase() === sessionRoleUpper);
  if (!allowed) throw new Error("Forbidden");
  return {
    id: session.userId,
    email: session.email,
    role: session.role,
    displayName: session.displayName,
  };
}
