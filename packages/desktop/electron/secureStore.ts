/**
 * Secure password storage: keytar (OS keychain) with AES fallback.
 * - Windows: Credential Vault
 * - macOS: Keychain
 * - Linux: secret service
 * If keytar is unavailable, use AES-256-GCM with a per-device key stored in app userData.
 */

const SERVICE_NAME = "PlanluxHaleSMTP";

function accountKey(accountId: string): string {
  return `smtp:${accountId}`;
}

let keytarModule: { getPassword: (s: string, a: string) => Promise<string | null>; setPassword: (s: string, a: string, p: string) => Promise<void>; deletePassword: (s: string, a: string) => Promise<boolean> } | null = null;

try {
  keytarModule = require("keytar");
} catch {
  keytarModule = null;
}

// Fallback: AES-256-GCM with key derived from machine id / userData path
import { app } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const ALG = "aes-256-gcm";
const IV_LEN = 16;
const AUTH_TAG_LEN = 16;
const KEY_LEN = 32;

function getFallbackKeyPath(): string {
  return path.join(app.getPath("userData"), ".smtp_key");
}

function getOrCreateFallbackKey(): Buffer {
  const keyPath = getFallbackKeyPath();
  try {
    if (fs.existsSync(keyPath)) {
      const raw = fs.readFileSync(keyPath, "utf-8").trim();
      const buf = Buffer.from(raw, "hex");
      if (buf.length === KEY_LEN) return buf;
    }
  } catch {
    /* ignore */
  }
  const key = crypto.randomBytes(KEY_LEN);
  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key.toString("hex"), "utf-8");
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[secureStore] could not persist fallback key", e);
    }
  }
  return key;
}

function encryptFallback(plain: string): string {
  const key = getOrCreateFallbackKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = (cipher as crypto.CipherGCM).getAuthTag();
  return Buffer.concat([iv, authTag, enc]).toString("base64");
}

function decryptFallback(ciphertext: string): string {
  const key = getOrCreateFallbackKey();
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LEN + AUTH_TAG_LEN) throw new Error("Invalid ciphertext");
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const enc = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  (decipher as crypto.DecipherGCM).setAuthTag(authTag);
  return decipher.update(enc) + decipher.final("utf8");
}

const FALLBACK_STORE = new Map<string, string>();

function fallbackFilePath(): string {
  return path.join(app.getPath("userData"), "smtp_passwords.enc");
}

function loadFallbackStore(): void {
  try {
    const p = fallbackFilePath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as Record<string, string>;
    Object.entries(data).forEach(([k, v]) => FALLBACK_STORE.set(k, v));
  } catch {
    /* ignore */
  }
}

function saveFallbackStore(): void {
  try {
    const obj: Record<string, string> = {};
    FALLBACK_STORE.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(fallbackFilePath(), JSON.stringify(obj), "utf-8");
  } catch (e) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[secureStore] could not persist fallback store", e);
    }
  }
}

export async function setPassword(accountId: string, password: string): Promise<void> {
  const key = accountKey(accountId);
  if (keytarModule) {
    await keytarModule.setPassword(SERVICE_NAME, key, password);
    return;
  }
  loadFallbackStore();
  FALLBACK_STORE.set(key, encryptFallback(password));
  saveFallbackStore();
}

export async function getPassword(accountId: string): Promise<string | null> {
  const key = accountKey(accountId);
  if (keytarModule) {
    return await keytarModule.getPassword(SERVICE_NAME, key);
  }
  loadFallbackStore();
  const enc = FALLBACK_STORE.get(key);
  if (!enc) return null;
  try {
    return decryptFallback(enc);
  } catch {
    return null;
  }
}

export async function deletePassword(accountId: string): Promise<boolean> {
  const key = accountKey(accountId);
  if (keytarModule) {
    return await keytarModule.deletePassword(SERVICE_NAME, key);
  }
  loadFallbackStore();
  const had = FALLBACK_STORE.has(key);
  FALLBACK_STORE.delete(key);
  saveFallbackStore();
  return had;
}

export function isKeytarAvailable(): boolean {
  return keytarModule != null;
}

/** Per-user SMTP password (key = smtp:${userId}). Use for salesperson @planlux.pl accounts. */
export async function setSmtpPassword(userId: string, password: string): Promise<void> {
  return setPassword(userId, password);
}

export async function getSmtpPassword(userId: string): Promise<string | null> {
  return getPassword(userId);
}

export async function deleteSmtpPassword(userId: string): Promise<boolean> {
  return deletePassword(userId);
}
