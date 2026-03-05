/**
 * Password hashing and validation.
 * - Per-user random salt, scrypt, algo version for future upgrades.
 * - Legacy support: verify old single-salt hashes and allow upgrade on login.
 */

import crypto from "crypto";

const SALT_LEN = 24;
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/** Legacy single salt (only for verifying old hashes). */
export const LEGACY_SALT = "planlux-hale-v1";

export const PASSWORD_ALGO_VERSION = 1;

export interface HashResult {
  hash: string;
  salt: string;
  version: number;
}

export interface UserPasswordRow {
  password_hash: string;
  password_salt?: string | null;
  password_algo_version?: number | null;
  password_unavailable?: number | null;
}

/**
 * Validate password rules: 8–128 chars, at least 1 letter + 1 digit.
 */
export function validatePassword(plain: string): { ok: true } | { ok: false; reason: string } {
  if (typeof plain !== "string") return { ok: false, reason: "Hasło musi być tekstem" };
  const p = plain;
  if (p.length < MIN_LENGTH) return { ok: false, reason: "Hasło musi mieć co najmniej 8 znaków" };
  if (p.length > MAX_LENGTH) return { ok: false, reason: "Hasło może mieć co najwyżej 128 znaków" };
  const hasLetter = /[a-zA-Z]/.test(p);
  const hasDigit = /\d/.test(p);
  if (!hasLetter) return { ok: false, reason: "Hasło musi zawierać co najmniej jedną literę" };
  if (!hasDigit) return { ok: false, reason: "Hasło musi zawierać co najmniej jedną cyfrę" };
  return { ok: true };
}

/**
 * Hash password with a new random salt. Returns hash (hex), salt (hex), version.
 */
export function hashPassword(plain: string): HashResult {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return {
    hash: hash.toString("hex"),
    salt: salt.toString("hex"),
    version: PASSWORD_ALGO_VERSION,
  };
}

/**
 * Legacy hash (single app salt). Used only for verification of old records.
 */
function legacyHash(plain: string): string {
  return crypto.scryptSync(plain, LEGACY_SALT, 64).toString("hex");
}

/**
 * Verify password against stored user row. Supports legacy (no salt / algo 0) and new scheme.
 * Does not check password_unavailable; caller must enforce that.
 */
export function verifyPassword(plain: string, row: UserPasswordRow): boolean {
  const hash = row.password_hash;
  if (!hash || !plain) return false;
  const version = row.password_algo_version ?? 0;
  const saltHex = row.password_salt ?? null;
  if (version >= PASSWORD_ALGO_VERSION && saltHex) {
    try {
      const salt = Buffer.from(saltHex, "hex");
      const computed = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
      return crypto.timingSafeEqual(computed, Buffer.from(hash, "hex"));
    } catch {
      return false;
    }
  }
  const legacy = legacyHash(plain);
  return crypto.timingSafeEqual(Buffer.from(legacy, "hex"), Buffer.from(hash, "hex"));
}

/**
 * Whether the user row uses legacy hashing (no per-user salt).
 */
export function isLegacyHash(row: UserPasswordRow): boolean {
  const v = row.password_algo_version ?? 0;
  return v < PASSWORD_ALGO_VERSION || !row.password_salt;
}
