/**
 * Generic SMTP email helper for Electron main process.
 * Configuration comes from environment variables, not from renderer.
 *
 * Required env vars (prefix PLANLUX_SMTP_ or SMTP_):
 * - PLANLUX_SMTP_HOST / SMTP_HOST
 * - PLANLUX_SMTP_PORT / SMTP_PORT
 * - PLANLUX_SMTP_SECURE / SMTP_SECURE   (\"true\" / \"false\", default true)
 * - PLANLUX_SMTP_USER / SMTP_USER
 * - PLANLUX_SMTP_PASS / SMTP_PASS
 * - PLANLUX_SMTP_FROM / SMTP_FROM       (optional, defaults to USER)
 */
import nodemailer from "nodemailer";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
};

export type SendEmailInput = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

let cachedConfig: SmtpConfig | null = null;
let cachedTransporter: nodemailer.Transporter | null = null;

function loadSmtpConfig(): SmtpConfig {
  if (cachedConfig) return cachedConfig;

  const host = process.env.PLANLUX_SMTP_HOST ?? process.env.SMTP_HOST;
  const portEnv = process.env.PLANLUX_SMTP_PORT ?? process.env.SMTP_PORT;
  const secureEnv = process.env.PLANLUX_SMTP_SECURE ?? process.env.SMTP_SECURE;
  const user = process.env.PLANLUX_SMTP_USER ?? process.env.SMTP_USER;
  const pass = process.env.PLANLUX_SMTP_PASS ?? process.env.SMTP_PASS;
  const fromEnv = process.env.PLANLUX_SMTP_FROM ?? process.env.SMTP_FROM;

  if (!host || !user || !pass) {
    throw new Error("SMTP configuration missing. Set PLANLUX_SMTP_HOST/USER/PASS (or SMTP_HOST/USER/PASS).");
  }

  const port = portEnv ? Number.parseInt(portEnv, 10) || 465 : 465;
  const secure = secureEnv ? secureEnv.toLowerCase() !== "false" : true;
  const from = (fromEnv || user).trim();

  cachedConfig = { host, port, secure, user, pass, from };
  return cachedConfig;
}

function getTransporter(): nodemailer.Transporter {
  if (cachedTransporter) return cachedTransporter;
  const cfg = loadSmtpConfig();
  cachedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  return cachedTransporter;
}

function isValidEmail(email: string): boolean {
  const value = email.trim();
  // Simple RFC5322-ish check; good enough for frontend validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const to = (input.to ?? "").trim();
  const subjectRaw = (input.subject ?? "").trim();
  const textRaw = input.text?.toString() ?? "";
  const htmlRaw = input.html?.toString() ?? "";

  if (!to || !isValidEmail(to)) {
    throw new Error("Invalid recipient email.");
  }
  if (!subjectRaw) {
    throw new Error("Subject is required.");
  }

  const subject = subjectRaw.replace(/\r?\n/g, " ").slice(0, 255);

  let text = textRaw;
  let html = htmlRaw;

  if (!text && html) {
    // Strip basic tags for text version
    text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (!html && text) {
    html = `<p>${text.replace(/\n/g, "<br>")}</p>`;
  }
  if (!text && !html) {
    throw new Error("Either text or html body must be provided.");
  }

  const cfg = loadSmtpConfig();
  const transporter = getTransporter();

  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
      html,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`SMTP send failed: ${msg}`);
  }
}

/**
 * Simple SMTP send using env vars only (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
 * Used by IPC planlux:sendEmail. No hardcoded credentials.
 */
export async function sendSmtpEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}) {
  if (!to || !subject) {
    throw new Error("Missing email parameters");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter.sendMail({
    from: `"Planlux Hale" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

