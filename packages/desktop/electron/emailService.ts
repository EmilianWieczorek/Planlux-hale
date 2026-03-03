/**
 * Email subsystem: offline-first outbox, SMTP via nodemailer, secure password storage.
 * Worker processes outbox every 15s when online.
 */

import { net } from "electron";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getPassword, getSmtpPassword, getSmtpKeytarAccountKey } from "./secureStore";

/**
 * Parse "To" field: comma, semicolon, space, newline.
 * Returns array of non-empty trimmed addresses; use emails.join(", ") for nodemailer.
 */
export function parseRecipients(input: string): string[] {
  return input
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Allowed email_history.status values (CHECK constraint). 'sending' is UI/outbox-only, never stored in email_history. */
export const ALLOWED_EMAIL_HISTORY_STATUSES = ["queued", "sent", "failed"] as const;
export type AllowedEmailHistoryStatus = (typeof ALLOWED_EMAIL_HISTORY_STATUSES)[number];

/** Normalize status for email_history INSERT/UPDATE. Rejects 'sending' and any invalid value → fallback 'queued'. */
export function allowedEmailHistoryStatus(s: unknown): AllowedEmailHistoryStatus {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "sending") return "queued";
  if (v === "sent" || v === "failed" || v === "queued") return v;
  return "queued";
}

const CHECK_INTERNET_URL = "https://example.com/favicon.ico";
const CHECK_INTERNET_TIMEOUT_MS = 3000;
const OUTBOX_POLL_INTERVAL_MS = 15_000;
const MAX_RETRIES = 6;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000]; // 1m, 5m, 15m, 1h, 6h, 24h

export type Db = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

export type SmtpAccountRow = {
  id: string;
  user_id?: string | null;
  name: string;
  from_name: string;
  from_email: string;
  host: string;
  port: number;
  secure: number;
  auth_user: string;
  reply_to: string | null;
  is_default?: number;
  active: number;
};

export type EmailOutboxRow = {
  id: string;
  account_id: string | null;
  account_user_id?: string | null;
  to_addr: string;
  cc: string | null;
  bcc: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  attachments_json: string;
  related_offer_id: string | null;
  status: string;
  retry_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at?: string | null;
};

export type EnqueuePayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; path: string }>;
  relatedOfferId?: string;
  accountId?: string | null;
  accountUserId?: string | null;
};

let workerInterval: ReturnType<typeof setInterval> | null = null;

export function checkInternet(): Promise<boolean> {
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

function uuid(): string {
  return crypto.randomUUID();
}

export function getDefaultAccount(db: Db): SmtpAccountRow | null {
  const row = db.prepare(
    "SELECT * FROM smtp_accounts WHERE active = 1 AND is_default = 1 LIMIT 1"
  ).get() as SmtpAccountRow | undefined;
  return row ?? null;
}

/** Per-user: one SMTP account per user_id (salesperson @planlux.pl). */
export function getAccountByUserId(db: Db, userId: string): SmtpAccountRow | null {
  const row = db.prepare("SELECT * FROM smtp_accounts WHERE user_id = ? AND active = 1").get(userId) as SmtpAccountRow | undefined;
  return row ?? null;
}

function getAccountById(db: Db, accountId: string): SmtpAccountRow | null {
  const row = db.prepare("SELECT * FROM smtp_accounts WHERE id = ? AND active = 1").get(accountId) as SmtpAccountRow | undefined;
  return row ?? null;
}

/**
 * Normalize port + secure for Cyberfolks/typical SMTP:
 * - 465 → secure true (implicit SSL)
 * - 587 → secure false (STARTTLS)
 * - If secure=true and port=587 → fix to secure=false
 */
export function normalizeSmtpPortSecure(port: number, secure: boolean): { port: number; secure: boolean } {
  const p = Number(port) || 587;
  let s = secure;
  if (p === 465) s = true;
  if (p === 587) s = false;
  if (p === 25) s = false;
  if (s === true && p === 587) s = false;
  return { port: p, secure: s };
}

/**
 * Validate port + secure for SMTP (avoids WRONG_VERSION_NUMBER / TLS mismatch).
 * - 587 → STARTTLS, secure must be false
 * - 465 → implicit SSL, secure must be true
 * - 25  → plain/STARTTLS, secure must be false
 */
export function validateSmtpPortSecure(port: number, secure: boolean): void {
  const p = Number(port);
  if (p === 587 && secure !== false) {
    throw new Error("SMTP configuration mismatch: port 587 requires secure=false (STARTTLS).");
  }
  if (p === 465 && secure !== true) {
    throw new Error("SMTP configuration mismatch: port 465 requires secure=true (implicit SSL).");
  }
  if (p === 25 && secure !== false) {
    throw new Error("SMTP configuration mismatch: port 25 requires secure=false.");
  }
}

function isDev(): boolean {
  return process.env.NODE_ENV === "development" || !!process.env.VITE_DEV_SERVER_URL;
}

/** Resolve account for outbox row: by account_user_id (per-user) or account_id (legacy). */
function getAccountForOutboxRow(db: Db, row: EmailOutboxRow): SmtpAccountRow | null {
  if (row.account_user_id) {
    const byUser = getAccountByUserId(db, row.account_user_id);
    if (byUser) return byUser;
  }
  if (row.account_id) return getAccountById(db, row.account_id);
  return getDefaultAccount(db);
}

export type BuildTransportOverrides = { port?: number; secure?: boolean } | undefined;

/** Single source: fetch password from keytar for the account. Used by BOTH send and test. No cache. */
export async function getCredentialsForAccount(
  db: Db,
  account: SmtpAccountRow
): Promise<{ account: SmtpAccountRow; password: string }> {
  const keytarLookupId = account.user_id ?? account.id;
  const pass = account.user_id
    ? await getSmtpPassword(account.user_id)
    : await getPassword(account.id);
  if (!pass) throw new Error(`Brak hasła SMTP dla konta: ${account.name || account.from_email}`);
  const selectedUserEmail = (account.from_email || "").trim() || "(brak from_email)";
  const keytarAccountKeyUsed = getSmtpKeytarAccountKey(keytarLookupId);
  let port = Number(account.port) || 587;
  let secure = account.secure === 1;
  const normalized = normalizeSmtpPortSecure(port, secure);
  port = normalized.port;
  secure = normalized.secure;
  console.log("KEYTAR ENTRY:", selectedUserEmail, "passLength:", pass.length);
  console.log("[smtp] credentials (single source)", {
    selectedUserEmail,
    keytarAccountKeyUsed,
    passLength: pass.length,
    host: account.host,
    port,
    secure,
  });
  return { account, password: pass };
}

/**
 * Build transporter from account + password. Same function used by send AND test.
 * auth.user = full email (from_email). from in mail must equal auth.user.
 */
export function buildTransportFromConfig(
  account: SmtpAccountRow,
  password: string,
  overrides?: BuildTransportOverrides
): nodemailer.Transporter {
  let port = Number(account.port) || 587;
  let secure = account.secure === 1;
  if (overrides?.port != null) port = overrides.port;
  if (overrides?.secure !== undefined) secure = overrides.secure;
  const normalized = normalizeSmtpPortSecure(port, secure);
  port = normalized.port;
  secure = normalized.secure;
  validateSmtpPortSecure(port, secure);

  const user = getSmtpAuthUser(account);
  if (!user) throw new Error("SMTP: brak adresu e-mail (auth.user / from_email).");

  return nodemailer.createTransport({
    host: account.host.trim(),
    port,
    secure,
    auth: { user, pass: password },
    ...(isDev() ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

/**
 * Fetch credentials from keytar (no cache) and build transporter. Used by both send and test.
 */
export async function buildTransport(
  db: Db,
  account: SmtpAccountRow,
  overrides?: BuildTransportOverrides
): Promise<nodemailer.Transporter> {
  const { account: acc, password } = await getCredentialsForAccount(db, account);
  return buildTransportFromConfig(acc, password, overrides);
}

/** Pełny e-mail do logowania SMTP (auth.user). Musi być równy from w wiadomości. */
export function getSmtpAuthUser(account: SmtpAccountRow): string {
  const fromEmail = (account.from_email || "").trim().toLowerCase();
  const authUserRaw = (account.auth_user || "").trim() || fromEmail;
  return authUserRaw.includes("@") ? authUserRaw : fromEmail;
}

/** Build transporter for a user (per-user SMTP). */
export async function buildTransportForUser(db: Db, userId: string, overrides?: BuildTransportOverrides): Promise<nodemailer.Transporter> {
  const account = getAccountByUserId(db, userId);
  if (!account) throw new Error(`Brak konfiguracji SMTP dla użytkownika`);
  return buildTransport(db, account, overrides);
}

/**
 * Wywołuje transporter.verify(). Przy błędzie loguje pełny stack i response serwera.
 */
export async function verifyTransport(
  transporter: nodemailer.Transporter,
  logger: { error: (m: string, e?: unknown) => void }
): Promise<{ ok: true } | { ok: false; needFallback: boolean; error: string; stack?: string; response?: string }> {
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    const response = e && typeof e === "object" && "response" in e ? String((e as { response?: string }).response) : undefined;
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
    logger.error("[smtp] verify failed – full error stack", { message: msg, stack, response, code });
    const needFallback = /535|authentication|ECONNREFUSED|ETIMEDOUT|WRONG_VERSION|ENOTFOUND/i.test(msg);
    return { ok: false, needFallback, error: msg, stack, response };
  }
}

const TEMPLATE_PLACEHOLDERS = [
  "offerNumber", "clientName", "salespersonName", "salespersonEmail", "companyName", "date",
] as const;

/** Replace {{placeholder}} in template with vars. */
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const key of TEMPLATE_PLACEHOLDERS) {
    const val = vars[key] ?? "";
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "gi"), val);
  }
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, "gi"), String(v));
  });
  return out;
}

export type EmailSettings = {
  office_cc_email: string;
  office_cc_default_enabled: boolean;
  email_template_subject: string;
  email_template_body_html: string;
  email_template_body_text: string;
};

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  office_cc_email: "",
  office_cc_default_enabled: true,
  email_template_subject: "Oferta Planlux – {{offerNumber}}",
  email_template_body_html: "<p>Szanowni Państwo,</p><p>W załączeniu przesyłam ofertę {{offerNumber}} dla {{clientName}}.</p><p>Pozdrawiam,<br>{{salespersonName}}</p>",
  email_template_body_text: "Szanowni Państwo,\n\nW załączeniu przesyłam ofertę {{offerNumber}} dla {{clientName}}.\n\nPozdrawiam,\n{{salespersonName}}",
};

function getSetting(db: Db, key: string): string {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

export function getEmailSettings(db: Db): EmailSettings {
  try {
    const raw = getSetting(db, "office_cc_email");
    const rawEnabled = getSetting(db, "office_cc_default_enabled");
    const subject = getSetting(db, "email_template_subject") || DEFAULT_EMAIL_SETTINGS.email_template_subject;
    const bodyHtml = getSetting(db, "email_template_body_html") || DEFAULT_EMAIL_SETTINGS.email_template_body_html;
    const bodyText = getSetting(db, "email_template_body_text") || DEFAULT_EMAIL_SETTINGS.email_template_body_text;
    return {
      office_cc_email: raw,
      office_cc_default_enabled: rawEnabled !== "0" && rawEnabled !== "false",
      email_template_subject: subject,
      email_template_body_html: bodyHtml,
      email_template_body_text: bodyText,
    };
  } catch {
    return DEFAULT_EMAIL_SETTINGS;
  }
}

export function setEmailSetting(db: Db, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
}

export type SendOfferEmailNowParams = {
  to: string;
  cc?: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  attachments?: Array<{ filename: string; path: string }>;
  accountUserId: string;
};

export type SendMailResult = {
  ok: boolean;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
  error?: string;
};

/** Send one offer email immediately (main process only). */
export async function sendOfferEmailNow(
  db: Db,
  params: SendOfferEmailNowParams,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<SendMailResult> {
  const account = getAccountByUserId(db, params.accountUserId);
  if (!account) return { ok: false, error: "Brak konfiguracji SMTP dla użytkownika" };
  const port = Number(account.port) || 587;
  const secure = account.secure === 1;
  logger.info("[emailService] sendOfferEmailNow", {
    host: account.host,
    port,
    secure,
    auth_user: account.auth_user || account.from_email,
    to: params.to,
    subject: params.subject,
  });
  const transporter = await buildTransport(db, account);
  const authUser = getSmtpAuthUser(account);
  const from = account.from_name
    ? `"${account.from_name.replace(/"/g, '\\"')}" <${authUser}>`
    : authUser;
  const text = params.bodyText ?? (params.bodyHtml ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const html = params.bodyHtml ?? (params.bodyText ?? "").replace(/\n/g, "<br>");
  const mailOptions: Mail.Options = {
    from,
    to: params.to.trim(),
    cc: params.cc?.trim() || undefined,
    subject: params.subject.trim(),
    text: text || undefined,
    html: html ? `<p>${html.replace(/\n/g, "<br>")}</p>` : undefined,
  };
  if (params.attachments?.length) {
    mailOptions.attachments = params.attachments.map((a) => ({ filename: a.filename, path: a.path }));
  }
  try {
    const info = await transporter.sendMail(mailOptions);
    const accepted = (info.accepted ?? []).length > 0;
    const rejected = (info.rejected ?? []).length > 0;
    const sent = accepted && !rejected;
    logger.info("[emailService] sendOfferEmailNow result", {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
    if (sent) {
      return {
        ok: true,
        messageId: info.messageId as string,
        accepted: info.accepted as string[],
        rejected: info.rejected as string[],
        response: typeof info.response === "string" ? info.response : undefined,
      };
    }
    const errMsg = rejected
      ? `SMTP odrzucił: ${(info.rejected ?? []).join(", ")}${info.response ? `; ${info.response}` : ""}`
      : (info.response ?? "Serwer nie przyjął wiadomości");
    return {
      ok: false,
      error: errMsg,
      messageId: info.messageId as string | undefined,
      accepted: info.accepted as string[] | undefined,
      rejected: info.rejected as string[] | undefined,
      response: typeof info.response === "string" ? info.response : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const port = Number(account.port) || 587;
    if ((port === 465 && /535|authentication|ECONNREFUSED|WRONG_VERSION/i.test(msg)) || false) {
      logger.info("[emailService] sendOfferEmailNow fallback: port 587 (STARTTLS)");
      const transporterFallback = await buildTransport(db, account, { port: 587, secure: false });
      try {
        const info = await transporterFallback.sendMail(mailOptions);
        const accepted = (info.accepted ?? []).length > 0;
        const rejected = (info.rejected ?? []).length > 0;
        if (accepted && !rejected) {
          return {
            ok: true,
            messageId: info.messageId as string,
            accepted: info.accepted as string[],
            rejected: info.rejected as string[],
            response: typeof info.response === "string" ? info.response : undefined,
          };
        }
      } catch (_) {
        /* fall through to original error */
      }
    }
    logger.error("[emailService] sendOfferEmailNow failed", e);
    return { ok: false, error: msg };
  }
}

export async function sendNow(
  db: Db,
  outboxItem: EmailOutboxRow,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<SendMailResult> {
  const account = getAccountForOutboxRow(db, outboxItem);
  if (!account) {
    return { ok: false, error: "Brak aktywnego konta SMTP" };
  }
  const port = Number(account.port) || 587;
  const secure = account.secure === 1;
  logger.info("[emailService] sendNow", {
    host: account.host,
    port,
    secure,
    auth_user: account.auth_user || account.from_email,
    to: outboxItem.to_addr,
    subject: outboxItem.subject,
  });
  const transporter = await buildTransport(db, account);
  const authUser = getSmtpAuthUser(account);
  const from = account.from_name
    ? `"${account.from_name.replace(/"/g, '\\"')}" <${authUser}>`
    : authUser;
  const mailOptions: Mail.Options = {
    from,
    to: outboxItem.to_addr,
    cc: outboxItem.cc || undefined,
    bcc: outboxItem.bcc || undefined,
    subject: outboxItem.subject,
    text: outboxItem.text_body || undefined,
    html: outboxItem.html_body || undefined,
    replyTo: undefined,
  };
  let attachments: Array<{ filename: string; path: string }> = [];
  try {
    attachments = JSON.parse(outboxItem.attachments_json || "[]");
  } catch {
    /* ignore */
  }
  if (attachments.length > 0) {
    mailOptions.attachments = attachments.map((a) => ({ filename: a.filename, path: a.path }));
  }
  try {
    const info = await transporter.sendMail(mailOptions);
    const accepted = (info.accepted ?? []).length > 0;
    const rejected = (info.rejected ?? []).length > 0;
    const sent = accepted && !rejected;
    logger.info("[emailService] sendNow result", {
      outboxId: outboxItem.id,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    });
    if (sent) {
      const now = new Date().toISOString();
      db.prepare("UPDATE email_outbox SET sent_at = ? WHERE id = ?").run(now, outboxItem.id);
      return {
        ok: true,
        messageId: info.messageId as string,
        accepted: info.accepted as string[],
        rejected: info.rejected as string[],
        response: typeof info.response === "string" ? info.response : undefined,
      };
    }
    const errMsg = rejected
      ? `SMTP odrzucił: ${(info.rejected ?? []).join(", ")}${info.response ? `; ${info.response}` : ""}`
      : (info.response ?? "Serwer nie przyjął wiadomości");
    return {
      ok: false,
      error: errMsg,
      messageId: info.messageId as string | undefined,
      accepted: info.accepted as string[] | undefined,
      rejected: info.rejected as string[] | undefined,
      response: typeof info.response === "string" ? info.response : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (port === 465 && /535|authentication|ECONNREFUSED|WRONG_VERSION/i.test(msg)) {
      logger.info("[emailService] sendNow fallback: port 587 (STARTTLS)");
      try {
        const transporterFallback = await buildTransport(db, account, { port: 587, secure: false });
        const info = await transporterFallback.sendMail(mailOptions);
        const accepted = (info.accepted ?? []).length > 0;
        const rejected = (info.rejected ?? []).length > 0;
        const sent = accepted && !rejected;
        if (sent) {
          const now = new Date().toISOString();
          db.prepare("UPDATE email_outbox SET sent_at = ? WHERE id = ?").run(now, outboxItem.id);
          return {
            ok: true,
            messageId: info.messageId as string,
            accepted: info.accepted as string[],
            rejected: info.rejected as string[],
            response: typeof info.response === "string" ? info.response : undefined,
          };
        }
        const errMsg = rejected
          ? `SMTP odrzucił: ${(info.rejected ?? []).join(", ")}${info.response ? `; ${info.response}` : ""}`
          : (info.response ?? "Serwer nie przyjął wiadomości");
        return { ok: false, error: errMsg, messageId: info.messageId as string | undefined, accepted: info.accepted as string[] | undefined, rejected: info.rejected as string[] | undefined, response: typeof info.response === "string" ? info.response : undefined };
      } catch (_) {
        /* fall through */
      }
    }
    logger.error("[emailService] sendNow failed", e);
    return { ok: false, error: msg };
  }
}

export function enqueueEmail(
  db: Db,
  payload: EnqueuePayload,
  logger: { info: (m: string, d?: unknown) => void }
): string {
  const id = uuid();
  const accountId = payload.accountId ?? null;
  const accountUserId = payload.accountUserId ?? null;
  const attachmentsJson = JSON.stringify(payload.attachments || []);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO email_outbox (id, account_id, account_user_id, to_addr, cc, bcc, subject, text_body, html_body, attachments_json, related_offer_id, status, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`
  ).run(
    id,
    accountId,
    accountUserId,
    payload.to.trim(),
    payload.cc?.trim() || null,
    payload.bcc?.trim() || null,
    payload.subject?.trim() || "",
    payload.text?.trim() || null,
    payload.html?.trim() || null,
    attachmentsJson,
    payload.relatedOfferId || null,
    now,
    now
  );
  logger.info("[emailService] enqueued", { id, to: payload.to });
  return id;
}

function nextRetryAt(retryCount: number): string {
  const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
  return new Date(Date.now() + delay).toISOString();
}

export async function processOutbox(
  db: Db,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString();
  const ehInfo = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
  const hasUserIdCol = ehInfo.some((c) => c.name === "user_id");
  const hasToEmail = ehInfo.some((c) => c.name === "to_email");
  const hasToAddr = ehInfo.some((c) => c.name === "to_addr");
  const hasIdempotencyKey = ehInfo.some((c) => c.name === "idempotency_key");
  const hasRelatedOfferId = ehInfo.some((c) => c.name === "related_offer_id");

  const rows = db.prepare(
    `SELECT * FROM email_outbox WHERE status IN ('queued','failed') AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT 20`
  ).all(now) as EmailOutboxRow[];
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    db.prepare("UPDATE email_outbox SET status = 'queued', updated_at = ? WHERE id = ?").run(now, row.id);
    const result = await sendNow(db, { ...row, status: "sending" }, logger);
    const acceptedJson = result.accepted != null ? JSON.stringify(result.accepted) : null;
    const rejectedJson = result.rejected != null ? JSON.stringify(result.rejected) : null;
    const smtpResponse = result.response ?? null;
    if (result.ok) {
      const account = getAccountForOutboxRow(db, row);
      if (!account) {
        logger.error("[emailService] Missing SMTP account for outbox row", { outboxId: row.id });
        failed++;
        continue;
      }
      const firstActiveUserId = (db.prepare("SELECT id FROM users WHERE active = 1 ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined)?.id ?? null;
      const userId = row.account_user_id ?? account?.user_id ?? (hasUserIdCol ? firstActiveUserId : null);
      const fromEmail = row.account_user_id
        ? ((db.prepare("SELECT email FROM users WHERE id = ?").get(row.account_user_id) as { email?: string } | undefined)?.email ?? account.from_email ?? "")
        : (account.from_email ?? "");
      const toRecipient = parseRecipients(row.to_addr ?? "").join(", ");
      const toEmailValue = toRecipient;
      const bodyValue = (row.html_body ?? row.text_body ?? "").trim() || "";
      const attachmentsJsonValue = row.attachments_json?.trim() ? row.attachments_json : "[]";
      const offerIdValue = row.related_offer_id ?? null;
      const idempotencyKey = hasIdempotencyKey ? row.id : null;

      const runTx = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
        db.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.id);
      });
      runTx();

      if (hasIdempotencyKey && idempotencyKey) {
        const existing = db.prepare("SELECT id FROM email_history WHERE idempotency_key = ? AND status = 'sent' LIMIT 1").get(idempotencyKey);
        if (existing) {
          logger.info("[emailService] skip duplicate email_history (idempotency_key)", { outboxId: row.id });
          processed++;
          continue;
        }
      }

      const statusSent = allowedEmailHistoryStatus("sent");
      try {
        const runTxHistory = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
          if (hasUserIdCol && userId !== null) {
            if (hasToEmail && hasToAddr) {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, userId, fromEmail, toEmailValue, toRecipient, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            } else if (hasToEmail) {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, userId, fromEmail, toEmailValue, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            } else {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, userId, fromEmail, toEmailValue, toRecipient, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            }
          } else {
            if (hasToEmail && hasToAddr) {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, fromEmail, toEmailValue, toRecipient, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            } else if (hasToEmail) {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, fromEmail, toEmailValue, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            } else {
              db.prepare(
                `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, sent_at, status, created_at, accepted_json, rejected_json, smtp_response, provider_message_id, idempotency_key)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(uuid(), hasRelatedOfferId ? offerIdValue : null, offerIdValue, row.id, row.account_id, fromEmail, toEmailValue, toRecipient, row.subject, bodyValue, attachmentsJsonValue, now, statusSent, now, acceptedJson, rejectedJson, smtpResponse, result.messageId || null, idempotencyKey);
            }
          }
        });
        runTxHistory();
      } catch (historyErr) {
        logger.error("[emailService] email_history insert failed (outbox already SENT)", { outboxId: row.id, error: historyErr });
        // Nie blokujemy "wysłano" w UI – outbox już SENT
      }
      processed++;
    } else {
      const nextRetry = row.retry_count + 1;
      if (nextRetry >= MAX_RETRIES) {
        const accountFail = getAccountForOutboxRow(db, row);
        if (!accountFail) {
          logger.error("[emailService] FAILED path: missing SMTP account", { outboxId: row.id });
          db.prepare("UPDATE email_outbox SET status = 'failed', last_error = ?, retry_count = ?, updated_at = ? WHERE id = ?").run(result.error || "Max retries", nextRetry, now, row.id);
          failed++;
          continue;
        }
        const firstActiveUserIdFail = (db.prepare("SELECT id FROM users WHERE active = 1 ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined)?.id ?? null;
        const userIdFail = row.account_user_id ?? accountFail?.user_id ?? (hasUserIdCol ? firstActiveUserIdFail : null);
        const fromEmailFail = row.account_user_id
          ? ((db.prepare("SELECT email FROM users WHERE id = ?").get(row.account_user_id) as { email?: string } | undefined)?.email ?? accountFail.from_email ?? "")
          : (accountFail.from_email ?? "");
        const toRecipientFail = parseRecipients(row.to_addr ?? "").join(", ");
        const bodyValueFail = (row.html_body ?? row.text_body ?? "").trim() || "";
        const attachmentsJsonValueFail = row.attachments_json?.trim() ? row.attachments_json : "[]";
        const offerIdValueFail = row.related_offer_id ?? null;
        const errorMsgFail = result.error || null;
        const idempotencyKeyFail = hasIdempotencyKey ? row.id : null;
        if (hasUserIdCol && !userIdFail) {
          logger.error("[emailService] FAILED path: missing userId for email_history", {
            account_user_id: row.account_user_id ?? null,
            account_user_id_from_account: accountFail?.user_id ?? null,
          });
        }
        const runTxFail = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
          db.prepare(
            "UPDATE email_outbox SET status = 'failed', last_error = ?, retry_count = ?, updated_at = ? WHERE id = ?"
          ).run(result.error || "Max retries", nextRetry, now, row.id);
        });
        runTxFail();
        const statusFailed = allowedEmailHistoryStatus("failed");
        const skipFailedHistory =
          hasIdempotencyKey &&
          idempotencyKeyFail &&
          db.prepare("SELECT id FROM email_history WHERE idempotency_key = ? AND status = ? LIMIT 1").get(idempotencyKeyFail, statusFailed);
        if (!skipFailedHistory) {
          try {
            const runTxHistoryFail = (db as unknown as { transaction: (fn: () => void) => () => void }).transaction(() => {
              if (hasUserIdCol) {
                const uid = userIdFail ?? firstActiveUserIdFail;
                if (uid) {
                  if (hasToEmail && hasToAddr) {
                    db.prepare(
                      `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, uid, fromEmailFail, toRecipientFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                  } else if (hasToEmail) {
                    db.prepare(
                      `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, uid, fromEmailFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                  } else {
                    db.prepare(
                      `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, uid, fromEmailFail, toRecipientFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                  }
                }
              } else {
                if (hasToEmail && hasToAddr) {
                  db.prepare(
                    `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                  ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, fromEmailFail, toRecipientFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                } else if (hasToEmail) {
                  db.prepare(
                    `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                  ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, fromEmailFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                } else {
                  db.prepare(
                    `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, account_id, from_email, to_email, to_addr, subject, body, attachments_json, status, created_at, error, error_message, accepted_json, rejected_json, smtp_response, idempotency_key)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                  ).run(uuid(), offerIdValueFail, offerIdValueFail, row.id, row.account_id, fromEmailFail, toRecipientFail, toRecipientFail, row.subject, bodyValueFail, attachmentsJsonValueFail, statusFailed, now, errorMsgFail, errorMsgFail, acceptedJson, rejectedJson, smtpResponse, idempotencyKeyFail);
                }
              }
            });
            runTxHistoryFail();
          } catch (historyErr) {
            logger.error("[emailService] email_history insert failed (FAILED path, outbox already FAILED)", { outboxId: row.id, error: historyErr });
          }
        }
        failed++;
      } else {
        const nextAt = nextRetryAt(nextRetry);
        db.prepare(
          "UPDATE email_outbox SET status = 'failed', retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ? WHERE id = ?"
        ).run(nextRetry, nextAt, result.error || null, now, row.id);
        failed++;
      }
    }
  }
  return Promise.resolve({ processed, failed });
}

export function startOutboxWorker(
  getDb: () => Db,
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, e?: unknown) => void; error: (m: string, e?: unknown) => void }
): void {
  if (workerInterval) return;
  workerInterval = setInterval(async () => {
    try {
      const online = await checkInternet();
      if (!online) return;
      const db = getDb();
      const result = await processOutbox(db, logger);
      if (result.processed > 0 || result.failed > 0) {
        logger.info("[emailService] outbox run", result);
      }
    } catch (e) {
      logger.warn("[emailService] outbox worker error", e);
    }
  }, OUTBOX_POLL_INTERVAL_MS);
  logger.info("[emailService] outbox worker started");
}

export function stopOutboxWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
