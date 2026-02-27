/**
 * Email subsystem: offline-first outbox, SMTP via nodemailer, secure password storage.
 * Worker processes outbox every 15s when online.
 */

import { net } from "electron";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getPassword, getSmtpPassword } from "./secureStore";

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

/** Resolve account for outbox row: by account_user_id (per-user) or account_id (legacy). */
function getAccountForOutboxRow(db: Db, row: EmailOutboxRow): SmtpAccountRow | null {
  if (row.account_user_id) {
    const byUser = getAccountByUserId(db, row.account_user_id);
    if (byUser) return byUser;
  }
  if (row.account_id) return getAccountById(db, row.account_id);
  return getDefaultAccount(db);
}

export async function buildTransport(
  db: Db,
  account: SmtpAccountRow
): Promise<nodemailer.Transporter> {
  const pass = account.user_id
    ? await getSmtpPassword(account.user_id)
    : await getPassword(account.id);
  if (!pass) throw new Error(`Brak hasła SMTP dla konta: ${account.name || account.from_email}`);
  return nodemailer.createTransport({
    host: account.host,
    port: account.port,
    secure: account.secure === 1,
    auth: { user: account.auth_user || account.from_email, pass },
  });
}

/** Build transporter for a user (per-user SMTP). */
export async function buildTransportForUser(db: Db, userId: string): Promise<nodemailer.Transporter> {
  const account = getAccountByUserId(db, userId);
  if (!account) throw new Error(`Brak konfiguracji SMTP dla użytkownika`);
  return buildTransport(db, account);
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

/** Send one offer email immediately (main process only). */
export async function sendOfferEmailNow(
  db: Db,
  params: SendOfferEmailNowParams,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const account = getAccountByUserId(db, params.accountUserId);
  if (!account) return { ok: false, error: "Brak konfiguracji SMTP dla użytkownika" };
  const transporter = await buildTransport(db, account);
  const from = account.from_name
    ? `"${account.from_name.replace(/"/g, '\\"')}" <${account.from_email}>`
    : account.from_email;
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
    logger.info("[emailService] sendOfferEmailNow ok", { to: params.to, messageId: info.messageId });
    return { ok: true, messageId: info.messageId as string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[emailService] sendOfferEmailNow failed", e);
    return { ok: false, error: msg };
  }
}

export async function sendNow(
  db: Db,
  outboxItem: EmailOutboxRow,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const account = getAccountForOutboxRow(db, outboxItem);
  if (!account) {
    return { ok: false, error: "Brak aktywnego konta SMTP" };
  }
  const transporter = await buildTransport(db, account);
  const from = account.from_name
    ? `"${account.from_name.replace(/"/g, '\\"')}" <${account.from_email}>`
    : account.from_email;
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
    logger.info("[emailService] sendNow ok", { outboxId: outboxItem.id, messageId: info.messageId });
    const now = new Date().toISOString();
    db.prepare("UPDATE email_outbox SET sent_at = ? WHERE id = ?").run(now, outboxItem.id);
    return { ok: true, messageId: info.messageId as string };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
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

export function processOutbox(
  db: Db,
  logger: { info: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void }
): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT * FROM email_outbox WHERE status IN ('queued','failed') AND (next_retry_at IS NULL OR next_retry_at <= ?) ORDER BY created_at ASC LIMIT 20`
  ).all(now) as EmailOutboxRow[];
  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    db.prepare("UPDATE email_outbox SET status = 'sending', updated_at = ? WHERE id = ?").run(now, row.id);
    const result = await sendNow(db, { ...row, status: "sending" }, logger);
    if (result.ok) {
      db.prepare(
        "UPDATE email_outbox SET status = 'sent', updated_at = ? WHERE id = ?"
      ).run(now, row.id);
      db.prepare(
        `INSERT INTO email_history (id, outbox_id, account_id, to_addr, subject, status, provider_message_id, sent_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?)`
      ).run(uuid(), row.id, row.account_id, row.to_addr, row.subject, result.messageId || null, now, now);
      processed++;
    } else {
      const nextRetry = row.retry_count + 1;
      if (nextRetry >= MAX_RETRIES) {
        db.prepare(
          "UPDATE email_outbox SET status = 'failed', last_error = ?, retry_count = ?, updated_at = ? WHERE id = ?"
        ).run(result.error || "Max retries", nextRetry, now, row.id);
        db.prepare(
          `INSERT INTO email_history (id, outbox_id, account_id, to_addr, subject, status, error, created_at)
           VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`
        ).run(uuid(), row.id, row.account_id, row.to_addr, row.subject, result.error || null, now);
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
