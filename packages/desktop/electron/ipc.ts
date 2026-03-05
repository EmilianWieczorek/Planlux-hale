/**
 * IPC handlers – bridge renderer <-> main.
 * Auth: session lives in main; never trust userId from renderer.
 */

import { ipcMain, app, shell, net, dialog } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { hashPassword, verifyPassword, validatePassword, isLegacyHash, LEGACY_SALT } from "./auth/password";
import * as session from "./auth/session";
import { performLogin } from "./auth/login";
import type { GeneratePdfPayload } from "@planlux/shared";
import { generatePdfPipeline, getTestPdfFileName, getE2EPlaceholderPdfBuffer } from "./pdf/generatePdf";
import { generatePdfFromTemplate, mapOfferDataToPayload, type GeneratePdfFromTemplateOptions } from "./pdf/generatePdfFromTemplate";
import { getPdfOutputDir } from "./pdf/generatePdf";
import { getPdfTemplateDir } from "./pdf/pdfPaths";
import { getE2EConfig } from "./e2eEnv";

import { createSendEmailForFlush } from "./smtpSend";
import { sendEmail as sendSmtpEmail } from "./mail";
import { parseRecipients, allowedEmailHistoryStatus } from "./emailService";
import { createFilePdfTemplateConfigStore } from "./pdf/pdfTemplateConfigStore";
import { getPreviewHtmlWithInlinedAssets } from "./pdf/renderTemplate";
import { getNextOfferNumber as getNextOfferNumberLocal } from "./offerCounters";
import { generateTempOfferNumber, finalizeOfferNumber } from "./offers/numbering";
import { wrapIpcHandler } from "./ipc/response";
import { getConfig, getPublicConfig, getBackendUrl } from "./config";
import { AppError, authErrors, dbErrors } from "./errors/AppError";

/** Session: current user in main process. Set on login, cleared on logout. Backed by auth/session for expiry. */
export type SessionUser = { id: string; email: string; role: string; displayName: string | null };
let currentUser: SessionUser | null = null;

export function setSession(user: SessionUser | null): void {
  if (!user) {
    session.revokeSession();
    currentUser = null;
    return;
  }
  session.createSession(user);
  currentUser = user;
}

export function getSession(): SessionUser | null {
  const s = session.getCurrentSession();
  if (!s || !session.isSessionValid(s)) {
    currentUser = null;
    return null;
  }
  currentUser = { id: s.userId, email: s.email, role: s.role, displayName: s.displayName };
  return currentUser;
}

/** Throws AppError if not logged in or session expired. Returns session user. */
function requireAuth(): SessionUser {
  try {
    const s = session.requireValidSession();
    currentUser = { id: s.userId, email: s.email, role: s.role, displayName: s.displayName };
    return currentUser;
  } catch (e) {
    currentUser = null;
    if (e instanceof Error && e.message === "AUTH_SESSION_EXPIRED") throw authErrors.sessionExpired();
    throw new AppError("AUTH_UNAUTHORIZED", "Sesja wygasła. Zaloguj się ponownie.", { expose: true, cause: e });
  }
}

/** Throws AppError if not logged in, session expired, or role not in allowed. Returns session user. */
function requireRole(allowedRoles: string[]): SessionUser {
  const user = requireAuth();
  if (!allowedRoles.includes(user.role)) throw new AppError("AUTH_FORBIDDEN", "Brak uprawnień.", { expose: true });
  return user;
}

/** Placeholder hash for users synced from backend without password (never verifies). Check password_unavailable for offline message. */
function placeholderHash(): string {
  return crypto.scryptSync("__unavailable__", LEGACY_SALT, 64).toString("hex");
}

/** Safe serialization for IPC and logging – never pass raw Error (TLS/socket have circular refs). */
function serializeError(err: unknown): { message: string; code: string | null; reason: string | null; stack: string | null } {
  if (err == null) return { message: "Unknown error", code: null, reason: null, stack: null };
  const e = err as { message?: string; code?: string; reason?: string; stack?: string };
  return {
    message: e?.message ?? String(err),
    code: e?.code ?? null,
    reason: e?.reason ?? null,
    stack: e?.stack ?? null,
  };
}

const ALLOWED_ROLES = ["ADMIN", "SZEF", "HANDLOWIEC"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function normalizeRole(input: string): AllowedRole {
  const r = (input ?? "").trim().toUpperCase();
  if (r === "ADMIN") return "ADMIN";
  if (r === "SZEF" || r === "BOSS" || r === "MANAGER") return "SZEF";
  return "HANDLOWIEC";
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Pierwsza litera imienia handlowca. displayName → pierwsze słowo; fallback: pierwsza litera emaila; ostatecznie X */
function getSalesInitial(user: { displayName?: string; firstName?: string; email?: string } | null | undefined): string {
  const name = (user?.firstName?.trim() || (user?.displayName?.trim().split(/\s+/)[0] ?? "")).trim();
  if (name) {
    const char = name.charAt(0);
    if (/[a-zA-Z]/.test(char)) return char.toUpperCase();
  }
  const emailFirst = (user?.email ?? "").trim().charAt(0);
  if (/[a-zA-Z0-9]/.test(emailFirst)) return emailFirst.toUpperCase();
  return "X";
}

const CHECK_INTERNET_URL = "https://example.com/favicon.ico";
const CHECK_INTERNET_TIMEOUT_MS = 3000;

function checkInternetNet(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), CHECK_INTERNET_TIMEOUT_MS);
    try {
      const request = net.request(CHECK_INTERNET_URL);
      request.on("response", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      request.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
      request.end();
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

/** Minimal DB for email history fetch (testable). */
type EmailHistoryDb = {
  prepare: (sql: string) => { all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };
};

function mapEmailStatusForUi(s: string): string {
  const u = String(s ?? "").toUpperCase();
  if (u === "QUEUED") return "queued";
  if (u === "SENT") return "sent";
  if (u === "FAILED") return "failed";
  return (s ?? "").toLowerCase() || s;
}

/** Zwraca listę e-maili dla oferty (historia + outbox QUEUED/FAILED bez duplikatów po outbox_id). Eksport do testów. */
export function getEmailHistoryForOfferData(
  db: EmailHistoryDb,
  offerId: string,
  logger: { warn: (m: string, e?: unknown) => void }
): Array<{ id: string; fromEmail: string; toEmail: string; subject: string; body: string; status: string; sentAt: string | null; errorMessage: string | null; createdAt: string }> {
  const emails: Array<{ id: string; fromEmail: string; toEmail: string; subject: string; body: string; status: string; sentAt: string | null; errorMessage: string | null; createdAt: string }> = [];
  const seenIds = new Set<string>();
  const outboxIdsInHistory = new Set<string>();

  try {
    const ehInfo = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
    const hasOfferId = ehInfo.some((c) => c.name === "offer_id");
    const hasRelatedOfferId = ehInfo.some((c) => c.name === "related_offer_id");
    const hasFromEmail = ehInfo.some((c) => c.name === "from_email");
    const hasToEmail = ehInfo.some((c) => c.name === "to_email");
    const hasToAddr = ehInfo.some((c) => c.name === "to_addr");
    const hasOutboxId = ehInfo.some((c) => c.name === "outbox_id");
    if (hasFromEmail || hasToEmail || hasToAddr) {
      const whereClause = hasRelatedOfferId && hasOfferId
        ? "(related_offer_id = ? OR offer_id = ?)"
        : hasOfferId
          ? "offer_id = ?"
          : hasRelatedOfferId
            ? "related_offer_id = ?"
            : null;
      if (whereClause) {
        const args = whereClause.includes("OR") ? [offerId, offerId] : [offerId];
        const historyCols = ["id", "from_email", "to_email", "to_addr", "subject", "body", "sent_at", "status", "error_message", "error", "created_at"];
        if (hasOutboxId) historyCols.push("outbox_id");
        const history = db.prepare(
          `SELECT ${historyCols.join(", ")} FROM email_history WHERE ${whereClause} ORDER BY created_at DESC`
        ).all(...args) as Array<Record<string, unknown>>;
        for (const r of history) {
          const id = String(r.id ?? "");
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          if (hasOutboxId && r.outbox_id) outboxIdsInHistory.add(String(r.outbox_id));
          const toDisplay = String(r.to_email ?? r.to_addr ?? "");
          emails.push({
            id,
            fromEmail: String(r.from_email ?? ""),
            toEmail: toDisplay,
            subject: String(r.subject ?? ""),
            body: String(r.body ?? ""),
            status: mapEmailStatusForUi(String(r.status ?? "")),
            sentAt: r.sent_at ? String(r.sent_at) : null,
            errorMessage: (r.error_message ?? r.error) ? String(r.error_message ?? r.error) : null,
            createdAt: String(r.created_at ?? ""),
          });
        }
      }
    }
  } catch (ehErr) {
    logger.warn("[crm] getEmailHistoryForOffer email_history read failed", ehErr);
  }

  try {
    const outboxInfo = db.prepare("PRAGMA table_info(email_outbox)").all() as Array<{ name: string }>;
    const hasRelatedOfferIdOb = outboxInfo.some((c) => c.name === "related_offer_id");
    if (hasRelatedOfferIdOb) {
      const outboxRows = db.prepare(
        "SELECT id, to_addr, subject, html_body, text_body, status, sent_at, last_error, created_at, account_user_id FROM email_outbox WHERE related_offer_id = ? AND status IN ('queued','failed') ORDER BY created_at DESC"
      ).all(offerId) as Array<Record<string, unknown>>;
      for (const r of outboxRows) {
        const outboxId = String(r.id ?? "");
        if (outboxIdsInHistory.has(outboxId)) continue;
        if (seenIds.has(outboxId)) continue;
        seenIds.add(outboxId);
        const senderEmail = r.account_user_id
          ? (db.prepare("SELECT email FROM users WHERE id = ?").get(r.account_user_id) as { email: string } | undefined)?.email ?? ""
          : "";
        const body = (r.html_body ?? r.text_body ?? "") as string;
        emails.push({
          id: outboxId,
          fromEmail: senderEmail,
          toEmail: String(r.to_addr ?? ""),
          subject: String(r.subject ?? ""),
          body: body.replace(/<[^>]+>/g, " ").trim(),
          status: mapEmailStatusForUi(String(r.status ?? "")),
          sentAt: r.sent_at ? String(r.sent_at) : null,
          errorMessage: r.last_error ? String(r.last_error) : null,
          createdAt: String(r.created_at ?? ""),
        });
      }
    }
  } catch (obErr) {
    logger.warn("[crm] getEmailHistoryForOffer email_outbox read failed", obErr);
  }

  emails.sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0));
  return emails;
}

export async function registerIpcHandlers(deps: {
  getDb: () => ReturnType<typeof import("better-sqlite3")>;
  getDbPath?: () => string;
  apiClient: import("@planlux/shared").ApiClient;
  getSupabase?: () => import("@supabase/supabase-js").SupabaseClient;
  config: { appVersion: string; updatesUrl?: string };
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}) {
  const { getDb, getDbPath, config, apiClient, getSupabase, logger } = deps;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrap = (channel: string, handler: (event: unknown, ...args: any[]) => Promise<unknown> | unknown) =>
    wrapIpcHandler(channel, handler as (event: unknown, ...args: unknown[]) => Promise<unknown>, { log: (msg, meta) => logger.error(msg, meta) });

  /** Upsert offer into Supabase public.offers so rpc_finalize_offer_number can find it. No-op if getSupabase missing. */
  async function syncOfferToSupabase(
    offerId: string,
    userId: string,
    opts: { offerNumber?: string; offerNumberStatus?: string; status?: string } = {}
  ): Promise<void> {
    if (!getSupabase) return;
    try {
      const supabase = getSupabase();
      await supabase.from("offers").upsert(
        {
          id: offerId,
          created_by: userId,
          offer_number: opts.offerNumber ?? null,
          offer_number_status: opts.offerNumberStatus ?? "TEMP",
          status: opts.status ?? "DRAFT",
          payload: {},
          totals: {},
        },
        { onConflict: "id" }
      );
    } catch (e) {
      logger.warn("[crm] syncOfferToSupabase failed (offer will use local numbering if RPC not used)", { offerId, error: e });
    }
  }

  /** Sync users from Supabase profiles (or legacy backend). Upsert by email; new users get sentinel password until first online login. */
  async function syncUsersFromBackend(): Promise<{ ok: boolean; syncedCount?: number; error?: string }> {
    const db = getDb();
    const now = new Date().toISOString();
    try {
      let result: { ok: boolean; users?: Array<{ email: string; role?: string; name?: string; active?: boolean }>; error?: string };
      if (getSupabase) {
        const { listProfilesFromSupabase } = await import("./auth/authSupabase");
        result = await listProfilesFromSupabase(getSupabase());
      } else {
        const appConfig = getConfig();
        const { listUsersFromBackend } = await import("./authBackend");
        result = await listUsersFromBackend(getBackendUrl(appConfig));
      }
      if (!result.ok || !Array.isArray(result.users)) {
        return { ok: false, error: result.error ?? "Błąd synchronizacji" };
      }
      let synced = 0;
      const hasLastSynced = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "last_synced_at");
      for (const u of result.users) {
        const email = (u.email ?? "").trim().toLowerCase();
        if (!email) continue;
        const role = normalizeRole(u.role ?? "HANDLOWIEC");
        const displayName = (u.name ?? "").trim() || null;
        const active = u.active !== false ? 1 : 0;
        const hasPasswordUnavail = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
        const existing = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(email) as
          | { id: string; password_hash: string }
          | undefined;
        if (existing) {
          if (hasLastSynced) {
            db.prepare(
              "UPDATE users SET role = ?, display_name = ?, active = ?, updated_at = ?, last_synced_at = ? WHERE email = ?"
            ).run(role, displayName, active, now, now, email);
          } else {
            db.prepare("UPDATE users SET role = ?, display_name = ?, active = ?, updated_at = ? WHERE email = ?").run(role, displayName, active, now, email);
          }
        } else {
          const ph = placeholderHash();
          if (hasPasswordUnavail) {
            const insertCols = "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, role, display_name, active, created_at, updated_at" +
              (hasLastSynced ? ", last_synced_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)" : ") VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)");
            if (hasLastSynced) {
              db.prepare(insertCols).run(uuid(), email, ph, null, 0, role, displayName, active, now, now, now);
            } else {
              db.prepare(insertCols).run(uuid(), email, ph, null, 0, role, displayName, active, now, now);
            }
          } else {
            const insertCols = "INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at" +
              (hasLastSynced ? ", last_synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)" : ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
            if (hasLastSynced) {
              db.prepare(insertCols).run(uuid(), email, ph, role, displayName, active, now, now, now);
            } else {
              db.prepare(insertCols).run(uuid(), email, ph, role, displayName, active, now, now);
            }
          }
        }
        synced++;
      }
      return { ok: true, syncedCount: synced };
    } catch (e) {
      logger.warn("[auth] syncUsersFromBackend failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  ipcMain.handle("planlux:syncUsers", wrap("planlux:syncUsers", async () => {
    const result = await syncUsersFromBackend();
    if (!result.ok) throw new AppError("SYNC_USERS_ERROR", result.error ?? "Błąd synchronizacji użytkowników.", { expose: true });
    return result as { ok: true; syncedCount?: number };
  }));

  const handleLogin = async (_event: unknown, email: string, password: string) => {
    try {
      if (typeof email !== "string" || typeof password !== "string") {
        return { ok: false, error: "Invalid input", errorCode: "AUTH_UNKNOWN_ERROR" };
      }
      const db = getDb();
      const emailNorm = email.trim().toLowerCase();

      // E2E only: skip backend, use local DB (seeded users).
      if (process.env.PLANLUX_E2E === "1") {
        const row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(emailNorm) as
          | { id: string; email: string; role: string; password_hash: string; password_salt?: string | null; password_algo_version?: number | null; password_unavailable?: number | null; display_name: string; must_change_password?: number }
          | undefined;
        if (!row) {
          return { ok: false, error: "Zaloguj się przy połączeniu z internetem (brak danych offline).", errorCode: "AUTH_OFFLINE_USER_NOT_FOUND" };
        }
        if (row.password_unavailable === 1) {
          return { ok: false, error: "Zaloguj się raz online, aby aktywować tryb offline.", errorCode: "AUTH_OFFLINE_REQUIRES_ONLINE_LOGIN_ONCE" };
        }
        if (!verifyPassword(password, row)) {
          return { ok: false, error: "Nieprawidłowy email lub hasło", errorCode: "AUTH_INVALID_CREDENTIALS" };
        }
        const adminEmail = (getConfig().seed?.adminInitialEmail ?? "").trim().toLowerCase();
        const role = adminEmail && row.email.trim().toLowerCase() === adminEmail ? "ADMIN" : normalizeRole(row.role);
        if (adminEmail && row.email.trim().toLowerCase() === adminEmail && role === "ADMIN") {
          db.prepare("UPDATE users SET role = 'ADMIN' WHERE id = ?").run(row.id);
        }
        const user: SessionUser = {
          id: row.id,
          email: row.email,
          role,
          displayName: row.display_name ?? null,
        };
        const sess = session.createSession(user);
        currentUser = user;
        db.prepare("INSERT INTO sessions (id, user_id, device_type, app_version) VALUES (?, ?, 'desktop', ?)").run(uuid(), row.id, config.appVersion);
        return {
          ok: true,
          user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
          mustChangePassword: row.must_change_password === 1,
          token: sess.token,
        };
      }

      const appConfig = getConfig();
      const { loginViaBackend } = await import("./authBackend");
      const { loginViaSupabase } = await import("./auth/authSupabase");
      const result = await performLogin(emailNorm, password, {
        getDb: () => getDb() as import("./auth/login").DbLike,
        backendUrl: getBackendUrl(appConfig),
        backendLogin: loginViaBackend,
        supabaseLogin: getSupabase ? (em, pw) => loginViaSupabase(getSupabase!(), em, pw) : undefined,
        onlineTimeoutMs: appConfig.backend.healthTimeoutMs,
        uuid,
      });

      if (result.ok) {
        const adminEmail = (getConfig().seed?.adminInitialEmail ?? "").trim().toLowerCase();
        if (adminEmail && result.user.email.trim().toLowerCase() === adminEmail && result.user.role !== "ADMIN") {
          db.prepare("UPDATE users SET role = 'ADMIN' WHERE LOWER(TRIM(email)) = ?").run(adminEmail);
          result.user = { ...result.user, role: "ADMIN" };
        }
        const sess = session.createSession(result.user);
        currentUser = result.user;
        db.prepare("INSERT INTO sessions (id, user_id, device_type, app_version) VALUES (?, ?, 'desktop', ?)").run(uuid(), result.user.id, config.appVersion);
        return {
          ok: true,
          user: { id: result.user.id, email: result.user.email, role: result.user.role, displayName: result.user.displayName },
          mustChangePassword: result.mustChangePassword,
          token: sess.token,
        };
      }
      return { ok: false, error: result.message, errorCode: result.code };

    } catch (e) {
      logger.error("login failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg, errorCode: "AUTH_UNKNOWN_ERROR" };
    }
  };

  ipcMain.handle("planlux:login", wrap("planlux:login", (_, email: string, password: string) => handleLogin(_, email, password)));
  ipcMain.handle("login", (_, payloadOrEmail: unknown, passwordMaybe?: string) => {
    const email = typeof payloadOrEmail === "object" && payloadOrEmail != null && "email" in payloadOrEmail
      ? String((payloadOrEmail as { email: string }).email ?? "")
      : String(payloadOrEmail ?? "");
    const password = typeof passwordMaybe === "string" ? passwordMaybe
      : typeof payloadOrEmail === "object" && payloadOrEmail != null && "password" in payloadOrEmail
        ? String((payloadOrEmail as { password: string }).password ?? "")
        : "";
    return handleLogin(_, email, password);
  });

  ipcMain.handle("planlux:changePassword", wrap("planlux:changePassword", async (_, newPassword: string) => {
    const user = requireAuth();
    const validation = validatePassword(newPassword);
    if (!validation.ok) throw new AppError("VALIDATION_ERROR", validation.reason, { expose: true });
    const db = getDb();
    try {
      const hashed = hashPassword(newPassword);
      const hasSalt = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_salt");
      if (hasSalt) {
        db.prepare(
          "UPDATE users SET password_hash = ?, password_salt = ?, password_algo_version = ?, must_change_password = 0, password_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(hashed.hash, hashed.salt, hashed.version, user.id);
      } else {
        db.prepare(
          "UPDATE users SET password_hash = ?, must_change_password = 0, password_set_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).run(hashed.hash, user.id);
      }
      logger.info("[auth] changePassword", { userId: user.id });
      return { ok: true };
    } catch (e) {
      logger.error("[auth] changePassword failed", e);
      if (e instanceof Error && (e.message.includes("SQLITE_CONSTRAINT") || e.message.includes("constraint"))) throw dbErrors.constraint();
      throw AppError.fromUnknown(e);
    }
  }));

  ipcMain.handle("planlux:logout", wrap("planlux:logout", async () => {
    try {
      session.revokeSession();
      currentUser = null;
      const db = getDb();
      const row = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      return { ok: true };
    } catch (e) {
      logger.error("logout failed", e);
      session.revokeSession();
      currentUser = null;
      return { ok: false, error: String(e) };
    }
  }));

  ipcMain.handle("planlux:endSession", wrap("planlux:endSession", async () => {
    try {
      session.revokeSession();
      currentUser = null;
      const db = getDb();
      const row = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      return { ok: true };
    } catch (e) {
      logger.error("endSession failed", e);
      throw AppError.fromUnknown(e);
    }
  }));

  ipcMain.handle("planlux:session", wrap("planlux:session", () => {
    const s = session.getCurrentSession();
    if (!s || !session.isSessionValid(s)) return { ok: false, session: null };
    return {
      ok: true,
      session: { userId: s.userId, email: s.email, role: s.role, displayName: s.displayName, expiresAt: s.expiresAt },
    };
  }));

  ipcMain.handle("planlux:getPricingCache", async () => {
    try {
      const { getCachedBase } = await import("../src/infra/db");
      const base = getCachedBase(getDb());
      if (!base) return { ok: true, data: null };
      return { ok: true, data: base };
    } catch (e) {
      logger.error("getPricingCache failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getConfigSyncStatus", async () => {
    try {
      const { getConfigSyncStatus } = await import("../src/services/configSync");
      return getConfigSyncStatus();
    } catch (e) {
      logger.error("getConfigSyncStatus failed", e);
      return { status: "error" as const, error: String(e) };
    }
  });

  ipcMain.handle(
    "planlux:testSupabaseConnection",
    wrap("planlux:testSupabaseConnection", async () => {
      const { testSupabaseConnection } = await import("./supabase/testConnection");
      return testSupabaseConnection();
    })
  );

  /** Test E2E: create offer w Supabase, finalize RPC, upload PDF, invoke send_offer_email (akceptuje CONFIG_SMTP_MISSING). */
  ipcMain.handle("planlux:testEndToEnd", wrap("planlux:testEndToEnd", async () => {
    if (!getSupabase) return { ok: false, error: "Supabase not configured" };
    const user = requireAuth();
    const supabase = getSupabase();
    const steps: string[] = [];
    try {
      const { data: conn } = await supabase.from("profiles").select("id").limit(1).maybeSingle();
      if (conn == null) return { ok: false, error: "Connection failed", steps: ["profiles select"] };
      steps.push("profiles ok");

      const { data: offer, error: insErr } = await supabase
        .from("offers")
        .insert({
          created_by: user.id,
          offer_number_status: "TEMP",
          status: "DRAFT",
          payload: { testE2E: true, at: new Date().toISOString() },
          totals: {},
        })
        .select("id")
        .single();
      if (insErr || !offer?.id) return { ok: false, error: insErr?.message ?? "Insert offer failed", steps };
      steps.push("offer created");
      const offerId = (offer as { id: string }).id;

      const { data: rpcData, error: rpcErr } = await supabase.rpc("rpc_finalize_offer_number", { p_offer_id: offerId });
      if (rpcErr || !(rpcData as { ok?: boolean })?.ok) {
        return { ok: false, error: (rpcData as { error?: string })?.error ?? rpcErr?.message ?? "RPC failed", steps };
      }
      steps.push("number finalized");

      const path = `${user.id}/${offerId}/test-e2e.pdf`;
      const buf = new Uint8Array(37);
      buf.set([0x25, 0x50, 0x44, 0x46], 0);
      const { error: upErr } = await supabase.storage.from("offer-pdfs").upload(path, buf, { contentType: "application/pdf", upsert: true });
      if (upErr) return { ok: false, error: upErr.message, steps };
      steps.push("pdf uploaded");

      const { data: fnData, error: fnErr } = await supabase.functions.invoke("send_offer_email", {
        body: { offer_id: offerId, to_email: "test@example.com", subject: "E2E test", attachPdf: false },
      });
      if (fnErr) return { ok: false, error: fnErr.message, steps };
      const body = fnData as { ok?: boolean; error?: string };
      if (body?.ok) steps.push("email sent"); else if (body?.error?.includes("CONFIG_SMTP_MISSING")) steps.push("email skipped (no SMTP)"); else return { ok: false, error: body?.error ?? "send_offer_email failed", steps };

      return { ok: true, steps };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), steps };
    }
  }));

  ipcMain.handle("planlux:syncPricing", wrap("planlux:syncPricing", async () => {
    try {
      const { syncBaseIfNeeded } = await import("../src/infra/baseSync");
      const { getLocalVersion, saveBase } = await import("../src/infra/db");
      const appConfig = getConfig();
      const db = getDb();
      const result = await syncBaseIfNeeded(
        apiClient,
        getBackendUrl(appConfig),
        globalThis.fetch.bind(globalThis),
        () => getLocalVersion(db),
        (base) => saveBase(db, base),
        logger
      );
      return {
        ok: result.status !== "error",
        status: result.status,
        version: result.version,
        lastUpdated: result.lastUpdated,
        error: result.error,
      };
    } catch (e) {
      logger.error("syncPricing failed", e);
      throw AppError.fromUnknown(e);
    }
  }));

  ipcMain.handle("base:sync", wrap("base:sync", async () => {
    try {
      const { syncBaseIfNeeded } = await import("../src/infra/baseSync");
      const { getLocalVersion, saveBase, getCachedBase } = await import("../src/infra/db");
      const { createOutboxStorage } = await import("../src/db/outboxStorage");
      const { flushOutbox } = await import("@planlux/shared");
      const appConfig = getConfig();
      const db = getDb();
      const result = await syncBaseIfNeeded(
        apiClient,
        getBackendUrl(appConfig),
        globalThis.fetch.bind(globalThis),
        () => getLocalVersion(db),
        (base) => saveBase(db, base),
        logger
      );
      const base = getCachedBase(db);
      if (result.status === "synced" || result.status === "unchanged" || result.status === "offline") {
        flushOutbox({
          api: apiClient,
          storage: createOutboxStorage(db as Parameters<typeof createOutboxStorage>[0]),
          isOnline: () => true,
          sendEmail: createSendEmailForFlush(getDb),
        }).then((r) => {
          if (r.processed > 0 || r.failed > 0) logger.info("[outbox] flush after sync", r);
        }).catch((e) => logger.error("[outbox] flush after sync failed", e));
      }
      return {
        ok: result.status !== "error",
        status: result.status,
        version: result.version,
        lastUpdated: result.lastUpdated ?? base?.lastUpdated,
        data: base,
        error: result.error,
      };
    } catch (e) {
      logger.error("base:sync failed", e);
      throw AppError.fromUnknown(e);
    }
  }));

  ipcMain.handle("planlux:calculatePrice", async (_, input: unknown) => {
    try {
      const { calculatePrice } = await import("@planlux/shared");
      const db = getDb();
      const row = db.prepare(
        "SELECT cennik_json, dodatki_json, standard_json FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1"
      ).get() as { cennik_json: string; dodatki_json: string; standard_json: string } | undefined;
      if (!row) return { ok: false, error: "Brak bazy cennika. Połącz się z internetem i uruchom synchronizację." };
      const data = {
        cennik: JSON.parse(row.cennik_json),
        dodatki: JSON.parse(row.dodatki_json),
        standard: JSON.parse(row.standard_json),
      };
      const inp = input as {
        variantHali: string;
        widthM: number;
        lengthM: number;
        heightM?: number;
        selectedAdditions: Array<{ nazwa: string; ilosc: number }>;
        standardSnapshot?: Array<{ element: string; pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA" }>;
        rainGuttersAuto?: boolean;
        gates?: Array<{ width: number; height: number; quantity: number }>;
        heightSurchargeAuto?: boolean;
        manualSurcharges?: Array<{ description: string; amount: number }>;
      };
      const areaM2 = inp.widthM * inp.lengthM;
      const perimeterMb = 2 * (inp.widthM + inp.lengthM);
      const result = calculatePrice(data, {
        ...inp,
        areaM2,
        perimeterMb,
      });
      return { ok: true, result };
    } catch (e) {
      logger.error("calculatePrice failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:seedAdmin", wrap("planlux:seedAdmin", async () => {
    try {
      const db = getDb();
      const anyAdmin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND active = 1 LIMIT 1").get();
      if (anyAdmin) return { ok: true, message: "Admin already exists" };
      const seedCfg = getConfig().seed;
      const initialPassword = seedCfg.adminInitialPassword ?? crypto.randomBytes(12).toString("base64url").slice(0, 16);
      const validation = validatePassword(initialPassword);
      const isProd = getConfig().mode === "production" && !process.env.VITE_DEV_SERVER_URL;
      if (!validation.ok && isProd) throw new AppError("CONFIG_SEED_PASSWORD", "W produkcji ustaw ADMIN_INITIAL_PASSWORD (min. 8 znaków, litera + cyfra).", { expose: true });
      if (!validation.ok) {
        const fallback = "Admin1" + Date.now().toString(36).slice(-4);
        const v2 = validatePassword(fallback);
        if (!v2.ok) throw new AppError("VALIDATION_ERROR", validation.reason, { expose: true });
      }
      const passwordToUse = validation.ok ? initialPassword : "Admin1" + Date.now().toString(36).slice(-4);
      const hashed = hashPassword(passwordToUse);
      const id = uuid();
      const hasPasswordUnavail = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
      const adminEmail = seedCfg.adminInitialEmail;
      if (hasPasswordUnavail) {
        db.prepare(
          "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, role, active, display_name) VALUES (?, ?, ?, ?, ?, 0, 'ADMIN', 1, 'Admin')"
        ).run(id, adminEmail, hashed.hash, hashed.salt, hashed.version);
      } else {
        db.prepare(
          "INSERT INTO users (id, email, password_hash, role, active, display_name) VALUES (?, ?, ?, 'ADMIN', 1, 'Admin')"
        ).run(id, adminEmail, hashed.hash);
      }
      logger.info("Seeded admin user (show initial password once)", { email: adminEmail });
      return { ok: true, initialPassword: passwordToUse };
    } catch (e) {
      logger.error("seedAdmin failed", e);
      throw AppError.fromUnknown(e);
    }
  }));

  /** Dodaje heartbeat do outbox i zapisuje lokalnie w activity (dla panelu admina). */
  ipcMain.handle("planlux:enqueueHeartbeat", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(user.id) as { email: string } | undefined;
      if (!userRow) return { ok: false, error: "Użytkownik nie znaleziony" };
      const { generateOutboxId } = await import("@planlux/shared");
      const config = (await import("../src/config")).config;
      const payload = {
        id: uuid(),
        userId: user.id,
        userEmail: userRow.email,
        deviceType: "desktop" as const,
        appVersion: config.appVersion ?? "1.0.0",
        occurredAt: new Date().toISOString(),
      };
      const outboxId = generateOutboxId();
      db.prepare("INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'HEARTBEAT', ?, 0, 5)").run(outboxId, JSON.stringify(payload));
      const activityTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").all() as Array<{ name: string }>;
      if (activityTables.length > 0) {
        db.prepare("INSERT INTO activity (id, user_id, device_type, app_version, online, occurred_at, synced) VALUES (?, ?, ?, ?, 1, ?, 0)").run(
          uuid(),
          user.id,
          "desktop",
          config.appVersion ?? "1.0.0",
          payload.occurredAt
        );
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("enqueueHeartbeat failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getActivity", async (_, options?: { all?: boolean }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, data: [] };
      const showAll = options?.all === true && (user.role === "ADMIN" || user.role === "SZEF");
      const rows = showAll
        ? db.prepare(
            `SELECT a.id, a.user_id, a.device_type, a.app_version, a.occurred_at, u.display_name as user_display_name, u.email as user_email
             FROM activity a LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.occurred_at DESC LIMIT 200`
          ).all()
        : db.prepare("SELECT * FROM activity WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100").all(user.id);
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, data: [] };
      }
      logger.error("getActivity failed", e);
      return { ok: false, error: String(e), data: [] };
    }
  });

  ipcMain.handle("planlux:getUsers", async () => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const rows = db.prepare("SELECT id, email, role, display_name, active, created_at FROM users ORDER BY email").all() as Array<{
        id: string;
        email: string;
        role: string;
        display_name: string;
        active: number;
        created_at: string;
      }>;
      return {
        ok: true,
        users: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: normalizeRole(r.role),
          displayName: r.display_name ?? "",
          active: Boolean(r.active),
          createdAt: r.created_at ?? "",
        })),
      };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, users: [] };
      }
      logger.error("getUsers failed", e);
      return { ok: false, error: String(e), users: [] };
    }
  });

  /** Admin: utwórz użytkownika w Supabase (Edge Function create-user) lub legacy backend; potem sync + zapisz hasło lokalnie. */
  ipcMain.handle("planlux:createUser", async (_, payload: { email: string; password: string; displayName?: string; role?: string }) => {
    try {
      requireRole(["ADMIN"]);
      const email = (payload.email ?? "").trim().toLowerCase();
      if (!email) return { ok: false, error: "Email jest wymagany" };
      const tempPassword = payload.password ?? "";
      const validation = validatePassword(tempPassword);
      if (!validation.ok) return { ok: false, error: validation.reason };
      const role = normalizeRole(payload.role ?? "HANDLOWIEC");
      const displayName = (payload.displayName ?? "").trim() || undefined;

      if (getSupabase) {
        const { data, error } = await getSupabase().functions.invoke("create-user", {
          body: { email, password: tempPassword, displayName, role },
        });
        if (error) {
          const msg = (data as { error?: string })?.error ?? error.message ?? "Błąd tworzenia użytkownika. Użyj Supabase Dashboard → Authentication → Users lub wdróż Edge Function create-user.";
          return { ok: false, error: msg };
        }
        if ((data as { ok?: boolean })?.ok !== true) {
          return { ok: false, error: (data as { error?: string })?.error ?? "Błąd tworzenia użytkownika" };
        }
      } else {
        const appConfig = getConfig();
        const { upsertUserViaBackend } = await import("./authBackend");
        const upsertResult = await upsertUserViaBackend(getBackendUrl(appConfig), {
          email,
          name: displayName ?? undefined,
          role,
          tempPassword,
          active: 1,
        });
        if (!upsertResult.ok) {
          return { ok: false, error: upsertResult.error ?? "Błąd zapisu użytkownika w systemie" };
        }
      }
      await syncUsersFromBackend();
      const db = getDb();
      const hashed = hashPassword(tempPassword);
      const now = new Date().toISOString();
      const hasLastSynced = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "last_synced_at");
      const hasPasswordUnavail = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
      const creatorId = currentUser?.id ?? null;
      if (existing) {
        if (hasPasswordUnavail) {
          db.prepare(
            "UPDATE users SET password_hash = ?, password_salt = ?, password_algo_version = ?, password_unavailable = 0, must_change_password = 1, password_set_at = NULL, updated_at = ? WHERE email = ?"
          ).run(hashed.hash, hashed.salt, hashed.version, now, email);
        } else {
          db.prepare(
            "UPDATE users SET password_hash = ?, must_change_password = 1, password_set_at = NULL, updated_at = ? WHERE email = ?"
          ).run(hashed.hash, now, email);
        }
        logger.info("[admin] createUser (backend + local password)", { email, role });
        return { ok: true, id: existing.id, temporaryPassword: tempPassword };
      }
      const id = uuid();
      if (hasPasswordUnavail) {
        const createUserInsertSql = "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, role, display_name, active, must_change_password, created_by_user_id, created_at, updated_at" +
          (hasLastSynced ? ", last_synced_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 1, ?, ?, ?, ?)" : ") VALUES (?, ?, ?, ?, ?, 0, ?, ?, 1, 1, ?, ?, ?)");
        if (hasLastSynced) {
          db.prepare(createUserInsertSql).run(id, email, hashed.hash, hashed.salt, hashed.version, role, displayName ?? null, creatorId, now, now, now);
        } else {
          db.prepare(createUserInsertSql).run(id, email, hashed.hash, hashed.salt, hashed.version, role, displayName ?? null, creatorId, now, now);
        }
      } else {
        const createUserInsertSql = "INSERT INTO users (id, email, password_hash, role, display_name, active, must_change_password, created_by_user_id, created_at, updated_at" +
          (hasLastSynced ? ", last_synced_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)" : ") VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)");
        if (hasLastSynced) {
          db.prepare(createUserInsertSql).run(id, email, hashed.hash, role, displayName ?? null, creatorId, now, now, now);
        } else {
          db.prepare(createUserInsertSql).run(id, email, hashed.hash, role, displayName ?? null, creatorId, now, now);
        }
      }
      logger.info("[admin] createUser (backend + local insert)", { email, role });
      return { ok: true, id, temporaryPassword: tempPassword };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] createUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** DEV ONLY: bootstrap user from legacy app_users into Supabase Auth + profiles via Edge Function create-user. */
  ipcMain.handle(
    "planlux:authBootstrapFromAppUsers",
    async (
      _,
      payload: {
        email: string;
        password: string;
      }
    ) => {
      const appConfig = getConfig();
      if (appConfig.mode !== "dev") {
        return { ok: false, error: "Bootstrap użytkowników z app_users jest dostępny tylko w trybie dev." };
      }
      try {
        requireRole(["ADMIN"]);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Brak uprawnień ADMIN" };
      }
      if (!getSupabase) return { ok: false, error: "Supabase not configured" };
      const email = (payload.email ?? "").trim().toLowerCase();
      const password = payload.password ?? "";
      if (!email) return { ok: false, error: "Email jest wymagany" };
      if (!password) return { ok: false, error: "Hasło jest wymagane" };

      const { bootstrapUserFromAppUsers } = await import("./auth/authSupabase");
      const result = await bootstrapUserFromAppUsers(getSupabase(), email, password);
      return result;
    }
  );

  /** Admin: aktualizuj użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:updateUser", async (_, targetUserId: string, payload: { email?: string; displayName?: string; role?: string; password?: string }) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
      if (!target) return { ok: false, error: "Użytkownik nie znaleziony" };
      const updates: string[] = [];
      const values: unknown[] = [];
      if (payload.email !== undefined) {
        const email = payload.email.trim().toLowerCase();
        if (!email) return { ok: false, error: "Email nie może być pusty" };
        const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, targetUserId);
        if (existing) return { ok: false, error: "Inny użytkownik ma ten adres email" };
        updates.push("email = ?");
        values.push(email);
      }
      if (payload.displayName !== undefined) {
        updates.push("display_name = ?");
        values.push((payload.displayName ?? "").trim() || null);
      }
      if (payload.role !== undefined) {
        const role = normalizeRole(payload.role);
        updates.push("role = ?");
        values.push(role);
      }
      if (payload.password !== undefined && payload.password.length > 0) {
        const validation = validatePassword(payload.password);
        if (!validation.ok) return { ok: false, error: validation.reason };
        const hashed = hashPassword(payload.password);
        updates.push("password_hash = ?");
        values.push(hashed.hash);
        const hasSalt = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_salt");
        if (hasSalt) {
          updates.push("password_salt = ?");
          values.push(hashed.salt);
          updates.push("password_algo_version = ?");
          values.push(hashed.version);
        }
      }
      if (updates.length === 0) return { ok: true };
      updates.push("updated_at = datetime('now')");
      values.push(targetUserId);
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      logger.info("[admin] updateUser", { targetUserId });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] updateUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Admin: wyłącz/włącz użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:disableUser", async (_, targetUserId: string, active: boolean) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
      if (!target) return { ok: false, error: "Użytkownik nie znaleziony" };
      db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, targetUserId);
      logger.info("[admin] disableUser", { targetUserId, active });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] disableUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:getOffers", wrap("planlux:getOffers", async () => {
    const user = requireAuth();
    const db = getDb();
    const seeAll = user.role === "ADMIN" || user.role === "SZEF";
    const rows = seeAll
      ? db.prepare("SELECT * FROM offers ORDER BY created_at DESC LIMIT 200").all()
      : db.prepare("SELECT * FROM offers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(user.id);
    return { ok: true, data: rows };
  }));

  ipcMain.handle("planlux:saveOffer", wrap("planlux:saveOffer", async (_, offer: unknown) => {
    try {
      const db = getDb();
      const o = offer as {
        id: string;
        userId: string;
        clientName: string;
        clientEmail?: string;
        clientPhone?: string;
        widthM: number;
        lengthM: number;
        heightM?: number;
        areaM2: number;
        variantHali: string;
        variantNazwa?: string;
        totalPln: number;
        clientJson?: string;
        hallJson?: string;
        pricingJson?: string;
      };
      db.prepare(
        `INSERT OR REPLACE INTO offers (id, user_id, client_name, client_email, client_phone, width_m, length_m, height_m, area_m2, variant_hali, variant_nazwa, total_pln, base_row_json, additions_json, standard_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(
        o.id,
        o.userId,
        o.clientName,
        o.clientEmail ?? null,
        o.clientPhone ?? null,
        o.widthM,
        o.lengthM,
        o.heightM ?? null,
        o.areaM2,
        o.variantHali,
        o.variantNazwa ?? null,
        o.totalPln,
        o.pricingJson ?? "{}",
        "[]",
        "[]"
      );
      return { ok: true };
    } catch (e) {
      logger.error("saveOffer failed", e);
      if (e instanceof Error && (e.message.includes("SQLITE_CONSTRAINT") || e.message.includes("constraint"))) throw dbErrors.constraint();
      throw AppError.fromUnknown(e);
    }
  }));

  const PDF_HANDLER_TIMEOUT_MS = 20_000;
  type PdfHandlerResult = { ok: true; pdfId: string; filePath: string; fileName: string } | { ok: false; error: string; details?: string; stage?: string };

  async function handlePdfGenerate(
    offerData: unknown,
    templateConfig?: unknown,
    options?: GeneratePdfFromTemplateOptions | null,
    pdfOverrides?: import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null
  ): Promise<PdfHandlerResult> {
    const { insertPdf } = await import("../src/infra/db");
    const p = offerData as import("@planlux/shared").GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      return { ok: false, error: "Nieprawidłowe dane do generowania PDF (wymagane: offer, pricing, offerNumber)." };
    }
    const desktopRootFromIpc = path.join(__dirname, "..", "..");
    if (fs.existsSync(path.join(desktopRootFromIpc, ".e2e-run-dir"))) {
      try {
        fs.appendFileSync(path.join(desktopRootFromIpc, ".e2e-handler-entered"), `[${new Date().toISOString()}] handlePdfGenerate\n`);
      } catch {
        // ignore
      }
    }
    const userDataPath = app.getPath("userData");
    const isE2EByPath = path.basename(userDataPath).startsWith("planlux-e2e-");
    const e2eDirFromEnv = process.env.PLANLUX_E2E === "1" && process.env.PLANLUX_E2E_DIR
      ? (path.isAbsolute(process.env.PLANLUX_E2E_DIR) ? process.env.PLANLUX_E2E_DIR : path.resolve(process.cwd(), process.env.PLANLUX_E2E_DIR))
      : null;
    /** File-based E2E marker (test writes before launch) when env is not visible in child process. */
    let e2eDirFromFile: string | null = null;
    const markerCandidates = [
      path.join(__dirname, "..", "..", ".e2e-run-dir"),
      path.join(process.cwd(), ".e2e-run-dir"),
      path.join(app.getAppPath(), ".e2e-run-dir"),
    ];
    for (const markerPath of markerCandidates) {
      try {
        if (fs.existsSync(markerPath)) {
          const content = fs.readFileSync(markerPath, "utf8").trim();
          if (path.isAbsolute(content)) e2eDirFromFile = content;
          else if (content) e2eDirFromFile = path.resolve(path.dirname(markerPath), content);
          if (e2eDirFromFile) break;
        }
      } catch {
        // ignore
      }
    }
    const isE2E = isE2EByPath || e2eDirFromEnv != null || e2eDirFromFile != null;
    const e2eOutputDir = isE2EByPath ? path.join(userDataPath, "pdfs") : (e2eDirFromEnv ? path.join(e2eDirFromEnv, "pdfs") : (e2eDirFromFile ? path.join(e2eDirFromFile, "pdfs") : null));
    const e2eBaseForLog = e2eDirFromFile ?? e2eDirFromEnv ?? (isE2EByPath ? userDataPath : null);
    if (e2eBaseForLog) {
      try {
        const logDir = path.join(e2eBaseForLog, "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(path.join(logDir, "pdf-handler.log"), `[${new Date().toISOString()}] entered isE2E=${isE2E} e2eOutputDir=${e2eOutputDir ?? ""}\n`);
      } catch {
        // ignore
      }
    }
    if (isE2E || process.env.PLANLUX_LOG_LEVEL === "debug") {
      logger.info("[E2E/pdf] handlePdfGenerate start", { isE2EByPath, isE2E, userDataPath, e2eDirFromEnv: e2eDirFromEnv ?? undefined, e2eDirFromFile: e2eDirFromFile ?? undefined, client: p.offer.clientName });
    }
    logger.info("[pdf] start", { client: p.offer.clientName });
    const now = new Date();

    let result: { ok: true; filePath: string; fileName: string } | { ok: false; error: string; details?: string };

    if (isE2E && e2eOutputDir) {
      try {
        const outputDir = e2eOutputDir;
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const fileName = getTestPdfFileName();
        const filePath = path.join(outputDir, fileName);
        fs.writeFileSync(filePath, getE2EPlaceholderPdfBuffer());
        result = { ok: true, filePath, fileName };
        logger.info("[E2E/pdf] placeholder PDF written", { filePath, size: getE2EPlaceholderPdfBuffer().length });
      } catch (e2eErr) {
        const msg = e2eErr instanceof Error ? e2eErr.message : String(e2eErr);
        logger.error("[E2E/pdf] placeholder write failed", e2eErr);
        return { ok: false, error: msg, details: e2eErr instanceof Error ? e2eErr.stack : undefined };
      }
    } else {
      const templateResult = await generatePdfFromTemplate(
      {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      },
      logger,
      (templateConfig as Partial<import("@planlux/shared").PdfTemplateConfig> | null | undefined) ?? undefined,
      options ?? undefined,
      (pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined) ?? undefined
    );

      if (templateResult.ok) {
        result = templateResult;
      } else {
        logger.error("[pdf] Planlux template failed – brak fallbacku, używamy tylko naszego layoutu", templateResult.error);
        result = { ok: false, error: templateResult.error ?? "Błąd generowania PDF z szablonu Planlux" };
      }
    }

    if (!result.ok) {
      return { ok: false, error: result.error, details: result.details, stage: (result as { stage?: string }).stage };
    }

    const pdfId = uuid();
    const offerId = uuid();
    const userId = p.userId ?? "";
    const nowIso = now.toISOString();

    // Parse: companyName/personName (nowe) lub clientName (legacy) → clientFirstName, clientLastName, companyName
    const companyName = (p.offer.companyName ?? "").trim();
    const personName = (p.offer.personName ?? "").trim();
    const clientAddress = (p.offer.clientAddress ?? "").trim();
    const clientName = personName || companyName || p.offer.clientName?.trim() || "Klient";
    const isCompany = companyName ? true : /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
    let clientFirstName = "";
    let clientLastName = "";
    let resolvedCompanyName = companyName;
    if (!resolvedCompanyName && isCompany) resolvedCompanyName = clientName;
    if (!personName && !companyName) {
      const parts = clientName.split(/\s+/).filter(Boolean);
      clientFirstName = parts[0] ?? "";
      clientLastName = parts.slice(1).join(" ") ?? "";
    } else if (personName) {
      const parts = personName.split(/\s+/).filter(Boolean);
      clientFirstName = parts[0] ?? "";
      clientLastName = parts.slice(1).join(" ") ?? "";
    }

    const basePrice = p.pricing.base?.totalBase ?? 0;
    const additionsTotal = (p.pricing.additions ?? []).reduce((s: number, a: { total?: number }) => s + (a.total ?? 0), 0);
    const addonsSnapshot = JSON.stringify(p.pricing.additions ?? []);
    const standardSnapshot = JSON.stringify(p.pricing.standardInPrice ?? []);

    // Zapisz ofertę do offers_crm (status GENERATED)
    try {
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length > 0) {
        const hasClientAddress = (db.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>).some((c) => c.name === "client_address");
        const insCols = hasClientAddress
          ? "id, offer_number, user_id, status, pdf_generated_at, client_first_name, client_last_name, company_name, client_address, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at"
          : "id, offer_number, user_id, status, pdf_generated_at, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at";
        const insVals = hasClientAddress
          ? "?, ?, ?, 'GENERATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, '', 1, ?, ?"
          : "?, ?, ?, 'GENERATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, '', 1, ?, ?";
        db.prepare(`INSERT INTO offers_crm (${insCols}) VALUES (${insVals})`).run(
          offerId,
          p.offerNumber,
          userId,
          nowIso,
          clientFirstName,
          clientLastName,
          resolvedCompanyName,
          ...(hasClientAddress ? [clientAddress] : []),
          p.offer.clientNip ?? "",
          p.offer.clientPhone ?? "",
          p.offer.clientEmail ?? "",
          p.offer.variantHali,
          p.offer.widthM,
          p.offer.lengthM,
          p.offer.heightM ?? null,
          p.offer.areaM2,
          basePrice,
          additionsTotal,
          p.pricing.totalPln,
          standardSnapshot,
          addonsSnapshot,
          nowIso,
          nowIso
        );
        await syncOfferToSupabase(offerId, userId, {
          offerNumber: p.offerNumber,
          offerNumberStatus: p.offerNumber?.startsWith("TEMP-") ? "TEMP" : "FINAL",
          status: "DRAFT",
        });
        db.prepare("INSERT INTO event_log (id, offer_id, user_id, event_type, details_json) VALUES (?, ?, ?, 'OFFER_CREATED', ?)").run(
          uuid(),
          offerId,
          userId,
          JSON.stringify({ pdfId, fileName: result.fileName })
        );
        const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
        if (auditTables.length > 0) {
          db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'PDF_GENERATED', ?)").run(
            uuid(),
            offerId,
            userId,
            JSON.stringify({ pdfId, fileName: result.fileName })
          );
        }
        logger.info("[crm] offer saved to offers_crm", { offerId, offerNumber: p.offerNumber });
      }
    } catch (e) {
      logger.warn("[crm] failed to save offer to offers_crm", e);
    }

    insertPdf(getDb(), {
      id: pdfId,
      offerId,
      userId,
      clientName: clientName || p.offer.clientName || "Klient",
      fileName: result.fileName,
      filePath: result.filePath,
      status: "PDF_CREATED",
      totalPln: p.pricing.totalPln,
      widthM: p.offer.widthM,
      lengthM: p.offer.lengthM,
      heightM: p.offer.heightM,
      areaM2: p.offer.areaM2,
      variantHali: p.offer.variantHali,
    });
    logger.info("[pdf] db insert ok");

    const logPdfPayload = {
      id: pdfId,
      userId,
      userEmail: "",
      clientName: p.offer.clientName,
      variantHali: p.offer.variantHali,
      widthM: p.offer.widthM,
      lengthM: p.offer.lengthM,
      heightM: p.offer.heightM,
      areaM2: p.offer.areaM2,
      totalPln: p.pricing.totalPln,
      fileName: result.fileName,
      createdAt: now.toISOString(),
    };
    apiClient.logPdf(logPdfPayload).then(() => {
      getDb().prepare("UPDATE pdfs SET status = 'LOGGED', logged_at = datetime('now') WHERE id = ?").run(pdfId);
      logger.info("[pdf] Logged to Sheets", pdfId);
    }).catch(async (err) => {
      logger.warn("[pdf] logPdf failed -> enqueue LOG_PDF", err);
      try {
        const { generateOutboxId } = await import("@planlux/shared");
        const outboxId = generateOutboxId();
        getDb().prepare("INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'LOG_PDF', ?, 0, 5)").run(outboxId, JSON.stringify(logPdfPayload));
        logger.info("[pdf] LOG_PDF enqueued", { outboxId, pdfId });
      } catch (e) {
        logger.error("[pdf] Failed to enqueue LOG_PDF", e);
      }
    });

    logger.info("[pdf] done");
    return { ok: true, pdfId, filePath: result.filePath, fileName: result.fileName };
  }

  /** Log failed PDF only when we have a valid offerId (pdfs.offer_id FK). Skip insert otherwise. */
  async function insertPdfFailed(offerData: unknown, errorMessage: string): Promise<void> {
    const db = getDb();
    const p = offerData as { userId?: string; draftId?: string; offer?: { clientName: string; widthM: number; lengthM: number; heightM: number; areaM2: number; variantHali: string }; pricing?: { totalPln: number }; offerNumber?: string } | undefined;
    let offerId: string | null = null;
    if (p?.draftId) {
      const row = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(p.draftId) as { id: string } | undefined;
      if (row) offerId = p.draftId;
    }
    if (!offerId) {
      logger.warn("[pdf] insertPdfFailed skipped (no valid offerId for FK)");
      return;
    }
    try {
      const { insertPdf } = await import("../src/infra/db");
      insertPdf(db, {
        id: uuid(),
        offerId,
        userId: p?.userId ?? "",
        clientName: p?.offer?.clientName ?? "",
        fileName: "(failed)",
        filePath: "(failed)",
        status: "PDF_FAILED",
        errorMessage,
        totalPln: p?.pricing?.totalPln,
        widthM: p?.offer?.widthM ?? 0,
        lengthM: p?.offer?.lengthM ?? 0,
        heightM: p?.offer?.heightM ?? 0,
        areaM2: p?.offer?.areaM2 ?? 0,
        variantHali: p?.offer?.variantHali ?? "",
      });
    } catch (e) {
      logger.warn("[pdf] insertPdfFailed insert error", e);
    }
  }

  async function runPdfGenerateWithTimeout(
    offerData: unknown,
    templateConfig?: unknown,
    options?: GeneratePdfFromTemplateOptions | null,
    pdfOverrides?: unknown
  ): Promise<PdfHandlerResult> {
    const timeoutPromise = new Promise<PdfHandlerResult>((resolve) => {
      setTimeout(() => resolve({ ok: false, error: "Generowanie PDF trwało zbyt długo (timeout). Spróbuj ponownie." }), PDF_HANDLER_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([
        handlePdfGenerate(offerData, templateConfig, options, pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined),
        timeoutPromise,
      ]);
      if (outcome.ok === false) {
        await insertPdfFailed(offerData, outcome.error);
        const meta = (offerData as { offer?: { clientName?: string; widthM?: number; lengthM?: number }; offerNumber?: string }) || {};
        logger.error("[pdf] DIAGNOSTYKA: PDF generation failed", {
          error: outcome.error,
          details: outcome.details,
          clientName: meta.offer?.clientName,
          widthM: meta.offer?.widthM,
          lengthM: meta.offer?.lengthM,
          offerNumber: meta.offerNumber,
        });
        return { ok: false, error: outcome.error, details: outcome.details };
      }
      return outcome;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await insertPdfFailed(offerData, errMsg);
      const meta = (offerData as { offer?: { clientName?: string }; offerNumber?: string }) || {};
      logger.error("[pdf] DIAGNOSTYKA: PDF generation exception", {
        error: errMsg,
        stack: e instanceof Error ? e.stack : undefined,
        clientName: meta.offer?.clientName,
        offerNumber: meta.offerNumber,
      });
      return { ok: false, error: errMsg, details: e instanceof Error ? e.stack : undefined };
    }
  }

  ipcMain.handle("pdf:generate", async (_, offerData: unknown, templateConfig?: unknown, options?: unknown, pdfOverrides?: unknown) => {
    return runPdfGenerateWithTimeout(offerData, templateConfig, options as GeneratePdfFromTemplateOptions | null | undefined, pdfOverrides);
  });

  /** Generuje PDF preview i zwraca base64 (stabilne w rendererze). Input: payload + pdfOverrides. */
  ipcMain.handle("planlux:generatePdfPreview", async (_, payload: unknown, pdfOverrides?: unknown) => {
    const p = payload as GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      logger.warn("[pdf] generatePdfPreview: brak wymaganych danych", { hasOffer: !!p?.offer, hasPricing: !!p?.pricing, hasOfferNumber: !!p?.offerNumber });
      return { ok: false, error: "Nieprawidłowe dane (wymagane: offer, pricing, offerNumber)." };
    }
    try {
      const { getPdfTemplateDir } = await import("./pdf/pdfPaths");
      const templateDir = getPdfTemplateDir();
      if (!templateDir) {
        logger.error("[pdf] generatePdfPreview: brak katalogu szablonu PDF");
        return { ok: false, error: "Nie znaleziono szablonu PDF (Planlux-PDF)." };
      }
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] generatePdfPreview templateDir", templateDir);
      }
      const offerData = {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      };
      const result = await generatePdfFromTemplate(
        offerData,
        logger,
        undefined,
        { previewMode: true },
        (pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined) ?? undefined
      );
      if (!result.ok) return { ok: false, error: result.error, details: result.details };
      const buf = fs.readFileSync(result.filePath);
      const fileSize = buf.length;
      const base64Pdf = buf.toString("base64");
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] generatePdfPreview success", { filePath: result.filePath, fileSize, base64Length: base64Pdf.length });
      }
      return { ok: true, base64Pdf, fileName: result.fileName };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] planlux:generatePdfPreview failed", e);
      return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined };
    }
  });

  /** Generuje tymczasowy PDF preview (userData/preview). Ten sam pipeline co finalny PDF. Zwraca filePath + fileUrl do osadzenia w iframe. */
  ipcMain.handle("pdf:preview", async (_, payload: unknown, templateConfig?: unknown) => {
    const p = payload as GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      return { ok: false, error: "Nieprawidłowe dane (wymagane: offer, pricing, offerNumber)." };
    }
    try {
      const offerData = {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      };
      const result = await generatePdfFromTemplate(
        offerData,
        logger,
        (templateConfig as Partial<import("@planlux/shared").PdfTemplateConfig> | null | undefined) ?? undefined,
        { previewMode: true }
      );
      if (!result.ok) return { ok: false, error: result.error, details: result.details };
      const fileUrl = `planlux-pdf://preview/${result.fileName}`;
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] preview generated", { filePath: result.filePath, fileName: result.fileName });
      }
      return { ok: true, filePath: result.filePath, fileUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] preview failed", e);
      return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined };
    }
  });

  /** Alias dla kompatybilności wstecznej – ta sama logika co pdf:generate. */
  ipcMain.handle("planlux:generatePdf", wrap("planlux:generatePdf", async (_, payload: unknown, templateConfig?: unknown, options?: unknown) => {
    return runPdfGenerateWithTimeout(payload, templateConfig, options as GeneratePdfFromTemplateOptions | null | undefined);
  }));

  const pdfTemplateConfigStore = createFilePdfTemplateConfigStore(app.getPath("userData"));

  /** Ensure offer has a PDF; return path and name for attachment. Generates if missing. */
  ipcMain.handle("planlux:pdf:ensureOfferPdf", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", filePath: null, fileName: null };
      const existing = db.prepare("SELECT file_path, file_name FROM pdfs WHERE offer_id = ? AND file_path IS NOT NULL AND file_path != '' ORDER BY created_at DESC LIMIT 1").get(offerId) as { file_path: string; file_name: string } | undefined;
      if (existing?.file_path && fs.existsSync(existing.file_path)) {
        logger.info("[pdf] ensureOfferPdf existing", { offerId, filePath: existing.file_path });
        return { ok: true, filePath: existing.file_path, fileName: existing.file_name || "oferta.pdf" };
      }
      const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(offerId) as Record<string, unknown> | undefined;
      if (!row) return { ok: false, error: "Oferta nie znaleziona", filePath: null, fileName: null };
      const clientName = [row.client_first_name, row.client_last_name].filter(Boolean).join(" ").trim() || (row.company_name as string) || "Klient";
      const addons = (() => { try { return JSON.parse((row.addons_snapshot as string) || "[]"); } catch { return []; } })();
      const standardInPrice = (() => { try { return JSON.parse((row.standard_snapshot as string) || "[]"); } catch { return []; } })();
      const areaM2 = Number(row.area_m2) || 0;
      const basePrice = Number(row.base_price_pln) || 0;
      const payload: GeneratePdfPayload = {
        userId: row.user_id as string,
        offer: {
          clientName,
          clientNip: (row.nip as string) ?? undefined,
          clientEmail: (row.email as string) ?? undefined,
          clientPhone: (row.phone as string) ?? undefined,
          widthM: Number(row.width_m) || 0,
          lengthM: Number(row.length_m) || 0,
          heightM: row.height_m != null ? Number(row.height_m) : undefined,
          areaM2,
          variantNazwa: (row.variant_hali as string) || "",
          variantHali: (row.variant_hali as string) || "",
        },
        pricing: {
          base: { totalBase: basePrice, cenaPerM2: areaM2 > 0 ? basePrice / areaM2 : undefined },
          additions: addons,
          standardInPrice,
          totalPln: Number(row.total_pln) || 0,
        },
        offerNumber: (row.offer_number as string) || "PLX-?",
        sellerName: "Planlux",
      };
      const templateConfig = await pdfTemplateConfigStore.load(offerId).catch(() => null);
      const result = await generatePdfFromTemplate(
        payload,
        logger,
        templateConfig ?? undefined,
        undefined,
        undefined
      );
      if (!result.ok) {
        logger.warn("[pdf] ensureOfferPdf generate failed", { offerId, error: result.error });
        return { ok: false, error: result.error ?? "Generowanie PDF nie powiodło się", filePath: null, fileName: null };
      }
      const pdfId = uuid();
      const { insertPdf } = await import("../src/infra/db");
      insertPdf(getDb(), {
        id: pdfId,
        offerId,
        userId: (row.user_id as string) || user.id,
        clientName,
        fileName: result.fileName,
        filePath: result.filePath,
        status: "PDF_CREATED",
        totalPln: payload.pricing.totalPln,
        widthM: payload.offer.widthM,
        lengthM: payload.offer.lengthM,
        heightM: payload.offer.heightM ?? undefined,
        areaM2: payload.offer.areaM2,
        variantHali: payload.offer.variantHali,
      });
      logger.info("[pdf] ensureOfferPdf generated", { offerId, filePath: result.filePath, fileName: result.fileName });
      return { ok: true, filePath: result.filePath, fileName: result.fileName };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] ensureOfferPdf failed", e);
      return { ok: false, error: msg, filePath: null, fileName: null };
    }
  });

  ipcMain.handle("planlux:loadPdfTemplateConfig", async (_, offerIdOrDraftId: string) => {
    try {
      const config = await pdfTemplateConfigStore.load(offerIdOrDraftId);
      return { ok: true, config };
    } catch (e) {
      logger.error("[pdf] loadPdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:savePdfTemplateConfig", async (_, offerIdOrDraftId: string, config: unknown) => {
    try {
      await pdfTemplateConfigStore.save(offerIdOrDraftId, config as import("@planlux/shared").PdfTemplateConfig);
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] savePdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:resetPdfTemplateConfig", async (_, offerIdOrDraftId: string) => {
    try {
      await pdfTemplateConfigStore.reset(offerIdOrDraftId);
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] resetPdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Ping Supabase (lub legacy backend) przed reserveOfferNumber. Określa online. */
  async function checkOnline(): Promise<boolean> {
    try {
      if (getSupabase) {
        const { error } = await getSupabase().from("profiles").select("id").limit(1).maybeSingle();
        return !error;
      }
      const appConfig = getConfig();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(getBackendUrl(appConfig), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "health" }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok || res.status < 500;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    } catch {
      return false;
    }
  }

  /** Tworzy ofertę: numer TEMP (TEMP-deviceId-epoch-rand); finalizacja przy PDF/e-mail/sync. */
  ipcMain.handle("planlux:createOffer", wrap("planlux:createOffer", async (_, minimalData?: { clientName?: string; widthM?: number; lengthM?: number }) => {
    try {
      const user = requireAuth();
      const { getDeviceId } = await import("./deviceId");
      const deviceId = getDeviceId();
      const tempNumber = generateTempOfferNumber(deviceId);

      const offerId = uuid();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, offerId, offerNumber: tempNumber, isTemp: true };

      const clientName = (minimalData?.clientName ?? "").trim();
      const w = minimalData?.widthM ?? 0;
      const l = minimalData?.lengthM ?? 0;
      const areaM2 = w * l || 0;
      const isCompany = /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
      let clientFirstName = "";
      let clientLastName = "";
      let companyName = "";
      if (isCompany) companyName = clientName;
      else {
        const parts = clientName.split(/\s+/).filter(Boolean);
        clientFirstName = parts[0] ?? "";
        clientLastName = parts.slice(1).join(" ") ?? "";
      }
      const nowIso = new Date().toISOString();
      const hasStatus = (db.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>).some((c) => c.name === "offer_number_status");
      if (hasStatus) {
        db.prepare(
          `INSERT INTO offers_crm (id, offer_number, offer_number_status, user_id, status, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
           VALUES (?, ?, 'TEMP', ?, 'IN_PROGRESS', ?, ?, ?, '', '', '', 'T18_T35_DACH', ?, ?, NULL, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
        ).run(offerId, tempNumber, user.id, clientFirstName, clientLastName, companyName, w, l, areaM2, nowIso, nowIso);
      } else {
        db.prepare(
          `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
           VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, '', '', '', 'T18_T35_DACH', ?, ?, NULL, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
        ).run(offerId, tempNumber, user.id, clientFirstName, clientLastName, companyName, w, l, areaM2, nowIso, nowIso);
      }

      await syncOfferToSupabase(offerId, user.id, { offerNumber: tempNumber, offerNumberStatus: "TEMP", status: "DRAFT" });

      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'CREATE_OFFER', ?)").run(
          uuid(), offerId, user.id, JSON.stringify({ offerNumber: tempNumber, clientName, widthM: w, lengthM: l })
        );
      }
      logger.info("[crm] createOffer ok", { offerId, offerNumber: tempNumber });
      return { ok: true, offerId, offerNumber: tempNumber, isTemp: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[crm] createOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  /** Auto-numer oferty: zawsze lokalnie z offer_counters (offline-first). TEMP tylko przy wyjątku. */
  ipcMain.handle("planlux:getNextOfferNumber", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const row = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(user.id) as
        | { display_name: string | null; email?: string }
        | undefined;
      const initial = getSalesInitial(row ? { displayName: row.display_name ?? undefined, email: row.email } : null);
      const year = new Date().getFullYear();
      try {
        const hasTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_counters'").get() as { name?: string } | undefined)?.name === "offer_counters";
        if (hasTable) {
          const plxNumber = getNextOfferNumberLocal(db, "PLX", year, initial);
          logger.info("[offer] getNextOfferNumber local PLX", { offerNumber: plxNumber });
          return { ok: true, offerNumber: plxNumber };
        }
        logger.warn("[offer] offer_counters table missing, using TEMP fallback");
      } catch (e) {
        logger.warn("[offer] offer_counters failed, using TEMP fallback", e);
      }
      const { getDeviceId } = await import("./deviceId");
      const deviceId = getDeviceId();
      const tempNumber = `TEMP-${deviceId}-${Date.now()}`;
      return { ok: true, offerNumber: tempNumber, isTemp: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[offer] getNextOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const OFFER_DRAFT_PATH = path.join(app.getPath("userData"), "offer-draft.json");
  ipcMain.handle("planlux:loadOfferDraft", async () => {
    try {
      requireAuth();
      if (!fs.existsSync(OFFER_DRAFT_PATH)) return { ok: true, draft: null };
      const raw = fs.readFileSync(OFFER_DRAFT_PATH, "utf-8");
      const draft = JSON.parse(raw);
      return { ok: true, draft };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, draft: null };
      }
      logger.error("[draft] loadOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), draft: null };
    }
  });
  ipcMain.handle("planlux:saveOfferDraft", async (_, draft: unknown) => {
    try {
      const user = requireAuth();
      fs.mkdirSync(path.dirname(OFFER_DRAFT_PATH), { recursive: true });
      fs.writeFileSync(OFFER_DRAFT_PATH, JSON.stringify(draft, null, 0), "utf-8");

      const d = draft as {
        draftId?: string;
        offerNumber?: string;
        clientName?: string;
        companyName?: string;
        personName?: string;
        clientAddress?: string;
        clientNip?: string;
        clientEmail?: string;
        clientPhone?: string;
        variantHali?: string;
        widthM?: string;
        lengthM?: string;
        heightM?: string;
      };
      const companyNameRaw = (d?.companyName ?? "").trim();
      const personNameRaw = (d?.personName ?? "").trim();
      const clientAddressVal = (d?.clientAddress ?? "").trim();
      const clientName = personNameRaw || companyNameRaw || (d?.clientName ?? "").trim();
      const w = parseFloat(String(d?.widthM ?? 0)) || 0;
      const l = parseFloat(String(d?.lengthM ?? 0)) || 0;
      const hasData = clientName.length > 0 && w > 0 && l > 0;

      if (hasData && user.id) {
        try {
          const db = getDb();
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
          if (tables.length > 0) {
            const offerId = d.draftId ?? uuid();
            const existing = db.prepare("SELECT id, offer_number FROM offers_crm WHERE id = ?").get(offerId) as { id: string; offer_number: string } | undefined;
            const draftNumber = (d?.offerNumber?.trim() && d.offerNumber !== "—") ? d.offerNumber : null;
            const existingNumber = existing?.offer_number && !existing.offer_number.startsWith("TEMP-") ? existing.offer_number : null;
            const offerNumber = draftNumber ?? existingNumber;
            if (!offerNumber) {
              return { ok: true };
            }
            const areaM2 = w * l;
            const h = d.heightM ? parseFloat(String(d.heightM)) : null;
            const isCompany = companyNameRaw ? true : /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
            let clientFirstName = "";
            let clientLastName = "";
            let companyName = companyNameRaw;
            if (!companyName && isCompany) companyName = clientName;
            if (personNameRaw) {
              const parts = personNameRaw.split(/\s+/).filter(Boolean);
              clientFirstName = parts[0] ?? "";
              clientLastName = parts.slice(1).join(" ") ?? "";
            } else if (!companyNameRaw) {
              const parts = clientName.split(/\s+/).filter(Boolean);
              clientFirstName = parts[0] ?? "";
              clientLastName = parts.slice(1).join(" ") ?? "";
            }
            const nowIso = new Date().toISOString();
            const hasClientAddress = (db.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>).some((c) => c.name === "client_address");
            if (existing) {
              if (hasClientAddress) {
                db.prepare(
                  `UPDATE offers_crm SET
                  client_first_name=?, client_last_name=?, company_name=?, client_address=?, nip=?, phone=?, email=?, variant_hali=?,
                  width_m=?, length_m=?, height_m=?, area_m2=?, updated_at=?
                  WHERE id=?`
                ).run(clientFirstName, clientLastName, companyName, clientAddressVal, d.clientNip ?? "", d.clientPhone ?? "", d.clientEmail ?? "", d.variantHali ?? "T18_T35_DACH", w, l, h, areaM2, nowIso, offerId);
              } else {
                db.prepare(
                  `UPDATE offers_crm SET
                  client_first_name=?, client_last_name=?, company_name=?, nip=?, phone=?, email=?, variant_hali=?,
                  width_m=?, length_m=?, height_m=?, area_m2=?, updated_at=?
                  WHERE id=?`
                ).run(clientFirstName, clientLastName, companyName, d.clientNip ?? "", d.clientPhone ?? "", d.clientEmail ?? "", d.variantHali ?? "T18_T35_DACH", w, l, h, areaM2, nowIso, offerId);
              }
            } else {
              if (hasClientAddress) {
                db.prepare(
                  `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, client_address, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
                 VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
                ).run(
                  offerId,
                  offerNumber,
                  user.id,
                  clientFirstName,
                  clientLastName,
                  companyName,
                  clientAddressVal,
                  d.clientNip ?? "",
                  d.clientPhone ?? "",
                  d.clientEmail ?? "",
                  d.variantHali ?? "T18_T35_DACH",
                  w,
                  l,
                  h,
                  areaM2,
                  nowIso,
                  nowIso
                );
                await syncOfferToSupabase(offerId, user.id, { offerNumber, offerNumberStatus: "TEMP", status: "DRAFT" });
              } else {
                db.prepare(
                  `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
                 VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
                ).run(
                  offerId,
                  offerNumber,
                  user.id,
                  clientFirstName,
                  clientLastName,
                  companyName,
                  d.clientNip ?? "",
                  d.clientPhone ?? "",
                  d.clientEmail ?? "",
                  d.variantHali ?? "T18_T35_DACH",
                  w,
                  l,
                  h,
                  areaM2,
                  nowIso,
                  nowIso
                );
                await syncOfferToSupabase(offerId, user.id, { offerNumber, offerNumberStatus: "TEMP", status: "DRAFT" });
              }
            }
            const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
            if (auditTables.length > 0) {
              const auditType = existing ? "UPDATE_DRAFT" : "CREATE_DRAFT";
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, ?, ?)").run(
                uuid(),
                offerId,
                user.id,
                auditType,
                JSON.stringify({ clientName, widthM: w, lengthM: l })
              );
            }
            return { ok: true };
          }
        } catch (e) {
          logger.warn("[crm] saveOfferDraft to offers_crm skipped", e);
        }
      }

      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[draft] saveOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:clearOfferDraft", async () => {
    try {
      requireAuth();
      if (fs.existsSync(OFFER_DRAFT_PATH)) fs.unlinkSync(OFFER_DRAFT_PATH);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[draft] clearOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Dashboard: statystyki ofert (per użytkownik lub globalne dla managera). */
  ipcMain.handle("planlux:getDashboardStats", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) {
        return {
          ok: true,
          byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
          totalPln: 0,
          perUser: [],
        };
      }
      const seeAll = user.role === "ADMIN" || user.role === "SZEF";
      const filterUser = seeAll ? null : user.id;
      const where = filterUser ? "WHERE user_id = ?" : "";
      const args = filterUser ? [filterUser] : [];

      const rows = db.prepare(
        `SELECT status, total_pln, user_id FROM offers_crm ${where}`
      ).all(...args) as Array<{ status: string; total_pln: number; user_id: string }>;

      const byStatus: Record<string, number> = { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 };
      let totalPln = 0;
      const userMap = new Map<string, { count: number; totalPln: number }>();

      for (const r of rows) {
        const s = (r.status ?? "IN_PROGRESS").toUpperCase();
        if (s in byStatus) byStatus[s]++;
        totalPln += Number(r.total_pln ?? 0) || 0;
        if (seeAll && r.user_id) {
          const u = userMap.get(r.user_id) ?? { count: 0, totalPln: 0 };
          u.count++;
          u.totalPln += Number(r.total_pln ?? 0) || 0;
          userMap.set(r.user_id, u);
        }
      }

      let perUser: Array<{ userId: string; displayName: string; email: string; count: number; totalPln: number }> = [];
      if (seeAll && userMap.size > 0) {
        const users = db.prepare("SELECT id, email, display_name FROM users WHERE active = 1").all() as Array<{ id: string; email: string; display_name: string }>;
        const userById = new Map(users.map((u) => [u.id, u]));
        perUser = Array.from(userMap.entries())
          .map(([uid, data]) => ({
            userId: uid,
            displayName: (() => {
              const u = userById.get(uid);
              const dn = (u?.display_name ?? "").trim();
              return dn || u?.email || uid;
            })(),
            email: userById.get(uid)?.email ?? "",
            count: data.count,
            totalPln: data.totalPln,
          }))
          .sort((a, b) => b.count - a.count);
      }

      return { ok: true, byStatus, totalPln, perUser };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 }, totalPln: 0, perUser: [], error: e.message };
      }
      logger.error("[dashboard] getDashboardStats failed", e);
      return {
        ok: false,
        byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
        totalPln: 0,
        perUser: [],
      };
    }
  });

  /** CRM: lista ofert z offers_crm. SALESPERSON → filtr user_id; BOSS/ADMIN → wszystkie. */
  ipcMain.handle("planlux:getOffersCrm", async (_, params?: { statusFilter?: string; searchQuery?: string }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, offers: [] };
      const statusFilter = params?.statusFilter ?? "all";
      const searchQuery = params?.searchQuery ?? "";
      let sql = "SELECT id, offer_number, status, user_id, client_first_name, client_last_name, company_name, nip, phone, variant_hali, width_m, length_m, area_m2, total_pln, created_at, pdf_generated_at, emailed_at, realized_at FROM offers_crm";
      const args: unknown[] = [];
      const seeAll = user.role === "ADMIN" || user.role === "SZEF";
      if (!seeAll) {
        sql += " WHERE user_id = ?";
        args.push(user.id);
      }
      if (statusFilter !== "all") {
        sql += (args.length > 0 ? " AND" : " WHERE") + " status = ?";
        args.push(statusFilter.toUpperCase());
      }
      if (searchQuery?.trim()) {
        const q = `%${searchQuery.trim()}%`;
        sql += (args.length > 0 ? " AND" : " WHERE") + " (offer_number LIKE ? OR client_first_name LIKE ? OR client_last_name LIKE ? OR company_name LIKE ? OR nip LIKE ? OR phone LIKE ?)";
        args.push(q, q, q, q, q, q);
      }
      sql += " ORDER BY created_at DESC LIMIT 200";
      const rows = db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
      const offers = rows.map((r) => ({
        id: r.id,
        offerNumber: r.offer_number,
        status: r.status,
        userId: r.user_id ?? "",
        clientFirstName: r.client_first_name ?? "",
        clientLastName: r.client_last_name ?? "",
        companyName: r.company_name ?? "",
        nip: r.nip ?? "",
        phone: r.phone ?? "",
        variantHali: r.variant_hali ?? "",
        widthM: r.width_m ?? 0,
        lengthM: r.length_m ?? 0,
        areaM2: r.area_m2 ?? 0,
        totalPln: r.total_pln ?? 0,
        createdAt: r.created_at ?? "",
        pdfGeneratedAt: r.pdf_generated_at ?? null,
        emailedAt: r.emailed_at ?? null,
        realizedAt: r.realized_at ?? null,
      }));
      return { ok: true, offers };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, offers: [] };
      }
      logger.error("[crm] getOffersCrm failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), offers: [] };
    }
  });

  /** CRM: znajdź potencjalne duplikaty – tylko dane klienta, minimum jedno pole dokładnie pasuje 1:1 (po normalizacji). Bez substring/includes. */
  ipcMain.handle("planlux:findDuplicateOffers", async (_, params: { clientName?: string; companyName?: string; personName?: string; nip?: string; phone?: string; email?: string }) => {
    try {
      const { digits, norm } = await import("./offerDuplicateNorm");
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, duplicates: [] };

      const nipNorm = digits(params.nip ?? "");
      const phoneNorm = digits(params.phone ?? "");
      const emailNorm = norm(params.email ?? "");
      const companyNorm = norm(params.companyName ?? "");
      const personNorm = norm(params.personName ?? params.clientName ?? "");

      const rows = db.prepare(
        `SELECT id, offer_number, status, client_first_name, client_last_name, company_name, nip, phone, email, width_m, length_m, area_m2, total_pln, created_at
         FROM offers_crm WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
      ).all(user.id) as Array<Record<string, unknown>>;

      const duplicates: Array<{
        id: string;
        offerNumber: string;
        status: string;
        clientDisplay: string;
        nip: string;
        phone: string;
        email: string;
        widthM: number;
        lengthM: number;
        areaM2: number;
        totalPln: number;
        createdAt: string;
      }> = [];

      for (const r of rows) {
        const dbNip = digits(String(r.nip ?? ""));
        const dbPhone = digits(String(r.phone ?? ""));
        const dbEmail = norm(String(r.email ?? ""));
        const dbCompany = norm(String(r.company_name ?? ""));
        const dbFullName = norm([r.client_first_name, r.client_last_name].filter(Boolean).join(" "));
        const dbDisplay = (r.company_name && String(r.company_name).trim())
          ? String(r.company_name).trim()
          : [r.client_first_name, r.client_last_name].filter(Boolean).join(" ").trim() || "—";

        let match = false;
        if (nipNorm.length > 0 && nipNorm === dbNip) match = true;
        if (phoneNorm.length > 0 && phoneNorm === dbPhone) match = true;
        if (emailNorm.length > 0 && emailNorm === dbEmail) match = true;
        if (companyNorm.length > 0 && companyNorm === dbCompany) match = true;
        if (personNorm.length > 0 && personNorm === dbFullName) match = true;

        if (match) {
          duplicates.push({
            id: r.id as string,
            offerNumber: r.offer_number as string,
            status: r.status as string,
            clientDisplay: dbDisplay,
            nip: String(r.nip ?? ""),
            phone: String(r.phone ?? ""),
            email: String(r.email ?? ""),
            widthM: Number(r.width_m ?? 0),
            lengthM: Number(r.length_m ?? 0),
            areaM2: Number(r.area_m2 ?? 0),
            totalPln: Number(r.total_pln ?? 0),
            createdAt: r.created_at as string,
          });
        }
      }

      return { ok: true, duplicates };
    } catch (e) {
      logger.error("[crm] findDuplicateOffers failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), duplicates: [] };
    }
  });

  /** CRM: oznacz ofertę jako zrealizowaną. */
  ipcMain.handle("planlux:markOfferRealized", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const offerRow = db.prepare("SELECT user_id FROM offers_crm WHERE id = ?").get(offerId) as { user_id: string } | undefined;
      if (!offerRow) return { ok: false, error: "Oferta nie znaleziona" };
      if (offerRow.user_id !== user.id && user.role !== "ADMIN" && user.role !== "SZEF") return { ok: false, error: "Forbidden" };
      const now = new Date().toISOString();
      db.prepare("UPDATE offers_crm SET status = 'REALIZED', realized_at = ?, updated_at = ? WHERE id = ?").run(now, now, offerId);
      const uid = user.id;
      const id = uuid();
      db.prepare("INSERT INTO event_log (id, offer_id, user_id, event_type, details_json) VALUES (?, ?, ?, 'OFFER_REALIZED', ?)").run(
        id,
        offerId,
        uid,
        JSON.stringify({ realizedAt: now })
      );
      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'STATUS_CHANGED', ?)").run(
          uuid(),
          offerId,
          uid,
          JSON.stringify({ fromStatus: "SENT", toStatus: "REALIZED", realizedAt: now })
        );
      }
      return { ok: true };
    } catch (e) {
      logger.error("[crm] markOfferRealized failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** CRM: usuń ofertę tylko gdy status = IN_PROGRESS. Usuwa powiązane: pdfs, email_history, offer_audit, outbox, offers_crm. */
  ipcMain.handle("planlux:deleteOffer", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: false, error: "Brak tabeli ofert", code: "ERR_NO_TABLE" };
      const offer = db.prepare("SELECT id, status, user_id FROM offers_crm WHERE id = ?").get(offerId) as { id: string; status: string; user_id: string } | undefined;
      if (!offer) return { ok: false, error: "Oferta nie znaleziona", code: "ERR_NOT_FOUND" };
      if (offer.status !== "IN_PROGRESS") {
        return { ok: false, error: "Nie można usunąć oferty po zatwierdzeniu", code: "ERR_STATUS" };
      }
      const canAccess = offer.user_id === user.id || (user.role === "ADMIN" || user.role === "SZEF");
      if (!canAccess) return { ok: false, error: "Forbidden", code: "ERR_AUTH" };
      db.transaction(() => {
        db.prepare("DELETE FROM pdfs WHERE offer_id = ?").run(offerId);
        const ehInfo = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
        const hasOfferId = ehInfo.some((c) => c.name === "offer_id");
        if (hasOfferId) db.prepare("DELETE FROM email_history WHERE offer_id = ?").run(offerId);
        db.prepare("DELETE FROM offer_audit WHERE offer_id = ?").run(offerId);
        try {
          db.prepare("DELETE FROM event_log WHERE offer_id = ?").run(offerId);
        } catch {
          // event_log może nie mieć offer_id
        }
        const outboxInfo = db.prepare("PRAGMA table_info(email_outbox)").all() as Array<{ name: string }>;
        if (outboxInfo.some((c) => c.name === "related_offer_id")) {
          db.prepare("DELETE FROM email_outbox WHERE related_offer_id = ?").run(offerId);
        }
        db.prepare("DELETE FROM offers_crm WHERE id = ?").run(offerId);
      })();
      logger.info("[crm] deleteOffer", { offerId, userId: user.id });
      return { ok: true };
    } catch (e) {
      logger.error("[crm] deleteOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), code: "ERR_DB", stack: e instanceof Error ? e.stack : undefined };
    }
  });

  const ROLES_SEE_ALL = ["ADMIN", "SZEF"];

  /**
   * Resolve offer identifier to offers_crm.id (PK for FK).
   * Accepts either offers_crm.id or offer_number (e.g. "PLX-X0020/2026").
   * Use the returned id for email_history.offer_id, email_outbox.related_offer_id, etc.
   */
  function resolveOfferId(db: ReturnType<typeof getDb>, offerIdOrNumber: string): string | null {
    if (!offerIdOrNumber || !offerIdOrNumber.trim()) return null;
    const byId = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(offerIdOrNumber.trim()) as { id: string } | undefined;
    if (byId) return byId.id;
    const byNumber = db.prepare("SELECT id FROM offers_crm WHERE offer_number = ?").get(offerIdOrNumber.trim()) as { id: string } | undefined;
    return byNumber?.id ?? null;
  }

  function canAccessOffer(db: ReturnType<typeof getDb>, offerId: string, userId: string): boolean {
    const offer = db.prepare("SELECT user_id FROM offers_crm WHERE id = ?").get(offerId) as { user_id: string } | undefined;
    if (!offer) return false;
    if (offer.user_id === userId) return true;
    const user = db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(userId) as { role: string } | undefined;
    return !!user && ROLES_SEE_ALL.includes(user.role);
  }

  /** CRM: szczegóły oferty (pełne dane). Owner lub BOSS/ADMIN ma dostęp. */
  ipcMain.handle("planlux:getOfferDetails", wrap("planlux:getOfferDetails", async (_, offerId: string) => {
    const user = requireAuth();
    const db = getDb();
    if (!canAccessOffer(db, offerId, user.id)) throw new AppError("OFFER_NOT_FOUND", "Oferta nie znaleziona", { expose: true });
    const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(offerId) as Record<string, unknown> | undefined;
    if (!row) throw new AppError("OFFER_NOT_FOUND", "Oferta nie znaleziona", { expose: true });
    const offer = {
      id: row.id,
      offerNumber: row.offer_number,
      userId: row.user_id,
      status: row.status,
      createdAt: row.created_at,
      pdfGeneratedAt: row.pdf_generated_at ?? null,
      emailedAt: row.emailed_at ?? null,
      realizedAt: row.realized_at ?? null,
      clientFirstName: row.client_first_name ?? "",
      clientLastName: row.client_last_name ?? "",
      companyName: row.company_name ?? "",
      nip: row.nip ?? "",
      phone: row.phone ?? "",
      email: row.email ?? "",
      variantHali: row.variant_hali ?? "",
      widthM: row.width_m ?? 0,
      lengthM: row.length_m ?? 0,
      heightM: row.height_m ?? null,
      areaM2: row.area_m2 ?? 0,
      hallSummary: row.hall_summary ?? "",
      basePricePln: row.base_price_pln ?? 0,
      additionsTotalPln: row.additions_total_pln ?? 0,
      totalPln: row.total_pln ?? 0,
      standardSnapshot: row.standard_snapshot ?? "[]",
      addonsSnapshot: row.addons_snapshot ?? "[]",
      noteHtml: row.note_html ?? "",
      version: row.version ?? 1,
      updatedAt: row.updated_at ?? "",
    };
    return { ok: true, offer };
  }));

  /** CRM: audit trail oferty (offer_audit + event_log). Owner lub manager/admin ma dostęp. */
  ipcMain.handle("planlux:getOfferAudit", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", items: [] };
      const auditRows = db.prepare(
        "SELECT id, offer_id, user_id, type, payload_json, created_at FROM offer_audit WHERE offer_id = ? ORDER BY created_at ASC"
      ).all(offerId) as Array<{ id: string; type: string; payload_json: string; created_at: string }>;
      const eventRows = db.prepare(
        "SELECT id, event_type as type, details_json as payload_json, created_at FROM event_log WHERE offer_id = ? ORDER BY created_at ASC"
      ).all(offerId) as Array<{ id: string; type: string; payload_json: string; created_at: string }>;
      const items = [
        ...auditRows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload_json || "{}"), createdAt: r.created_at })),
        ...eventRows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload_json || "{}"), createdAt: r.created_at })),
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return { ok: true, items };
    } catch (e) {
      logger.error("[crm] getOfferAudit failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });

  /** CRM: historia e-maili dla oferty. Źródło: email_history (related_offer_id OR offer_id); outbox tylko QUEUED/FAILED, bez wpisów już w history (Set outbox_id). Statusy mapowane na lowercase w UI. */
  ipcMain.handle("planlux:getEmailHistoryForOffer", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", emails: [] };
      const emails = getEmailHistoryForOfferData(db as EmailHistoryDb, offerId, logger);
      return { ok: true, emails };
    } catch (e) {
      logger.error("[crm] getEmailHistoryForOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), emails: [] };
    }
  });

  /** CRM: pliki PDF powiązane z ofertą (z tabeli pdfs po offer_id). Najnowszy pierwszy. Owner lub BOSS/ADMIN ma dostęp. */
  ipcMain.handle("planlux:getPdfsForOffer", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", pdfs: [] };
      const hasOfferId = (db.prepare("PRAGMA table_info(pdfs)").all() as Array<{ name: string }>).some((c) => c.name === "offer_id");
      if (!hasOfferId) return { ok: true, pdfs: [] };
      const pdfRows = db.prepare(
        "SELECT id, file_name, file_path, status, created_at FROM pdfs WHERE offer_id = ? ORDER BY created_at DESC"
      ).all(offerId) as Array<{ id: string; file_name: string; file_path: string; status: string; created_at: string }>;
      const pdfs = pdfRows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        filePath: r.file_path,
        status: r.status,
        createdAt: r.created_at,
      }));
      return { ok: true, pdfs };
    } catch (e) {
      logger.error("[crm] getPdfsForOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), pdfs: [] };
    }
  });

  /** Wewnętrzna logika sync – używana przez handler i saveOfferDraft. */
  async function doSyncTempOfferNumbers(): Promise<{
    ok: boolean;
    syncedCount: number;
    updated: Array<{ offerId: string; oldNumber: string; newNumber: string }>;
    failed: Array<{ offerId: string; error: string }>;
    error?: string;
  }> {
    const log = (msg: string, data?: unknown) => {
      console.log(`[sync] ${msg}`, data ?? "");
      logger.info(`[sync] ${msg}`, data);
    };
    const errLog = (msg: string, e?: unknown) => {
      console.error(`[sync] ${msg}`, e ?? "");
      logger.error(`[sync] ${msg}`, e);
    };
    const updated: Array<{ offerId: string; oldNumber: string; newNumber: string }> = [];
    const failed: Array<{ offerId: string; error: string }> = [];
    try {
      log("START syncTempOfferNumbers (lokalnie, bez backendu)");
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) {
        log("brak tabeli offers_crm, pomijam");
        return { ok: true, syncedCount: 0, updated, failed };
      }
      const tempRows = db.prepare(
        "SELECT id, offer_number, user_id FROM offers_crm WHERE offer_number LIKE 'TEMP-%'"
      ).all() as Array<{ id: string; offer_number: string; user_id: string }>;
      log("found TEMP offers count", tempRows.length);
      const hasCountersTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_counters'").get() as { name?: string } | undefined)?.name === "offer_counters";
      if (!hasCountersTable) {
        log("brak tabeli offer_counters, pomijam sync");
        return { ok: true, syncedCount: 0, updated, failed };
      }
      for (const row of tempRows) {
        log("processing offerId", { offerId: row.id, tempNumber: row.offer_number });
        try {
          const userRow = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(row.user_id) as { display_name: string | null; email?: string } | undefined;
          const initial = getSalesInitial(userRow ? { displayName: userRow.display_name ?? undefined, email: userRow.email } : null);
          let result: { offerNumber: string };
          try {
            result = finalizeOfferNumber(db as import("./db/types").DbLike, row.id, { initial });
            const newNumber = result.offerNumber;
            log("wygenerowano lokalnie", { offerId: row.id, newNumber });
            const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
            if (auditTables.length > 0) {
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'OFFER_NUMBER_ASSIGNED', ?)").run(
                uuid(), row.id, row.user_id, JSON.stringify({ oldNumber: row.offer_number, newNumber })
              );
            }
            updated.push({ offerId: row.id, oldNumber: row.offer_number, newNumber });
            log("TEMP→PLX zakończony sukcesem", { offerId: row.id, newNumber });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            errLog("finalizeOfferNumber failed", { offerId: row.id, error: e });
            failed.push({ offerId: row.id, error: errMsg });
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          errLog("błąd w pętli oferty – przechodzę dalej", { offerId: row.id, error: e });
          failed.push({ offerId: row.id, error: errMsg });
        }
      }
      log("syncTempOfferNumbers zakończony", { syncedCount: updated.length, updated, failed });
      return { ok: true, syncedCount: updated.length, updated, failed };
    } catch (e) {
      errLog("syncTempOfferNumbers failed", e);
      return { ok: false, syncedCount: 0, updated, failed, error: e instanceof Error ? e.message : String(e) };
    }
  }

  ipcMain.handle("planlux:syncTempOfferNumbers", wrap("planlux:syncTempOfferNumbers", () => doSyncTempOfferNumbers()));

  /** CRM: zamień numer oferty (np. TEMP→final po sync). Owner lub BOSS/ADMIN. */
  ipcMain.handle("planlux:replaceOfferNumber", async (_, offerId: string, newOfferNumber: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona" };
      db.prepare("UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?").run(newOfferNumber, offerId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[crm] replaceOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

/** CRM: wyślij e-mail oferty (online: SMTP + SENT; offline: QUEUED + outbox). */
  ipcMain.handle("planlux:sendOfferEmail", async (_, offerIdParam: string, params: { to: string; subject: string; body: string; pdfPath?: string }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const offerId = resolveOfferId(db, offerIdParam);
      if (!offerId) return { ok: false, error: "Oferta nie znaleziona (nieprawidłowy identyfikator lub numer oferty)" };
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona" };
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(user.id) as { email: string } | undefined;
      if (!userRow?.email) return { ok: false, error: "Użytkownik nie znaleziony" };

      const offerRow = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(offerId);
      if (!offerRow) return { ok: false, error: "Oferta nie znaleziona (FK: rekord oferty nie istnieje)" };

      const toEmails = parseRecipients(params.to.trim());
      const toNormalized = toEmails.join(", ");
      if (!toNormalized) return { ok: false, error: "Adres odbiorcy jest wymagany" };

      const emailId = uuid();
      const fromEmail = userRow.email;
      const attachments = params.pdfPath ? [params.pdfPath] : [];
      const nowIso = new Date().toISOString();

      const onlineRes = await (async () => {
        try {
          const res = await fetch("https://www.google.com", { method: "HEAD", mode: "no-cors" });
          return res != null;
        } catch {
          return false;
        }
      })();

      if (onlineRes) {
        const { getSmtpConfig, sendMail } = await import("./smtpSend");
        const creds = getSmtpConfig(fromEmail);
        if (!creds) {
          db.prepare(
            `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, error_message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            emailId,
            offerId,
            user.id,
            fromEmail,
            toNormalized,
            params.subject.trim() || "Oferta PLANLUX",
            params.body.trim(),
            JSON.stringify(attachments),
            allowedEmailHistoryStatus("failed"),
            "Skonfiguruj SMTP w ustawieniach (userData/smtp-config.json)",
            nowIso
          );
          return { ok: false, error: "Skonfiguruj SMTP w ustawieniach" };
        }
        try {
          const info = await sendMail(creds, {
            from: fromEmail,
            to: toNormalized,
            subject: params.subject.trim() || "Oferta PLANLUX",
            body: params.body.trim(),
            attachmentPath: params.pdfPath,
          });
          logger.info("[email] sendMail result", { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected, response: info.response });
          const accepted = (info.accepted ?? []).length > 0;
          const rejected = (info.rejected ?? []).length > 0;
          const sent = accepted && !rejected;
          if (sent) {
            db.prepare(
              `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, sent_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              emailId,
              offerId,
              user.id,
              fromEmail,
              toNormalized,
              params.subject.trim() || "Oferta PLANLUX",
              params.body.trim(),
              JSON.stringify(attachments),
              allowedEmailHistoryStatus("sent"),
              nowIso,
              nowIso
            );
            db.prepare("UPDATE offers_crm SET status = 'SENT', emailed_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, offerId);
            const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
            if (auditTables.length > 0) {
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_SENT', ?)").run(
                uuid(),
                offerId,
                user.id,
                JSON.stringify({ emailId, to: toNormalized })
              );
            }
            return { ok: true };
          }
          const errMsg = rejected
            ? `SMTP odrzucił adresy: ${(info.rejected ?? []).join(", ")}${info.response ? `; ${info.response}` : ""}`
            : (info.response ?? "Serwer nie przyjął wiadomości");
          db.prepare(
            `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, error_message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            emailId,
            offerId,
            user.id,
            fromEmail,
            toNormalized,
            params.subject.trim() || "Oferta PLANLUX",
            params.body.trim(),
            JSON.stringify(attachments),
            allowedEmailHistoryStatus("failed"),
            errMsg,
            nowIso
          );
          logger.error("[email] send not accepted", { rejected: info.rejected, response: info.response });
          return { ok: false, error: errMsg };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          db.prepare(
            `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, error_message, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            emailId,
            offerId,
            user.id,
            fromEmail,
            toNormalized,
            params.subject.trim() || "Oferta PLANLUX",
            params.body.trim(),
            JSON.stringify(attachments),
            allowedEmailHistoryStatus("failed"),
            msg,
            nowIso
          );
          logger.error("[email] send failed", e);
          return { ok: false, error: msg };
        }
      }

      db.prepare(
        `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        emailId,
        offerId,
        user.id,
        fromEmail,
        toNormalized,
        params.subject.trim() || "Oferta PLANLUX",
        params.body.trim(),
        JSON.stringify(attachments),
        allowedEmailHistoryStatus("queued"),
        nowIso
      );
      const { generateOutboxId } = await import("@planlux/shared");
      const outboxId = generateOutboxId();
      db.prepare(
        "INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'SEND_EMAIL', ?, 0, 5)"
      ).run(outboxId, JSON.stringify({
        emailId,
        to: toNormalized,
        subject: params.subject.trim() || "Oferta PLANLUX",
        body: params.body.trim(),
        attachmentPath: params.pdfPath ?? undefined,
      }));

      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_QUEUED', ?)").run(
          uuid(),
          offerId,
          user.id,
          JSON.stringify({ emailId, to: toNormalized })
        );
      }
      return { ok: true, queued: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[email] sendOfferEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Ogólny kanał e-mail: sprawdzenie internetu (net.request); offline → { ok: false, offline: true }. */
  ipcMain.handle("planlux:sendEmail", async (_, payload: unknown) => {
    try {
    console.log("[IPC] planlux:sendEmail called");
      const user = requireAuth();
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "Invalid payload" };
      }
      const { to, subject, text, html } = payload as {
        to?: unknown;
        subject?: unknown;
        text?: unknown;
        html?: unknown;
      };
      if (typeof to !== "string" || typeof subject !== "string") {
        return { ok: false, error: "Invalid input" };
      }

      const hasInternet = await checkInternetNet();
      if (!hasInternet) {
        return { ok: false, offline: true };
      }

      const safeText = typeof text === "string" ? text : text != null ? String(text) : undefined;
      const safeHtml = typeof html === "string" ? html : html != null ? String(html) : undefined;

      const info = await sendSmtpEmail({
        to: (to as string).trim(),
        subject: (subject as string).trim(),
        text: safeText,
        html: safeHtml,
      });
      logger.info("[mail] sendEmail ok", { userId: user.id, to });
      return { ok: true, info };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[mail] sendEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** CRM: załaduj ofertę do edycji (format dla draft store). Owner lub BOSS/ADMIN. */
  ipcMain.handle("planlux:loadOfferForEdit", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", draft: null };
      const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(offerId) as Record<string, unknown> | undefined;
      if (!row) return { ok: false, error: "Oferta nie znaleziona", draft: null };
      const clientName = [row.client_first_name, row.client_last_name].filter(Boolean).join(" ") || (row.company_name as string) || "";
      const addons = (() => {
        try {
          const arr = JSON.parse((row.addons_snapshot as string) || "[]") as Array<{ nazwa?: string; name?: string; ilosc?: number; quantity?: number }>;
          return arr.map((a) => ({ nazwa: a.nazwa ?? a.name ?? "", ilosc: a.ilosc ?? a.quantity ?? 1 }));
        } catch {
          return [];
        }
      })();
      const draft = {
        draftId: row.id,
        variantHali: row.variant_hali ?? "T18_T35_DACH",
        widthM: String(row.width_m ?? ""),
        lengthM: String(row.length_m ?? ""),
        heightM: row.height_m != null ? String(row.height_m) : "",
        clientName: clientName || (row.company_name as string) || "",
        clientNip: row.nip ?? "",
        clientEmail: row.email ?? "",
        clientPhone: row.phone ?? "",
        addons,
        pdfOverrides: {},
        offerNumber: row.offer_number ?? "",
        offerNumberLocked: true,
        updatedAt: new Date().toISOString(),
        lastPreviewAt: null,
      };
      return { ok: true, draft };
    } catch (e) {
      logger.error("[crm] loadOfferForEdit failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), draft: null };
    }
  });

  const PDF_EDITOR_CONTENT_PATH = path.join(app.getPath("userData"), "pdf-editor-content.json");
  ipcMain.handle("planlux:loadPdfEditorContent", async () => {
    try {
      if (!fs.existsSync(PDF_EDITOR_CONTENT_PATH)) return { ok: true, content: null };
      const raw = fs.readFileSync(PDF_EDITOR_CONTENT_PATH, "utf-8");
      const content = JSON.parse(raw);
      return { ok: true, content };
    } catch (e) {
      logger.error("[pdf] loadPdfEditorContent failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:savePdfEditorContent", async (_, content: unknown) => {
    try {
      fs.mkdirSync(path.dirname(PDF_EDITOR_CONTENT_PATH), { recursive: true });
      fs.writeFileSync(PDF_EDITOR_CONTENT_PATH, JSON.stringify(content, null, 0), "utf-8");
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] savePdfEditorContent failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Dev: ścieżka szablonu + następna nazwa pliku testowego (oferta-test-YYYYMMDD-HHmmss.pdf). */
  ipcMain.handle("planlux:getPdfDebugInfo", async () => {
    try {
      const templateDir = getPdfTemplateDir();
      return { ok: true, templateDir: templateDir ?? null, nextTestFileName: getTestPdfFileName() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:getPdfPreviewHtml", async (_, payload: unknown, templateConfig: unknown) => {
    try {
      const templateDir = getPdfTemplateDir();
      if (!templateDir) {
        return { ok: false, error: "Szablon PDF nie znaleziony" };
      }
      const offerDate = new Date().toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const offerPayload = mapOfferDataToPayload(payload as GeneratePdfPayload, offerDate);
      const html = getPreviewHtmlWithInlinedAssets(
        templateDir,
        offerPayload,
        (templateConfig as Record<string, unknown>) ?? undefined
      );
      return { ok: true, html };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] getPdfPreviewHtml failed", e);
      return { ok: false, error: errMsg };
    }
  });

  ipcMain.handle("planlux:getPdfs", async () => {
    try {
      const user = requireRole(["ADMIN", "SZEF"]);
      const db = getDb();
      const rows = db.prepare(
        `SELECT p.id, p.user_id, p.offer_id, p.client_name, p.variant_hali, p.file_name, p.file_path, p.status, p.created_at,
          u.display_name as user_display_name
         FROM pdfs p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100`
      ).all();
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("getPdfs failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getEmails", async () => {
    try {
      const user = requireRole(["ADMIN", "SZEF"]);
      const db = getDb();
      const hasEmailHistory = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_history'").all() as Array<{ name: string }>).length > 0;
      if (hasEmailHistory) {
        const rows = db.prepare(
          `SELECT eh.id, eh.offer_id, eh.user_id, eh.from_email, eh.to_email, eh.subject, eh.sent_at, eh.status, eh.error_message, eh.created_at,
            u.display_name as user_display_name
           FROM email_history eh
           LEFT JOIN users u ON eh.user_id = u.id
           ORDER BY eh.created_at DESC LIMIT 100`
        ).all();
        return { ok: true, data: rows };
      }
      const rows = db.prepare("SELECT * FROM emails ORDER BY created_at DESC LIMIT 100").all();
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("getEmails failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getOutboxCount", async () => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT COUNT(*) as c FROM outbox WHERE processed_at IS NULL").get() as { c: number };
      return { ok: true, count: row.c };
    } catch (e) {
      return { ok: true, count: 0 };
    }
  });

  ipcMain.handle("shell:openPath", async (_, filePath: string) => {
    try {
      const err = await shell.openPath(filePath);
      return { ok: !err, error: err || undefined };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("shell:showItemInFolder", async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  /** Online = Supabase or backend health check (strict timeout, no secrets in logs). */
  ipcMain.handle("planlux:isOnline", wrap("planlux:isOnline", async () => {
    try {
      const appConfig = getConfig();
      const { getOnlineState } = await import("./net/online");
      const state = await getOnlineState({
        timeoutMs: appConfig.backend.healthTimeoutMs,
        backendUrl: appConfig.backend.url,
      });
      const online = state === "online";
      return { ok: true, online };
    } catch {
      return { ok: true, online: false };
    }
  }));

  /** Public config for renderer (no secrets). */
  ipcMain.handle("planlux:getConfig", wrap("planlux:getConfig", async () => {
    const publicConfig = getPublicConfig(getConfig());
    return { ok: true, ...publicConfig };
  }));

/** Real Internet check via Electron net.request (no navigator.onLine). */
ipcMain.handle("planlux:checkInternet", async () => {
  try {
    console.log("[IPC] planlux:checkInternet called");
    const online = await checkInternetNet();
    return { ok: true, online };
  } catch (e) {
    logger.warn("[checkInternet] error", e);
    return { ok: true, online: false };
  }
});
console.log("[IPC] handler registered: planlux:checkInternet");

  // ---------- SMTP accounts & email outbox (secure store, offline-first) ----------
  const {
    checkInternet: checkInternetEmail,
    enqueueEmail,
    sendNow,
    processOutbox,
    startOutboxWorker,
  } = await import("./emailService");
  const { setPassword: secureSetPassword, setSmtpPassword, getPassword: secureGetPassword, getSmtpPassword: secureGetSmtpPassword, getSmtpKeytarAccountKey, deletePassword: secureDeletePassword, deleteSmtpPassword, isKeytarAvailable } = await import("./secureStore");
  const { getAccountByUserId, buildTransportForUser, getEmailSettings, setEmailSetting, sendOfferEmailNow, renderTemplate } = await import("./emailService");

  startOutboxWorker(getDb as () => import("./emailService").Db, logger);

  ipcMain.handle("planlux:smtp:listAccounts", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const isAdminOrBoss = user.role === "ADMIN" || user.role === "SZEF";
      let rows: Array<Record<string, unknown>>;
      if (isAdminOrBoss) {
        rows = db.prepare("SELECT id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at FROM smtp_accounts ORDER BY is_default DESC, created_at ASC").all() as Array<Record<string, unknown>>;
      } else {
        rows = db.prepare("SELECT id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at FROM smtp_accounts WHERE user_id = ? ORDER BY created_at ASC").all(user.id) as Array<Record<string, unknown>>;
      }
      const withPasswordStatus = await Promise.all(rows.map(async (r) => {
        const uid = r.user_id as string | null;
        const hasPassword = uid
          ? !!(await secureGetSmtpPassword(uid))
          : !!(await secureGetPassword(r.id as string));
        const secure = r.secure === 1 || r.secure === true || String(r.secure).toLowerCase() === "true" ? 1 : 0;
        return { ...r, hasPassword, secure };
      }));
      return { ok: true, accounts: withPasswordStatus };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      const ser = serializeError(e);
      logger.error("[smtp] listAccounts failed", { message: ser.message, code: ser.code, reason: ser.reason });
      return { ok: false, error: ser.message };
    }
  });

  ipcMain.handle("planlux:smtp:upsertAccount", async (_, payload: unknown) => {
    try {
      requireRole(["ADMIN"]);
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { id?: string; name?: string; from_name?: string; from_email?: string; host?: string; port?: number; secure?: boolean; auth_user?: string; password?: string; reply_to?: string; is_default?: boolean };
      const id = (p.id && typeof p.id === "string") ? p.id : uuid();
      const name = (p.name && typeof p.name === "string") ? p.name : "";
      const from_name = (p.from_name && typeof p.from_name === "string") ? p.from_name : "";
      const from_email = (p.from_email && typeof p.from_email === "string") ? p.from_email.trim() : "";
      const host = (p.host && typeof p.host === "string") ? p.host.trim() : "";
      const port = typeof p.port === "number" ? p.port : 587;
      const secure = p.secure === true ? 1 : 0;
      const auth_user = (p.auth_user && typeof p.auth_user === "string") ? p.auth_user.trim() : from_email;
      const reply_to = (p.reply_to && typeof p.reply_to === "string") ? p.reply_to.trim() : null;
      const is_default = p.is_default === true ? 1 : 0;
      const now = new Date().toISOString();
      const db = getDb();
      const existing = db.prepare("SELECT id FROM smtp_accounts WHERE id = ?").get(id);
      if (existing) {
        db.prepare(
          "UPDATE smtp_accounts SET name=?, from_name=?, from_email=?, host=?, port=?, secure=?, auth_user=?, reply_to=?, is_default=?, updated_at=? WHERE id=?"
        ).run(name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, now, id);
        if (typeof p.password === "string" && p.password.length > 0) {
          await secureSetPassword(id, p.password);
        }
      } else {
        db.prepare(
          "INSERT INTO smtp_accounts (id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)"
        ).run(id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, now, now);
        if (typeof p.password === "string" && p.password.length > 0) {
          await secureSetPassword(id, p.password);
        }
      }
      if (is_default === 1) {
        db.prepare("UPDATE smtp_accounts SET is_default = 0 WHERE id != ?").run(id);
      }
      return { ok: true, id };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      const ser = serializeError(e);
      logger.error("[smtp] upsertAccount failed", { message: ser.message, code: ser.code, reason: ser.reason });
      return { ok: false, error: ser.message };
    }
  });

  ipcMain.handle("planlux:smtp:setDefaultAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      getDb().prepare("UPDATE smtp_accounts SET is_default = 0").run();
      getDb().prepare("UPDATE smtp_accounts SET is_default = 1 WHERE id = ?").run(accountId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  function smtpTestDebugId(): string {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
  }

  function smtpTestUserFriendlyMessage(rawError: string, debugId: string): string {
    const msg = (rawError || "").toLowerCase();
    let base: string;
    if (/eauth|invalid login|535|authentication failed|auth failed/i.test(msg)) {
      base = "Błąd logowania SMTP: sprawdź login/hasło oraz czy konto pocztowe istnieje na serwerze.";
    } else if (/esocket|etimedout|econnrefused|enotfound|econnreset|network|timeout/i.test(msg)) {
      base = "Brak połączenia / firewall / port.";
    } else if (/self signed|tls|wrong_version|certificate|unable to verify/i.test(msg)) {
      base = "Problem TLS – sprawdź secure/port.";
    } else {
      base = "Połączenie SMTP nie powiodło się.";
    }
    return `${base} Identyfikator debug: ${debugId}`;
  }

  ipcMain.handle("planlux:smtp:testAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb() as import("./emailService").Db;
      const row = db.prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(accountId) as import("./emailService").SmtpAccountRow | undefined;
      if (!row) return { ok: false, error: "Konto nie znalezione", debugId: undefined };
      const { buildTransport, verifyTransport, normalizeSmtpPortSecure } = await import("./emailService");
      const { port: normPort } = normalizeSmtpPortSecure(Number(row.port) || 587, row.secure === 1);
      const loggerWithStack = {
        error: (msg: string, e?: unknown) => {
          const stack = e && typeof e === "object" && "stack" in e ? String((e as { stack?: string }).stack) : undefined;
          const response = e && typeof e === "object" && "response" in e ? String((e as { response?: string }).response) : undefined;
          logger.warn(msg, e);
          if (stack) logger.warn("[smtp] verify error stack", { stack });
          if (response) logger.warn("[smtp] verify server response", { response });
        },
      };
      let transporter = await buildTransport(db, row);
      let result = await verifyTransport(transporter, loggerWithStack);
      if (result.ok) return { ok: true };
      if (result.needFallback && normPort === 465) {
        logger.info("[smtp] testAccount fallback: próba port 587 (STARTTLS)");
        transporter = await buildTransport(db, row, { port: 587, secure: false });
        result = await verifyTransport(transporter, loggerWithStack);
      }
      if (result.ok) return { ok: true };
      const debugId = smtpTestDebugId();
      logger.warn("[smtp] testAccount failed. If sending works for this account, test path had mismatched credentials.", { debugId, error: result.error, response: result.response, stack: result.stack });
      return {
        ok: false,
        error: smtpTestUserFriendlyMessage(result.error, debugId),
        rawError: result.error,
        stack: result.stack,
        response: result.response,
        debugId,
      };
    } catch (e) {
      const ser = serializeError(e);
      const debugId = smtpTestDebugId();
      logger.warn("[smtp] testAccount failed. If sending works for this account, test path had mismatched credentials.", { debugId, message: ser.message, stack: ser.stack });
      return {
        ok: false,
        error: smtpTestUserFriendlyMessage(ser.message, debugId),
        rawError: ser.message,
        stack: ser.stack,
        debugId,
      };
    }
  });

  ipcMain.handle("planlux:smtp:deleteAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      await secureDeletePassword(accountId);
      getDb().prepare("UPDATE smtp_accounts SET active = 0 WHERE id = ?").run(accountId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:smtp:isKeytarAvailable", async () => ({ ok: true, available: isKeytarAvailable() }));

  /** DEV/diagnostic: clear SMTP password for a user so that next send/test forces re-entry. Resolves by userId/email/current user. */
  ipcMain.handle(
    "planlux:smtp:clearPasswordForUser",
    async (_, payload?: { userId?: string; email?: string }) => {
      try {
        const user = requireAuth();
        const db = getDb();
        let targetUserId: string | null = null;
        let targetEmail: string | null = null;

        if (payload && typeof payload === "object" && typeof payload.userId === "string") {
          targetUserId = payload.userId;
          const row = db
            .prepare("SELECT email FROM users WHERE id = ? AND active = 1")
            .get(targetUserId) as { email?: string } | undefined;
          targetEmail = row?.email ?? null;
        } else if (payload && typeof payload === "object" && typeof payload.email === "string") {
          const row = db
            .prepare("SELECT id, email FROM users WHERE email = ? AND active = 1")
            .get(payload.email.trim().toLowerCase()) as { id?: string; email?: string } | undefined;
          targetUserId = row?.id ?? null;
          targetEmail = row?.email ?? payload.email;
        } else {
          targetUserId = user.id;
          targetEmail = user.email;
        }

        if (!targetUserId) return { ok: false, error: "Użytkownik nie znaleziony" };
        if (user.role === "HANDLOWIEC" && targetUserId !== user.id) {
          return { ok: false, error: "Forbidden" };
        }

        const accountKey = getSmtpKeytarAccountKey(targetUserId);
        const deleted = await deleteSmtpPassword(targetUserId);
        console.log("KEYTAR ENTRY CLEARED:", targetEmail ?? "(unknown)", "accountKey:", accountKey, "deleted:", deleted);
        return { ok: true, deleted, accountKey };
      } catch (e) {
        const ser = serializeError(e);
        logger.warn("[smtp] clearPasswordForUser failed", { message: ser.message, stack: ser.stack });
        return { ok: false, error: ser.message };
      }
    }
  );

  /** Per-user: SMTP config for current user (no password). */
  ipcMain.handle("planlux:smtp:getForCurrentUser", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const row = getAccountByUserId(db as import("./emailService").Db, user.id);
      if (!row) return { ok: true, account: null };
      const r = row as Record<string, unknown>;
      const secureVal = row.secure as number | boolean | string | undefined;
      const secure = secureVal === 1 || secureVal === true || String(secureVal).toLowerCase() === "true" ? 1 : 0;
      return { ok: true, account: { id: row.id, user_id: row.user_id, name: row.name, from_name: row.from_name, from_email: row.from_email, host: row.host, port: row.port, secure, auth_user: row.auth_user, reply_to: row.reply_to, active: row.active, created_at: r.created_at, updated_at: r.updated_at } };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Upsert SMTP for a user. SALESPERSON can only update self; ADMIN/BOSS can update any user. */
  ipcMain.handle("planlux:smtp:upsertForUser", async (_, payload: unknown) => {
    try {
      const user = requireAuth();
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { targetUserId?: string; from_name?: string; from_email?: string; host?: string; port?: number; secure?: boolean | number; auth_user?: string; smtpPass?: string; reply_to?: string };
      const targetUserId = (typeof p.targetUserId === "string" ? p.targetUserId : null) ?? user.id;
      if (user.role === "HANDLOWIEC" && targetUserId !== user.id) return { ok: false, error: "Forbidden" };
      const db = getDb();
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(targetUserId) as { email: string } | undefined;
      if (!userRow) return { ok: false, error: "Użytkownik nie znaleziony" };
      const from_email = (typeof p.from_email === "string" ? p.from_email.trim() : null) ?? userRow.email;
      const from_name = (typeof p.from_name === "string" ? p.from_name.trim() : "") || from_email;
      const host = (typeof p.host === "string" ? p.host.trim() : "") || "";
      const port = typeof p.port === "number" ? p.port : (typeof p.port === "string" ? parseInt(p.port, 10) : NaN) || 465;
      const secure = (p.secure === true || p.secure === 1) ? 1 : 0;
      const auth_user = (typeof p.auth_user === "string" ? p.auth_user.trim() : null) ?? from_email;
      const reply_to = (typeof p.reply_to === "string" ? p.reply_to.trim() : null) || null;
      const now = new Date().toISOString();
      const existing = db.prepare("SELECT id FROM smtp_accounts WHERE user_id = ?").get(targetUserId) as { id: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE smtp_accounts SET from_name=?, from_email=?, host=?, port=?, secure=?, auth_user=?, reply_to=?, updated_at=? WHERE user_id=?"
        ).run(from_name, from_email, host, port, secure, auth_user, reply_to, now, targetUserId);
      } else {
        const id = uuid();
        db.prepare(
          "INSERT INTO smtp_accounts (id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,1,?,?)"
        ).run(id, targetUserId, "", from_name, from_email, host, port, secure, auth_user, reply_to, now, now);
      }
      if (typeof p.smtpPass === "string" && p.smtpPass.length > 0) {
        await setSmtpPassword(targetUserId, p.smtpPass);
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      const ser = serializeError(e);
      logger.error("[smtp] upsertForUser failed", { message: ser.message, code: ser.code, reason: ser.reason });
      return { ok: false, error: ser.message };
    }
  });

  /** Test SMTP connection for a user. Uses same credential source as send (getCredentialsForAccount + buildTransportFromConfig). Optional smtpPass overwrites keytar before test. */
  ipcMain.handle("planlux:smtp:testForUser", async (_, userIdOrPayload?: string | { userId?: string; smtpPass?: string }) => {
    try {
      const user = requireAuth();
      const payload = typeof userIdOrPayload === "object" && userIdOrPayload != null
        ? userIdOrPayload
        : { userId: typeof userIdOrPayload === "string" ? userIdOrPayload : undefined };
      const targetUserId = (typeof payload.userId === "string" ? payload.userId : null) ?? user.id;
      const smtpPass = typeof payload.smtpPass === "string" ? payload.smtpPass : undefined;
      if (user.role === "HANDLOWIEC" && targetUserId !== user.id) return { ok: false, error: "Forbidden", debugId: undefined };
      const db = getDb() as import("./emailService").Db;
      const { getAccountByUserId, buildTransportForUser, verifyTransport, normalizeSmtpPortSecure } = await import("./emailService");
      const account = getAccountByUserId(db, targetUserId);
      if (!account) return { ok: false, error: "Brak konfiguracji SMTP dla użytkownika", debugId: undefined };
      if (smtpPass != null && smtpPass.length > 0) {
        await setSmtpPassword(targetUserId, smtpPass);
      }
      const port = Number(account.port) || 587;
      const secureVal = account.secure as number | boolean | string | undefined;
      const secure = secureVal === 1 || secureVal === true || String(secureVal).toLowerCase() === "true";
      const { port: normPort, secure: normSecure } = normalizeSmtpPortSecure(port, secure);
      logger.info("[smtp] testForUser (no password in logs)", { host: account.host, port: normPort, secure: normSecure, user_id: targetUserId, auth_user: account.auth_user || account.from_email, from_email: account.from_email });
      if (/smtp\.cyberfolks\.pl/i.test(account.host)) {
        logger.warn("[smtp] Dla CyberFolks użyj hosta poczta.cyberfolks.pl zamiast smtp.cyberfolks.pl", { host: account.host });
      }
      if (/gmail\.com|googlemail\.com/i.test(account.host)) {
        logger.warn("[smtp] Gmail: upewnij się, że używasz Hasła aplikacji (App Password), nie zwykłego hasła do konta Google.");
      }
      const loggerWithStack = {
        error: (msg: string, e?: unknown) => {
          const stack = e && typeof e === "object" && "stack" in e ? String((e as { stack?: string }).stack) : undefined;
          const response = e && typeof e === "object" && "response" in e ? String((e as { response?: string }).response) : undefined;
          logger.warn(msg, e);
          if (stack) logger.warn("[smtp] verify error stack", { stack });
          if (response) logger.warn("[smtp] verify server response", { response });
        },
      };
      let transporter = await buildTransportForUser(db, targetUserId);
      let result = await verifyTransport(transporter, loggerWithStack);
      if (result.ok) return { ok: true };
      if (result.needFallback && normPort === 465) {
        logger.info("[smtp] testForUser fallback: próba port 587 (STARTTLS)");
        transporter = await buildTransportForUser(db, targetUserId, { port: 587, secure: false });
        result = await verifyTransport(transporter, loggerWithStack);
      }
      if (result.ok) return { ok: true };
      const debugId = smtpTestDebugId();
      logger.warn("[smtp] testForUser failed (no password in logs)", { debugId, userId: targetUserId, host: account.host, port: normPort, secure: normSecure, from_email: account.from_email, error: result.error, response: result.response });
      return {
        ok: false,
        error: smtpTestUserFriendlyMessage(result.error, debugId),
        rawError: result.error,
        stack: result.stack,
        response: result.response,
        debugId,
      };
    } catch (e) {
      const ser = serializeError(e);
      const debugId = smtpTestDebugId();
      logger.warn("[smtp] testForUser failed (no password in logs)", { debugId, message: ser.message, code: ser.code, stack: ser.stack });
      return {
        ok: false,
        error: smtpTestUserFriendlyMessage(ser.message, debugId),
        rawError: ser.message,
        code: ser.code,
        reason: ser.reason,
        stack: ser.stack,
        debugId,
      };
    }
  });

  ipcMain.handle("planlux:settings:getEmailSettings", async () => {
    try {
      requireAuth();
      const db = getDb() as import("./emailService").Db;
      const settings = getEmailSettings(db);
      return { ok: true, settings };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:settings:updateEmailSettings", async (_, payload: unknown) => {
    try {
      requireRole(["ADMIN"]);
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { office_cc_email?: string; office_cc_default_enabled?: boolean; email_template_subject?: string; email_template_body_html?: string; email_template_body_text?: string };
      const db = getDb();
      if (typeof p.office_cc_email === "string") setEmailSetting(db as import("./emailService").Db, "office_cc_email", p.office_cc_email);
      if (typeof p.office_cc_default_enabled === "boolean") setEmailSetting(db as import("./emailService").Db, "office_cc_default_enabled", p.office_cc_default_enabled ? "1" : "0");
      if (typeof p.email_template_subject === "string") setEmailSetting(db as import("./emailService").Db, "email_template_subject", p.email_template_subject);
      if (typeof p.email_template_body_html === "string") setEmailSetting(db as import("./emailService").Db, "email_template_body_html", p.email_template_body_html);
      if (typeof p.email_template_body_text === "string") setEmailSetting(db as import("./emailService").Db, "email_template_body_text", p.email_template_body_text);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Preview subject/body for offer email (templates + vars). */
  ipcMain.handle("planlux:email:getOfferEmailPreview", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", subject: "", bodyHtml: "", bodyText: "" };
      const settings = getEmailSettings(db as import("./emailService").Db);
      const offerRow = db.prepare("SELECT offer_number, client_first_name, client_last_name, company_name, user_id FROM offers_crm WHERE id = ?").get(offerId) as { offer_number: string; client_first_name: string; client_last_name: string; company_name: string; user_id: string } | undefined;
      if (!offerRow) return { ok: true, subject: settings.email_template_subject, bodyHtml: settings.email_template_body_html, bodyText: settings.email_template_body_text };
      const salespersonRow = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(user.id) as { display_name: string | null; email: string } | undefined;
      const clientName = [offerRow.client_first_name, offerRow.client_last_name].filter(Boolean).join(" ") || offerRow.company_name || "";
      const templateVars: Record<string, string> = {
        offerNumber: offerRow.offer_number || "",
        clientName,
        companyName: offerRow.company_name || "",
        salespersonName: salespersonRow?.display_name?.trim() || salespersonRow?.email || "",
        salespersonEmail: salespersonRow?.email || "",
        date: new Date().toLocaleDateString("pl-PL"),
      };
      const subject = renderTemplate(settings.email_template_subject, templateVars);
      const bodyHtml = renderTemplate(settings.email_template_body_html, templateVars);
      const bodyText = renderTemplate(settings.email_template_body_text, templateVars);
      return { ok: true, subject, bodyHtml, bodyText, officeCcDefault: settings.office_cc_default_enabled, officeCcEmail: settings.office_cc_email };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message, subject: "", bodyHtml: "", bodyText: "" };
      return { ok: false, error: e instanceof Error ? e.message : String(e), subject: "", bodyHtml: "", bodyText: "" };
    }
  });

  /** Send offer email: templates, CC to office, auto PDF. Idempotencja: jeden mail na (offerId+to+subject+pdf) w 5 min. */
  ipcMain.handle("planlux:email:sendOfferEmail", wrap("planlux:email:sendOfferEmail", async (_, payload: unknown) => {
    try {
      logger.info("[IPC] sendOfferEmail TS_VERSION=2026-03-02-email-history-fix");
      const user = requireAuth();
      if (!user?.id) {
        return { ok: false, code: "ERR_NO_USER", message: "Brak zalogowanego użytkownika — nie można wysłać e-maila.", error: "Brak user_id", details: "currentUser.id missing" };
      }
      if (!payload || typeof payload !== "object") return { ok: false, code: "ERR_INVALID_PAYLOAD", message: "Invalid payload", error: "Invalid payload" };
      const p = payload as { offerId?: string; offerNumber?: string; offer_number?: string; number?: string; to: string; ccOfficeEnabled?: boolean; subjectOverride?: string; bodyOverride?: string; sendAsUserId?: string; extraAttachments?: Array<{ filename: string; path: string }> };
      const db = getDb();
      const offerInputRaw = p.offerId ?? p.offerNumber ?? p.offer_number ?? p.number;
      const offerInput = (typeof offerInputRaw === "string" ? offerInputRaw : "").trim();
      if (!offerInput) return { ok: false, code: "ERR_MISSING_OFFER", message: "Oferta i adres odbiorcy są wymagane", error: "Oferta i adres odbiorcy są wymagane" };
      let resolvedOfferId: string | null = resolveOfferId(db, offerInput);
      if (!resolvedOfferId) {
        try {
          const { ensureOfferCrmRow } = await import("../src/infra/db");
          resolvedOfferId = ensureOfferCrmRow(db, offerInput);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const errMsg = msg.includes("nie istnieje w bazie CRM") ? msg : "Oferta nie znaleziona (nieprawidłowy identyfikator lub numer oferty)";
          return { ok: false, code: "ERR_NOT_FOUND", message: errMsg, error: errMsg };
        }
      }
      if (!resolvedOfferId) {
        throw new Error("sendOfferEmail: resolvedOfferId is null – cannot insert email_history");
      }
      const parent = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(resolvedOfferId);
      if (!parent) {
        throw new Error("sendOfferEmail: offers_crm row missing for offer_id=" + resolvedOfferId);
      }
      const toInput = typeof p.to === "string" ? p.to.trim() : "";
      const toEmails = parseRecipients(toInput);
      const to = toEmails.join(", ");
      if (!to) return { ok: false, code: "ERR_NO_TO", message: "Adres odbiorcy jest wymagany", error: "Adres odbiorcy jest wymagany" };
      if (!canAccessOffer(db, resolvedOfferId, user.id)) return { ok: false, code: "ERR_NOT_FOUND", message: "Oferta nie znaleziona", error: "Oferta nie znaleziona" };
      const senderUserId = (user.role === "ADMIN" || user.role === "SZEF") && typeof p.sendAsUserId === "string" ? p.sendAsUserId : user.id;
      if (user.role === "HANDLOWIEC" && senderUserId !== user.id) return { ok: false, code: "ERR_FORBIDDEN", message: "Forbidden", error: "Forbidden" };
      const account = getAccountByUserId(db as import("./emailService").Db, senderUserId);
      if (!account) return { ok: false, code: "ERR_AUTH", message: "Skonfiguruj konto SMTP w Panelu admina (E-mail)", error: "Skonfiguruj konto SMTP w Panelu admina (E-mail)" };
      const effectiveUserId: string = senderUserId ?? user.id ?? (account as { user_id?: string }).user_id ?? "";
      const ehColsEarly = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
      const hasUserIdColEarly = ehColsEarly.some((c) => c.name === "user_id");
      if (hasUserIdColEarly && !effectiveUserId) {
        return { ok: false, code: "ERR_NO_USER", message: "Musisz być zalogowany, aby wysłać e-mail (brak user_id).", error: "Brak user_id", details: "effectiveUserId empty" };
      }
      const senderExists = db.prepare("SELECT id FROM users WHERE id = ? AND active = 1").get(effectiveUserId);
      if (!senderExists) return { ok: false, code: "ERR_FORBIDDEN", message: "Użytkownik nadawcy nie istnieje lub jest nieaktywny (FK)", error: "Użytkownik nadawcy nie istnieje lub jest nieaktywny (FK)" };

      try {
        const salespersonForInitial = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(senderUserId) as { display_name: string | null; email?: string } | undefined;
        finalizeOfferNumber(db as import("./db/types").DbLike, resolvedOfferId, { initial: getSalesInitial(salespersonForInitial ? { displayName: salespersonForInitial.display_name ?? undefined, email: salespersonForInitial.email } : null) });
      } catch (finalizeErr) {
        logger.warn("[email] finalizeOfferNumber before send failed (using current number)", finalizeErr);
      }
      const settings = getEmailSettings(db as import("./emailService").Db);
      const offerRow = db.prepare("SELECT offer_number, client_first_name, client_last_name, company_name, user_id FROM offers_crm WHERE id = ?").get(resolvedOfferId) as { offer_number: string; client_first_name: string; client_last_name: string; company_name: string; user_id: string } | undefined;
      if (!offerRow) return { ok: false, code: "ERR_NOT_FOUND", message: "Oferta nie znaleziona", error: "Oferta nie znaleziona" };
      const salespersonRow = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(senderUserId) as { display_name: string | null; email: string } | undefined;
      const clientName = [offerRow.client_first_name, offerRow.client_last_name].filter(Boolean).join(" ") || offerRow.company_name || "";
      const companyName = offerRow.company_name || "";
      const templateVars: Record<string, string> = {
        offerNumber: offerRow.offer_number || "",
        clientName,
        companyName,
        salespersonName: salespersonRow?.display_name?.trim() || salespersonRow?.email || "",
        salespersonEmail: salespersonRow?.email || "",
        date: new Date().toLocaleDateString("pl-PL"),
      };
      const subject = typeof p.subjectOverride === "string" && p.subjectOverride.trim()
        ? p.subjectOverride.trim()
        : renderTemplate(settings.email_template_subject, templateVars);
      const bodyHtml = typeof p.bodyOverride === "string" && p.bodyOverride.trim()
        ? p.bodyOverride.trim()
        : renderTemplate(settings.email_template_body_html, templateVars);
      const bodyText = typeof p.bodyOverride === "string" && p.bodyOverride.trim()
        ? p.bodyOverride.trim().replace(/<[^>]+>/g, " ").trim()
        : renderTemplate(settings.email_template_body_text, templateVars);

      logger.info("[email][DEBUG_PAYLOAD]", { payloadKeys: Object.keys(payload || {}), payload });
      const payloadRecord = payload as Record<string, unknown>;
      const bodyForHistory: string =
        (payloadRecord.bodyOverride ?? payloadRecord.body ?? payloadRecord.content ?? "") as string ||
        bodyHtml ||
        bodyText ||
        "";

      let cc = "";
      if (p.ccOfficeEnabled !== false && settings.office_cc_default_enabled !== false && settings.office_cc_email) {
        cc = settings.office_cc_email.trim();
      } else if (p.ccOfficeEnabled === true && settings.office_cc_email) {
        cc = settings.office_cc_email.trim();
      }

      const ensurePdfResult = await (async (): Promise<{ ok: boolean; filePath: string | null; fileName: string | null; error?: string }> => {
        const db = getDb();
        const existing = db.prepare("SELECT file_path, file_name FROM pdfs WHERE offer_id = ? AND file_path IS NOT NULL AND file_path != '' ORDER BY created_at DESC LIMIT 1").get(resolvedOfferId) as { file_path: string; file_name: string } | undefined;
        if (existing?.file_path && fs.existsSync(existing.file_path)) return { ok: true, filePath: existing.file_path, fileName: existing.file_name || "oferta.pdf" };
        const { generatePdfFromTemplate } = await import("./pdf/generatePdfFromTemplate");
        const store = createFilePdfTemplateConfigStore(app.getPath("userData"));
        const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(resolvedOfferId) as Record<string, unknown> | undefined;
        if (!row) return { ok: false, filePath: null, fileName: null, error: "Oferta nie znaleziona" };
        const clientName = [row.client_first_name, row.client_last_name].filter(Boolean).join(" ").trim() || (row.company_name as string) || "Klient";
        const addons = (() => { try { return JSON.parse((row.addons_snapshot as string) || "[]"); } catch { return []; } })();
        const standardInPrice = (() => { try { return JSON.parse((row.standard_snapshot as string) || "[]"); } catch { return []; } })();
        const areaM2 = Number(row.area_m2) || 0;
        const basePrice = Number(row.base_price_pln) || 0;
        const payload: GeneratePdfPayload = {
          userId: row.user_id as string,
          offer: { clientName, clientNip: (row.nip as string) ?? undefined, clientEmail: (row.email as string) ?? undefined, clientPhone: (row.phone as string) ?? undefined, widthM: Number(row.width_m) || 0, lengthM: Number(row.length_m) || 0, heightM: row.height_m != null ? Number(row.height_m) : undefined, areaM2, variantNazwa: (row.variant_hali as string) || "", variantHali: (row.variant_hali as string) || "" },
          pricing: { base: { totalBase: basePrice, cenaPerM2: areaM2 > 0 ? basePrice / areaM2 : undefined }, additions: addons, standardInPrice, totalPln: Number(row.total_pln) || 0 },
          offerNumber: (row.offer_number as string) || "PLX-?", sellerName: "Planlux",
        };
        const templateConfig = await store.load(resolvedOfferId).catch(() => null);
        const result = await generatePdfFromTemplate(payload, logger, templateConfig ?? undefined, undefined, undefined);
        if (!result.ok) return { ok: false, filePath: null, fileName: null, error: result.error ?? "Generowanie PDF nie powiodło się" };
        // Prevent duplicate insert: PDF must be inserted only once per offer. Reuse existing row if present.
        const existingPdf = db.prepare("SELECT id, file_path, file_name FROM pdfs WHERE offer_id = ? ORDER BY created_at DESC LIMIT 1").get(resolvedOfferId) as { id: string; file_path: string; file_name: string } | undefined;
        if (existingPdf?.file_path && fs.existsSync(existingPdf.file_path)) {
          return { ok: true, filePath: existingPdf.file_path, fileName: existingPdf.file_name || "oferta.pdf" };
        }
        const { insertPdf, getLatestPdfByOfferId } = await import("../src/infra/db");
        const parentExists = db.prepare("SELECT 1 FROM offers_crm WHERE id = ?").get(resolvedOfferId) != null;
        const pdfExists = getLatestPdfByOfferId(db, resolvedOfferId) != null;
        logger.info("[email] ensurePdf", { offerId: resolvedOfferId, offerNumber: (row.offer_number as string) ?? "(unknown)", parentExists, pdfExists, dbPath: getDbPath?.() ?? "(unknown)" });
        const pdfId = uuid();
        insertPdf(getDb(), { id: pdfId, offerId: resolvedOfferId, userId: (row.user_id as string) || user.id, clientName, fileName: result.fileName, filePath: result.filePath, status: "PDF_CREATED", totalPln: payload.pricing.totalPln, widthM: payload.offer.widthM, lengthM: payload.offer.lengthM, heightM: payload.offer.heightM ?? undefined, areaM2: payload.offer.areaM2, variantHali: payload.offer.variantHali });
        return { ok: true, filePath: result.filePath, fileName: result.fileName };
      })();
      if (!ensurePdfResult.ok) {
        const attachmentMsg = ensurePdfResult.error ?? "Nie udało się przygotować PDF oferty. Wygeneruj PDF przed wysłaniem e-mail.";
        return { ok: false, code: "ERR_NO_ATTACHMENT", message: attachmentMsg, error: attachmentMsg };
      }
      const extraAttachments = p.extraAttachments ?? [];
      const attachments: Array<{ filename: string; path: string }> = ensurePdfResult.filePath && ensurePdfResult.fileName
        ? [{ filename: ensurePdfResult.fileName, path: ensurePdfResult.filePath }, ...extraAttachments]
        : extraAttachments;
      if (attachments.length === 0) return { ok: false, code: "ERR_NO_ATTACHMENT", message: "Brak załącznika PDF do oferty" };
      const attachmentsJsonForHistory = JSON.stringify(attachments ?? []);

      const dateBucket5Min = Math.floor(Date.now() / 300_000).toString();
      const idempotencyKey = crypto.createHash("sha256").update(`${resolvedOfferId}|${to}|${subject}|${attachments[0]?.path ?? ""}|${dateBucket5Min}`).digest("hex");
      const ehColsForIdem = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
      const hasIdempotencyKey = ehColsForIdem.some((c) => c.name === "idempotency_key");
      const hasToAddr = ehColsForIdem.some((c) => c.name === "to_addr");
      const hasToEmail = ehColsForIdem.some((c) => c.name === "to_email");
      if (hasIdempotencyKey) {
        const existing = db.prepare("SELECT id FROM email_history WHERE idempotency_key = ? AND (status = 'sent' OR status = 'sent') LIMIT 1").get(idempotencyKey) as { id: string } | undefined;
        if (existing) {
          logger.info("[email] sendOfferEmail idempotent skip", { offerId: resolvedOfferId, to });
          return { ok: true, sent: true, alreadySent: true };
        }
      } else {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const existingByOffer = hasToAddr
          ? db.prepare("SELECT id FROM email_history WHERE offer_id = ? AND to_addr = ? AND subject = ? AND (status = 'sent' OR status = 'sent') AND created_at >= ? LIMIT 1").get(resolvedOfferId, to, subject, fiveMinAgo) as { id: string } | undefined
          : hasToEmail
            ? db.prepare("SELECT id FROM email_history WHERE offer_id = ? AND to_email = ? AND subject = ? AND (status = 'sent' OR status = 'sent') AND created_at >= ? LIMIT 1").get(resolvedOfferId, to, subject, fiveMinAgo) as { id: string } | undefined
            : undefined;
        if (existingByOffer) {
          logger.info("[email] sendOfferEmail idempotent skip (by offer/to/subject)", { offerId: resolvedOfferId, to });
          return { ok: true, sent: true, alreadySent: true };
        }
      }

      const online = await checkInternetEmail();
      if (!online) {
        const id = enqueueEmail(db as import("./emailService").Db, {
          to,
          cc: cc || undefined,
          subject,
          html: bodyHtml,
          text: bodyText,
          attachments,
          relatedOfferId: resolvedOfferId,
          accountUserId: senderUserId,
        }, logger);
        return { ok: true, queued: true, outboxId: id };
      }

      const result = await sendOfferEmailNow(db as import("./emailService").Db, {
        to,
        cc: cc || undefined,
        subject,
        bodyHtml,
        bodyText,
        attachments,
        accountUserId: senderUserId,
      }, logger);

      if (result.ok) {
        const now = new Date().toISOString();
        const outboxId = uuid();
        const historyId = uuid();
        const acceptedJson = result.accepted != null ? JSON.stringify(result.accepted) : null;
        const rejectedJson = result.rejected != null ? JSON.stringify(result.rejected) : null;
        const smtpResponse = result.response ?? null;
        const accountId = account?.id ?? null;
        logger.info("[email] resolved userId", { userId: effectiveUserId, account_user_id: senderUserId, accountId });
        try {
          db.transaction(() => {
            const emailHistoryStatus = allowedEmailHistoryStatus("sent");
            const emailHistoryStatusFail = allowedEmailHistoryStatus("failed");
            const outboxStatusSuccess = "sent";
            const outboxStatusFail = "failed";
            const offerStatusSuccess = "SENT";

            const offerExists = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(resolvedOfferId);
            if (!offerExists) throw new Error("[email] FK/consistency: oferta nie istnieje przed zapisem outbox");
            db.prepare("UPDATE offers_crm SET status = ?, emailed_at = ?, updated_at = ? WHERE id = ?").run(offerStatusSuccess, now, now, resolvedOfferId);
            db.prepare(
              `INSERT INTO email_outbox (id, account_id, account_user_id, to_addr, cc, subject, text_body, html_body, attachments_json, related_offer_id, status, retry_count, sent_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
            ).run(
              outboxId,
              accountId,
              senderUserId,
              to,
              cc || null,
              subject,
              bodyText,
              bodyHtml,
              JSON.stringify(attachments || []),
              resolvedOfferId,
              outboxStatusSuccess,
              now,
              now,
              now
            );
            const outboxExists = db.prepare("SELECT id FROM email_outbox WHERE id = ?").get(outboxId);
            if (!outboxExists) throw new Error("[email] FK diagnostic: email_outbox row missing after INSERT");
            const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
            if (auditTables.length > 0) {
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_SENT', ?)").run(
                uuid(), resolvedOfferId, user.id, JSON.stringify({ to, outboxId })
              );
            }
            const ehCols = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
            const hasOfferIdCol = ehCols.some((c) => c.name === "offer_id");
            const hasIdemCol = ehCols.some((c) => c.name === "idempotency_key");
            const hasToAddr = ehCols.some((c) => c.name === "to_addr");
            const hasToEmail = ehCols.some((c) => c.name === "to_email");
            const hasUserIdCol = ehCols.some((c) => c.name === "user_id");
            if (hasUserIdCol && !effectiveUserId) throw new Error("[email] effectiveUserId required for email_history.user_id");
            const fromEmail = (account as { from_email?: string }).from_email ?? "";
            const toRecipient = to ?? "";
            logger.info("[email][DEBUG_PAYLOAD]", { payloadKeys: Object.keys(payload || {}), payload });
            logger.info("[EMAIL_DEBUG] inserting email_history.status", {
              statusValue: emailHistoryStatus,
              type: typeof emailHistoryStatus,
            });
            if (hasOfferIdCol && (hasToAddr || hasToEmail)) {
              if (hasUserIdCol) {
                if (hasIdemCol) {
                  if (hasToEmail && hasToAddr) {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                  } else if (hasToEmail) {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                  } else {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                  }
                } else {
                  if (hasToEmail && hasToAddr) {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                  } else if (hasToEmail) {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                  } else {
                    db.prepare(
                      "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                    ).run(historyId, outboxId, accountId, effectiveUserId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                  }
                }
              } else if (hasIdemCol) {
                if (hasToEmail && hasToAddr) {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                } else if (hasToEmail) {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                } else {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId, idempotencyKey);
                }
              } else {
                if (hasToEmail && hasToAddr) {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                } else if (hasToEmail) {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                } else {
                  db.prepare(
                    "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_addr, subject, body, attachments_json, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at, offer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
                  ).run(historyId, outboxId, accountId, fromEmail, toRecipient, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now, resolvedOfferId);
                }
              }
            } else if (hasOfferIdCol && hasToEmail && hasUserIdCol) {
              const fromE = (account as { from_email?: string }).from_email ?? "";
              db.prepare(
                "INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, resolvedOfferId, effectiveUserId, fromE, to, subject, bodyForHistory, attachmentsJsonForHistory, emailHistoryStatus, now, now);
            }
          })();
          try {
            const fromEmailForSheets = (account as { from_email?: string }).from_email ?? user.email ?? "";
            const logEmailPayload = {
              id: historyId,
              userId: user.id,
              userEmail: user.email,
              toEmail: to,
              subject,
              status: "sent" as const,
              sentAt: now,
              fromEmail: fromEmailForSheets,
              offerId: resolvedOfferId,
            };
            db.prepare(
              "INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'LOG_EMAIL', ?, 0, 5)"
            ).run(uuid(), JSON.stringify(logEmailPayload));
            const { flushOutbox } = await import("@planlux/shared");
            const { createOutboxStorage } = await import("../src/db/outboxStorage");
            const { sendEmail: sendGenericEmailSmtp } = await import("./mail");
            const r = await flushOutbox({
              api: apiClient,
              storage: createOutboxStorage(db as Parameters<typeof createOutboxStorage>[0]),
              isOnline: () => true,
              sendEmail: createSendEmailForFlush(getDb),
              sendGenericEmail: async (payload) => {
                await sendGenericEmailSmtp({ to: payload.to, subject: payload.subject, text: payload.text, html: payload.html });
              },
            }) as { processed: number; failed: number; firstError?: { code?: string; message: string; details?: unknown } };
            if (r.processed > 0 && !r.firstError) {
              logger.info("[email] Logged to Sheets", { id: logEmailPayload.id, offerId: resolvedOfferId });
            }
            if (r.firstError) {
              logger.warn("[email] Sheets logEmail failed (diagnostic)", { payloadId: logEmailPayload.id, offerId: resolvedOfferId, error: r.firstError });
              return { ok: true, sent: true, sheetsError: r.firstError };
            }
          } catch (logErr) {
            logger.warn("[email] LOG_EMAIL enqueue failed (outbox)", logErr);
          }
        } catch (txErr) {
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          logger.error("[email] sendOfferEmail history/outbox transaction failed (mail already sent)", txErr);
          const isCheckStatus = /CHECK constraint failed.*status|status IN \(.*sending|email_history.*status/i.test(msg);
          if (isCheckStatus) {
            try {
              const tablesWithStatusCheck = db.prepare(
                "SELECT name, sql FROM sqlite_master WHERE type='table' AND (sql LIKE '%sending%' OR sql LIKE '%queued%')"
              ).all() as Array<{ name: string; sql: string | null }>;
              const allTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
              if (process.env.NODE_ENV !== "production") {
                logger.info("[schema][DEBUG] tables_with_status_check", JSON.stringify(tablesWithStatusCheck, null, 2));
                logger.info("[schema][DEBUG] all_tables", JSON.stringify(allTables.map((r) => r.name)));
              } else {
                logger.warn("[schema][DEBUG] CHECK failed – tables_with_status_check (names only)", tablesWithStatusCheck.map((r) => r.name));
                if (tablesWithStatusCheck.length > 0) {
                  tablesWithStatusCheck.forEach((r) => logger.warn("[schema][DEBUG] CREATE " + r.name, r.sql ?? ""));
                }
              }
            } catch (schemaErr) {
              logger.warn("[schema][DEBUG] schema dump failed", schemaErr);
            }
            try {
              const { runEmailHistoryUnifiedStep } = await import("./migrations/crmMigrations");
              runEmailHistoryUnifiedStep(getDb() as Parameters<typeof runEmailHistoryUnifiedStep>[0], logger);
              logger.info("[email] email_history schema repaired after CHECK constraint failure – spróbuj wysłać ponownie");
            } catch (migErr) {
              logger.warn("[email] runEmailHistoryUnifiedStep after CHECK failure", migErr);
            }
          }
          const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
          if (auditTables.length > 0) {
            try {
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_HISTORY_WRITE_FAILED', ?)").run(
                uuid(), resolvedOfferId, user.id, JSON.stringify({ to, error: msg, code: "ERR_HISTORY_WRITE" })
              );
            } catch (_) {}
          }
          const historyMsg = "E-mail został wysłany, ale nie zapisano go w historii. Sprawdź logi i bazę. Przy błędzie CHECK – tabela została naprawiona, wyślij e-mail ponownie.";
          return { ok: false, code: "ERR_HISTORY_WRITE", message: historyMsg, error: historyMsg, details: txErr instanceof Error ? txErr.stack : undefined };
        }
        return { ok: true, sent: true };
      }

      const errMsg = result.error ?? "Serwer SMTP nie przyjął wiadomości";
      const errLower = errMsg.toLowerCase();
      const code = /timeout|etimedout/i.test(errMsg) ? "ERR_TIMEOUT" : /auth|login|credentials|invalid.*user|535/i.test(errLower) ? "ERR_AUTH" : "ERR_SMTP";
      const now = new Date().toISOString();
      const historyId = uuid();
      try {
        const ehCols = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
        const hasOfferId = ehCols.some((c) => c.name === "offer_id");
        const hasError = ehCols.some((c) => c.name === "error");
        const hasErrorMessage = ehCols.some((c) => c.name === "error_message");
        const hasToAddr = ehCols.some((c) => c.name === "to_addr");
        const hasToEmail = ehCols.some((c) => c.name === "to_email");
        const hasUserIdColFail = ehCols.some((c) => c.name === "user_id");
        if (hasOfferId) {
          const fromEmailFail = (account as { from_email?: string }).from_email ?? "";
          const toRecipientFail = to ?? "";
          if ((hasToAddr || hasToEmail) && hasError) {
            if (hasUserIdColFail) {
              const failUserId = effectiveUserId || ((account as { user_id?: string }).user_id ?? user.id);
              if (!failUserId) throw new Error("[email] failed path: user_id required for email_history");
              if (hasToEmail && hasToAddr) {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, failUserId, fromEmailFail, toRecipientFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              } else if (hasToEmail) {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, failUserId, fromEmailFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              } else {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_addr, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, failUserId, fromEmailFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              }
            } else {
              if (hasToEmail && hasToAddr) {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, to_addr, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, fromEmailFail, toRecipientFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              } else if (hasToEmail) {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, fromEmailFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              } else {
                db.prepare(
                  "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_addr, subject, status, error, created_at, offer_id) VALUES (?, NULL, ?, ?, ?, ?, 'failed', ?, ?, ?)"
                ).run(historyId, account?.id ?? null, fromEmailFail, toRecipientFail, subject, errMsg, now, resolvedOfferId);
              }
            }
          } else if (hasToEmail && hasErrorMessage && hasUserIdColFail) {
            db.prepare(
              "INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, '', 'failed', ?, ?)"
            ).run(historyId, resolvedOfferId, user.id, account?.from_email ?? "", to, subject, errMsg, now);
          }
        }
        const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
        if (auditTables.length > 0) {
          db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_FAILED', ?)").run(
            uuid(), resolvedOfferId, user.id, JSON.stringify({ to, error: errMsg, code })
          );
        }
        try {
          const fromEmailFail = (account as { from_email?: string } | undefined)?.from_email ?? "";
          const logEmailPayload = {
            id: historyId,
            userId: user.id,
            userEmail: user.email,
            toEmail: to,
            subject,
            status: "failed" as const,
            errorMessage: errMsg,
            sentAt: null,
            fromEmail: fromEmailFail,
            offerId: resolvedOfferId,
          };
          db.prepare(
            "INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'LOG_EMAIL', ?, 0, 5)"
          ).run(uuid(), JSON.stringify(logEmailPayload));
        } catch (logErr) {
          logger.warn("[email] LOG_EMAIL (FAILED) enqueue failed", logErr);
        }
      } catch (auditErr) {
        logger.error("[email] sendOfferEmail FAILED audit/history insert", auditErr);
      }
      enqueueEmail(db as import("./emailService").Db, {
        to,
        cc: cc || undefined,
        subject,
        html: bodyHtml,
        text: bodyText,
        attachments,
        relatedOfferId: resolvedOfferId,
        accountUserId: senderUserId,
      }, logger);
      return { ok: false, code, message: errMsg, error: errMsg, queued: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, code: "ERR_AUTH", message: e.message, error: e.message };
      logger.error("[email] sendOfferEmail failed", e);
      const msg = e instanceof Error ? e.message : String(e);
      let friendly = msg;
      if (msg.includes("Oferta nie istnieje w bazie CRM")) friendly = msg;
      else if (msg.includes("FOREIGN KEY") || msg.includes("constraint failed")) friendly = "Błąd zapisu powiązań (oferta lub użytkownik). Odśwież ofertę i spróbuj ponownie.";
      else if (msg.includes("insertPdf") || msg.includes("zapisać PDF")) friendly = "Nie udało się zapisać PDF w bazie. Sprawdź logi i spróbuj ponownie.";
      return { ok: false, code: "ERR_SMTP", message: friendly, error: friendly, details: e instanceof Error ? e.stack : undefined };
    }
  }));

  const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;
  const DANGEROUS_EXT = /\.(exe|bat|cmd|com|msi|scr|vbs|js|jar)$/i;
  ipcMain.handle("planlux:attachments:pickFiles", async () => {
    try {
      requireAuth();
      const { BrowserWindow } = await import("electron");
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = await dialog.showOpenDialog(win ?? undefined, {
        properties: ["openFile", "multiSelections"],
        title: "Dodaj załączniki",
      });
      if (result.canceled || !result.filePaths?.length) return { ok: true, files: [] };
      const baseDir = path.join(app.getPath("userData"), "attachments", uuid());
      if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
      const files: Array<{ token: string; originalName: string; storedPath: string; size: number; mime: string }> = [];
      let totalBytes = 0;
      for (const src of result.filePaths) {
        if (totalBytes >= MAX_ATTACHMENTS_TOTAL_BYTES) {
          logger.warn("[attachments] max total size reached");
          break;
        }
        const originalName = path.basename(src);
        if (DANGEROUS_EXT.test(originalName)) {
          logger.warn("[attachments] skipped dangerous extension", { originalName });
          continue;
        }
        const stat = fs.statSync(src);
        if (!stat.isFile()) continue;
        if (totalBytes + stat.size > MAX_ATTACHMENTS_TOTAL_BYTES) continue;
        const safeName = originalName.replace(/[^\w\s.-]/gi, "_").slice(0, 200) || "file";
        const dest = path.join(baseDir, safeName);
        fs.copyFileSync(src, dest);
        totalBytes += stat.size;
        files.push({
          token: dest,
          originalName,
          storedPath: dest,
          size: stat.size,
          mime: "application/octet-stream",
        });
      }
      logger.info("[attachments] pickFiles", { count: files.length, totalBytes });
      return { ok: true, files };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[attachments] pickFiles failed", e);
      return { ok: false, error: msg, files: [] };
    }
  });

  ipcMain.handle("planlux:email:send", async (_, payload: unknown) => {
    try {
      const user = requireAuth();
      if (!user?.id) return { ok: false, error: "Brak zalogowanego użytkownika — nie można wysłać e-maila." };
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { to?: string; cc?: string; bcc?: string; subject?: string; text?: string; html?: string; attachments?: Array<{ filename: string; path: string }>; relatedOfferId?: string; accountId?: string | null };
      const toInput = typeof p.to === "string" ? p.to.trim() : "";
      const toEmails = parseRecipients(toInput);
      const to = toEmails.join(", ");
      const subject = typeof p.subject === "string" ? p.subject.trim() : "";
      if (!to || !subject) return { ok: false, error: "Do i temat są wymagane" };
      const online = await checkInternetEmail();
      const db = getDb() as import("./emailService").Db;
      if (!online) {
        const id = enqueueEmail(db, {
          to,
          cc: p.cc,
          bcc: p.bcc,
          subject,
          text: p.text,
          html: p.html,
          attachments: p.attachments,
          relatedOfferId: p.relatedOfferId,
          accountId: p.accountId,
        }, logger);
        return { ok: true, queued: true, outboxId: id };
      }
      const { getDefaultAccount: getDefaultSmtpAccount } = await import("./emailService");
      const defaultAccount = getDefaultSmtpAccount(db);
      if (!defaultAccount && !p.accountId) return { ok: false, error: "Skonfiguruj konto SMTP w Panelu admina" };
      const accountId = p.accountId ?? defaultAccount?.id ?? null;
      const account: import("./emailService").SmtpAccountRow | null | undefined = accountId
        ? (db.prepare("SELECT * FROM smtp_accounts WHERE id = ? AND active = 1").get(accountId) as import("./emailService").SmtpAccountRow | undefined)
        : defaultAccount;
      if (!account) return { ok: false, error: "Konto SMTP nie znalezione" };
      const tempId = uuid();
      const outboxRow: import("./emailService").EmailOutboxRow = {
        id: tempId,
        account_id: account.id,
        to_addr: to,
        cc: p.cc || null,
        bcc: p.bcc || null,
        subject,
        text_body: p.text || null,
        html_body: p.html || null,
        attachments_json: JSON.stringify(p.attachments || []),
        related_offer_id: p.relatedOfferId || null,
        status: "queued",
        retry_count: 0,
        next_retry_at: null,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await sendNow(db, outboxRow, logger);
      if (result.ok) {
        const now = new Date().toISOString();
        const statusSent = allowedEmailHistoryStatus("sent");
        const acceptedJson = result.accepted != null ? JSON.stringify(result.accepted) : null;
        const rejectedJson = result.rejected != null ? JSON.stringify(result.rejected) : null;
        const smtpResponse = result.response ?? null;
        const historyId = uuid();
        const runTx = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
          db.prepare(
            `INSERT INTO email_outbox (id, account_id, account_user_id, to_addr, cc, bcc, subject, text_body, html_body, attachments_json, related_offer_id, status, retry_count, sent_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', 0, ?, ?, ?)`
          ).run(
            tempId,
            account.id,
            (account as { user_id?: string | null }).user_id ?? null,
            to,
            p.cc || null,
            p.bcc || null,
            subject,
            p.text || null,
            p.html || null,
            outboxRow.attachments_json,
            p.relatedOfferId || null,
            now,
            now,
            now
          );
          const outboxExists = db.prepare("SELECT id FROM email_outbox WHERE id = ?").get(tempId);
          if (!outboxExists) throw new Error("[email] FK diagnostic: email_outbox row missing after INSERT");
          const ehCols = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
          const hasUserIdCol = ehCols.some((c) => c.name === "user_id");
          const hasToEmailSend = ehCols.some((c) => c.name === "to_email");
          const hasToAddrSend = ehCols.some((c) => c.name === "to_addr");
          const userId = (account as { user_id?: string | null }).user_id ?? user.id;
          const fromEmailSend = (account as { from_email?: string }).from_email ?? "";
          const toRecipientSend = to ?? "";
          if (hasUserIdCol) {
            if (!userId) throw new Error("[email] email_history.user_id required but userId is null (planlux:email:send)");
            if (hasToEmailSend && hasToAddrSend) {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, userId, fromEmailSend, toRecipientSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            } else if (hasToEmailSend) {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_email, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, userId, fromEmailSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            } else {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, user_id, from_email, to_addr, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, userId, fromEmailSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            }
          } else {
            if (hasToEmailSend && hasToAddrSend) {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, to_addr, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, fromEmailSend, toRecipientSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            } else if (hasToEmailSend) {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_email, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, fromEmailSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            } else {
              db.prepare(
                "INSERT INTO email_history (id, outbox_id, account_id, from_email, to_addr, subject, status, provider_message_id, accepted_json, rejected_json, smtp_response, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(historyId, tempId, account.id, fromEmailSend, toRecipientSend, subject, statusSent, result.messageId || null, acceptedJson, rejectedJson, smtpResponse, now, now);
            }
          }
        });
        runTx();
        return { ok: true, sent: true };
      }
      enqueueEmail(db, { to, cc: p.cc, bcc: p.bcc, subject, text: p.text, html: p.html, attachments: p.attachments, relatedOfferId: p.relatedOfferId, accountId: account.id }, logger);
      return { ok: true, queued: true, outboxId: tempId, error: result.error };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[email] send failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:email:outboxList", async (_, filter: { status?: string }) => {
    try {
      const user = requireAuth();
      const status = filter?.status;
      const db = getDb();
      const isAdminOrBoss = user.role === "ADMIN" || user.role === "SZEF";
      let rows: unknown[];
      if (isAdminOrBoss) {
        rows = status
          ? db.prepare("SELECT * FROM email_outbox WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
          : db.prepare("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 200").all();
      } else {
        rows = status
          ? db.prepare("SELECT * FROM email_outbox WHERE account_user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 200").all(user.id, status)
          : db.prepare("SELECT * FROM email_outbox WHERE account_user_id = ? ORDER BY created_at DESC LIMIT 200").all(user.id);
      }
      return { ok: true, items: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });

  ipcMain.handle("planlux:email:retryNow", async (_, outboxId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const row = db.prepare("SELECT account_user_id FROM email_outbox WHERE id = ?").get(outboxId) as { account_user_id: string | null } | undefined;
      if (!row) return { ok: false, error: "Pozycja nie znaleziona" };
      const canRetry = user.role === "ADMIN" || user.role === "SZEF" || row.account_user_id === user.id;
      if (!canRetry) return { ok: false, error: "Forbidden" };
      db.prepare("UPDATE email_outbox SET next_retry_at = NULL, status = 'queued', updated_at = ? WHERE id = ?").run(new Date().toISOString(), outboxId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:email:historyList", async (_, limit?: number) => {
    try {
      requireAuth();
      const limitNum = typeof limit === "number" ? Math.min(limit, 500) : 100;
      const rows = getDb().prepare("SELECT * FROM email_history ORDER BY created_at DESC LIMIT ?").all(limitNum);
      return { ok: true, items: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });

  /** App version (Electron app.getVersion()). */
  ipcMain.handle("planlux:app:getVersion", async () => {
    return { ok: true, version: app.getVersion() };
  });

  /** Open URL in default external browser. */
  ipcMain.handle("planlux:app:openExternal", async (_, url: string) => {
    if (typeof url !== "string" || !url.trim()) return { ok: false, error: "Invalid URL" };
    try {
      await shell.openExternal(url.trim());
      return { ok: true };
    } catch (e) {
      const ser = serializeError(e);
      logger.warn("[app] openExternal failed", { message: ser.message });
      return { ok: false, error: ser.message };
    }
  });

  /** Updates URL from env (PLANLUX_UPDATES_URL) for renderer to fetch version/history. */
  ipcMain.handle("planlux:app:getUpdatesUrl", async () => {
    return { ok: true, updatesUrl: config.updatesUrl ?? "" };
  });

  /** Updates checker: current app version (renderer uses only planlux:updates:* for updates). */
  ipcMain.handle("planlux:updates:getCurrentVersion", async () => {
    return { ok: true, version: app.getVersion() };
  });

  /** Updates checker: open download URL in default browser. */
  ipcMain.handle("planlux:updates:openExternal", async (_, url: string) => {
    if (typeof url !== "string" || !url.trim()) return { ok: false, error: "Invalid URL" };
    try {
      await shell.openExternal(url.trim());
      return { ok: true };
    } catch (e) {
      const ser = serializeError(e);
      logger.warn("[updates] openExternal failed", { message: ser.message });
      return { ok: false, error: ser.message };
    }
  });

  /** Updates checker: URL for version/history fetch (main + renderer; fallback w config). */
  ipcMain.handle("planlux:updates:getUpdatesUrl", async () => {
    return { ok: true, updatesUrl: config.updatesUrl ?? "" };
  });

  /** Debug: PRAGMA table_info + last 20 rows dla email_history i email_outbox + schema version flags (diagnostyka użytkowników). */
  ipcMain.handle("planlux:debugEmailTables", async () => {
    try {
      requireAuth();
      const db = getDb();
      let emailHistoryInfo: Array<{ name: string; type: string }> = [];
      let emailOutboxInfo: Array<{ name: string; type: string }> = [];
      let lastHistory: Record<string, unknown>[] = [];
      let lastOutbox: Record<string, unknown>[] = [];
      let createHistory: { sql: string } | undefined;
      let createOutbox: { sql: string } | undefined;
      try {
        emailHistoryInfo = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string; type: string }>;
        createHistory = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_history'").get() as { sql: string } | undefined;
        lastHistory = db.prepare("SELECT * FROM email_history ORDER BY created_at DESC LIMIT 20").all() as Record<string, unknown>[];
      } catch {
        // table may not exist
      }
      try {
        emailOutboxInfo = db.prepare("PRAGMA table_info(email_outbox)").all() as Array<{ name: string; type: string }>;
        createOutbox = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_outbox'").get() as { sql: string } | undefined;
        lastOutbox = db.prepare("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 20").all() as Record<string, unknown>[];
      } catch {
        // table may not exist
      }
      const statusHistoryLower = (createHistory?.sql ?? "").includes("'queued'");
      const statusOutboxUpper = (createOutbox?.sql ?? "").includes("'QUEUED'");
      return {
        ok: true,
        email_history: { table_info: emailHistoryInfo, last20: lastHistory, createSql: createHistory?.sql ?? null },
        email_outbox: { table_info: emailOutboxInfo, last20: lastOutbox, createSql: createOutbox?.sql ?? null },
        schemaFlags: {
          email_history_status_lowercase: statusHistoryLower,
          email_outbox_status_uppercase: statusOutboxUpper,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
