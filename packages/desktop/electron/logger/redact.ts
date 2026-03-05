/**
 * Redact secrets from objects/values before logging. Never log passwords, tokens, keys.
 */

const SECRET_KEYS = [
  /pass(word)?/i,
  /token/i,
  /authorization/i,
  /auth[-_]?header/i,
  /api[-_]?key/i,
  /secret/i,
  /supabase[-_]?anon[-_]?key/i,
  /supabase[-_]?service/i,
  /bearer/i,
];
const MASK = "[REDACTED]";

function keyShouldRedact(key: string): boolean {
  const k = String(key);
  if (SECRET_KEYS.some((r) => r.test(k))) return true;
  if (/^key$/i.test(k)) return true;
  if (/^salt$/i.test(k)) return true;
  if (/hash$/i.test(k) && /password|pass/.test(k)) return true;
  return false;
}

export function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = keyShouldRedact(k) ? MASK : redact(v);
    }
    return out;
  }
  return value;
}
