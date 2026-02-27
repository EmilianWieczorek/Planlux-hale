/**
 * Wysyłka e-mail przez SMTP (nodemailer).
 * Credentials z userData/smtp-config.json (klucz = email użytkownika).
 */

import nodemailer from "nodemailer";
import path from "path";
import fs from "fs";
import { app } from "electron";
import type { SmtpCredentials } from "@planlux/shared";
import { validateSmtpPortSecure } from "./emailService";

const CONFIG_PATH = path.join(app.getPath("userData"), "smtp-config.json");

export function getSmtpConfig(accountEmail: string): SmtpCredentials | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const data = JSON.parse(raw) as Record<string, { host: string; port: number; secure: boolean; user: string; password: string }>;
    const cfg = data[accountEmail];
    if (!cfg?.user || !cfg?.password) return null;
    return {
      host: cfg.host ?? "poczta.cyberfolks.pl",
      port: cfg.port ?? 465,
      secure: cfg.secure ?? true,
      user: cfg.user,
      password: cfg.password,
    };
  } catch {
    return null;
  }
}

export function saveSmtpConfig(accountEmail: string, creds: Partial<SmtpCredentials>): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  let data: Record<string, unknown> = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  data[accountEmail] = {
    host: creds.host ?? "poczta.cyberfolks.pl",
    port: creds.port ?? 465,
    secure: creds.secure ?? true,
    user: creds.user ?? accountEmail,
    password: creds.password ?? "",
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 0), "utf-8");
}

export type SentMailResult = {
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  response?: string;
  envelope?: { from: string; to: string[] };
};

export async function sendMail(
  credentials: SmtpCredentials,
  params: { from: string; to: string; subject: string; body: string; attachmentPath?: string }
): Promise<SentMailResult> {
  const port = credentials.port ?? 587;
  const secure = credentials.secure ?? false;
  validateSmtpPortSecure(port, secure);
  const isDev = process.env.NODE_ENV === "development" || !!process.env.VITE_DEV_SERVER_URL;
  const transporter = nodemailer.createTransport({
    host: credentials.host,
    port,
    secure,
    auth: { user: credentials.user, pass: credentials.password },
    ...(isDev ? { tls: { rejectUnauthorized: false } } : {}),
  });
  const mailOptions: nodemailer.SendMailOptions = {
    from: params.from,
    to: params.to,
    subject: params.subject,
    text: params.body,
    html: params.body.replace(/\n/g, "<br>"),
  };
  if (params.attachmentPath && fs.existsSync(params.attachmentPath)) {
    mailOptions.attachments = [{ filename: path.basename(params.attachmentPath), path: params.attachmentPath }];
  }
  const info = await transporter.sendMail(mailOptions);
  const envelope = info.envelope as { from?: string; to?: string[] } | undefined;
  return {
    messageId: info.messageId as string | undefined,
    accepted: info.accepted as string[] | undefined,
    rejected: info.rejected as string[] | undefined,
    response: typeof info.response === "string" ? info.response : undefined,
    envelope: envelope ? { from: envelope.from ?? "", to: envelope.to ?? [] } : undefined,
  };
}

/** Callback dla flushOutbox – wysyła e-mail z payload SEND_EMAIL i aktualizuje email_history + offers_crm. */
export function createSendEmailForFlush(getDb: () => unknown) {
  return async (payload: { emailId: string; to: string; subject: string; body: string; attachmentPath?: string }): Promise<void> => {
    const db = getDb() as { prepare: (sql: string) => { run: (...args: unknown[]) => void; get: (...args: unknown[]) => unknown } };
    const row = db.prepare(
      "SELECT from_email, offer_id, user_id FROM email_history WHERE id = ?"
    ).get(payload.emailId) as { from_email: string; offer_id: string; user_id: string } | undefined;
    if (!row) throw new Error(`email_history nie znaleziony: ${payload.emailId}`);
    const creds = getSmtpConfig(row.from_email);
    if (!creds) throw new Error("Brak konfiguracji SMTP dla " + row.from_email);
    const info = await sendMail(creds, {
      from: row.from_email,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
      attachmentPath: payload.attachmentPath,
    });
    const now = new Date().toISOString();
    const accepted = (info.accepted ?? []).length > 0;
    const rejected = (info.rejected ?? []).length > 0;
    const sent = accepted && !rejected;
    if (sent) {
      db.prepare("UPDATE email_history SET status = 'SENT', sent_at = ? WHERE id = ?").run(now, payload.emailId);
      db.prepare("UPDATE offers_crm SET status = 'SENT', emailed_at = ?, updated_at = ? WHERE id = ?").run(now, now, row.offer_id);
    } else {
      const errMsg = rejected
        ? `SMTP rejected: ${(info.rejected ?? []).join(", ")}${info.response ? `; ${info.response}` : ""}`
        : (info.response ?? "Serwer nie przyjął wiadomości");
      db.prepare("UPDATE email_history SET status = 'FAILED', error_message = ? WHERE id = ?").run(errMsg, payload.emailId);
    }
  };
}
