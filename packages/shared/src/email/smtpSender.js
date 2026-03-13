"use strict";
/**
 * Wysyłka e-mail przez SMTP (CyberFolks).
 * Wymaga inject transportu (nodemailer w Node; w React Native inna implementacja).
 * Hasła tylko z CredentialStore (systemowy sejf).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMailWithCredentials = sendMailWithCredentials;
exports.getCyberFolksSmtpDefaults = getCyberFolksSmtpDefaults;
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
async function sendMailWithCredentials(credentials, transport, params) {
    await transport.send(credentials, params);
}
/** CyberFolks SMTP (typowe ustawienia). */
function getCyberFolksSmtpDefaults(host) {
    return {
        host: host ?? "poczta.cyberfolks.pl",
        port: 465,
        secure: true,
    };
}
