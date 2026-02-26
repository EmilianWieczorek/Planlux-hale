/**
 * Wysyłka e-mail przez SMTP (CyberFolks).
 * Wymaga inject transportu (nodemailer w Node; w React Native inna implementacja).
 * Hasła tylko z CredentialStore (systemowy sejf).
 */

import type { SmtpCredentials } from "./credentials";

export interface SendMailParams {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; path: string }>;
}

export interface SmtpTransport {
  send(credentials: SmtpCredentials, params: SendMailParams): Promise<void>;
}

/**
 * Wysyła e-mail używając podanych credentials.
 * W Electron/Node: użyj nodemailer.createTransport + sendMail.
 * Przykład (Node):
 *   const nodemailer = require('nodemailer');
 *   const transport: SmtpTransport = {
 *     async send(creds, params) {
 *       const t = nodemailer.createTransport({
 *         host: creds.host, port: creds.port, secure: creds.secure,
 *         auth: { user: creds.user, pass: creds.password }
 *       });
 *       await t.sendMail({ from: params.from, to: params.to, subject: params.subject, ... });
 *     }
 *   };
 */
export async function sendMailWithCredentials(
  credentials: SmtpCredentials,
  transport: SmtpTransport,
  params: SendMailParams
): Promise<void> {
  await transport.send(credentials, params);
}

/** CyberFolks SMTP (typowe ustawienia). */
export function getCyberFolksSmtpDefaults(host?: string): Partial<SmtpCredentials> {
  return {
    host: host ?? "poczta.cyberfolks.pl",
    port: 465,
    secure: true,
  };
}
