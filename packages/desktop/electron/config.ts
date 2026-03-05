/**
 * Central typed config for electron main process.
 * Env only; no hardcoded secrets. Dotenv loaded in dev/test.
 * Never log secrets – use sanitizeConfigForLog() or getPublicConfig().
 */

import { AppError } from "./errors/AppError";

export type EnvMode = "dev" | "production" | "test";

export type AppConfig = {
  mode: EnvMode;
  supabase: {
    url?: string;
    anonKey?: string;
  };
  backend: {
    url?: string;
    healthTimeoutMs: number;
  };
  session: {
    ttlHours: number;
  };
  seed: {
    adminInitialEmail: string;
    adminInitialPassword?: string;
  };
  device: {
    idFileName: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
};

/** No Google Apps Script. Backend is Supabase only; backend.url is derived from supabase.url when set. */

const HEALTH_TIMEOUT_MIN = 1500;
const HEALTH_TIMEOUT_MAX = 2500;
const SESSION_TTL_MIN = 1;
const SESSION_TTL_MAX = 168;
const LOG_LEVELS: AppConfig["logging"]["level"][] = ["debug", "info", "warn", "error"];

function clampHealthTimeout(ms: number): number {
  if (ms < HEALTH_TIMEOUT_MIN) return HEALTH_TIMEOUT_MIN;
  if (ms > HEALTH_TIMEOUT_MAX) return HEALTH_TIMEOUT_MAX;
  return ms;
}

function clampTtlHours(h: number): number {
  if (h < SESSION_TTL_MIN) return SESSION_TTL_MIN;
  if (h > SESSION_TTL_MAX) return SESSION_TTL_MAX;
  return h;
}

function resolveMode(): EnvMode {
  if (typeof process.env.NODE_ENV === "string" && process.env.NODE_ENV !== "") {
    const n = process.env.NODE_ENV.toLowerCase();
    if (n === "test") return "test";
    if (n === "production") return "production";
  }
  if (process.env.VITE_DEV_SERVER_URL) return "dev";
  return "production";
}

let dotenvLoaded = false;

function loadDotenvOnce(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const mode = resolveMode();
  if (mode !== "production") {
    try {
      const dotenv = require("dotenv");
      const path = require("path");
      const cwd = process.cwd();
      dotenv.config({ path: path.join(cwd, ".env") });
      dotenv.config({ path: path.join(cwd, "packages", "desktop", ".env") });
    } catch {
      // dotenv not installed or load failed – use process.env only
    }
  }
}

let cached: AppConfig | null = null;

/** Reset cache (for tests). */
export function clearConfigCache(): void {
  cached = null;
}

/**
 * Returns full config; caches after first call. In dev/test loads dotenv once.
 * Never throws for missing optional URLs/keys.
 */
export function getConfig(overrides?: Partial<AppConfig>): AppConfig {
  if (cached != null && overrides == null) return cached;

  loadDotenvOnce();
  const mode = resolveMode();

  const healthTimeoutRaw = Number(process.env.ONLINE_TIMEOUT_MS);
  const healthTimeoutMs = clampHealthTimeout(Number.isFinite(healthTimeoutRaw) ? healthTimeoutRaw : 2000);

  const ttlRaw = Number(process.env.SESSION_TTL_HOURS);
  const ttlHours = clampTtlHours(Number.isFinite(ttlRaw) ? ttlRaw : 12);

  const logLevelEnv = (process.env.LOG_LEVEL ?? process.env.PLANLUX_LOG_LEVEL ?? "").toLowerCase();
  const loggingLevel: AppConfig["logging"]["level"] =
    LOG_LEVELS.includes(logLevelEnv as AppConfig["logging"]["level"]) ? (logLevelEnv as AppConfig["logging"]["level"]) : mode === "production" ? "info" : "debug";

  const defaultSupabaseUrl = "https://fxsqwmflnzdnalkhwnuz.supabase.co";
  const defaultSupabaseAnonKey = "sb_publishable_-uI4LEze8IwCUmgK-K6Jkg_bJEDB-wl";
  const envUrl = process.env.SUPABASE_URL?.trim();
  const envKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const useFallbacks = mode !== "test";
  const supabaseUrl = envUrl || (useFallbacks ? defaultSupabaseUrl : undefined);
  const supabaseAnonKey = envKey || (useFallbacks ? defaultSupabaseAnonKey : undefined);
  const backendUrl = supabaseUrl || undefined;

  const config: AppConfig = {
    mode,
    supabase: {
      url: supabaseUrl,
      anonKey: supabaseAnonKey,
    },
    backend: {
      url: backendUrl,
      healthTimeoutMs,
    },
    session: { ttlHours },
    seed: {
      adminInitialEmail: process.env.ADMIN_INITIAL_EMAIL?.trim() || "admin@planlux.pl",
      adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD?.trim() || undefined,
    },
    device: { idFileName: "device-id.txt" },
    logging: { level: loggingLevel },
  };

  cached = overrides ? { ...config, ...overrides } : config;
  return cached;
}

/**
 * Backend URL (Supabase project URL). Required for online sync/auth; no fallback to legacy backend.
 */
export function getBackendUrl(config?: AppConfig): string {
  const c = config ?? getConfig();
  const url = c.supabase?.url ?? c.backend?.url;
  if (!url) throw new AppError("CONFIG_MISSING_SUPABASE", "Brak konfiguracji Supabase (SUPABASE_URL).", { expose: true });
  return url;
}

/**
 * Throws AppError if Supabase url or anonKey is missing. Use when a code path requires Supabase.
 */
export function requireSupabase(config: AppConfig): { url: string; anonKey: string } {
  const url = config.supabase.url?.trim();
  const anonKey = config.supabase.anonKey?.trim();
  if (!url || !anonKey) {
    throw new AppError("CONFIG_MISSING_SUPABASE", "Brak konfiguracji Supabase (SUPABASE_URL / SUPABASE_ANON_KEY).", { expose: true });
  }
  return { url, anonKey };
}

/**
 * Safe to send to renderer or expose in logs. No secrets.
 */
export function getPublicConfig(config: AppConfig): {
  mode: EnvMode;
  supabaseUrlPresent: boolean;
  backendUrlPresent: boolean;
  sessionTtlHours: number;
} {
  return {
    mode: config.mode,
    supabaseUrlPresent: !!config.supabase.url?.trim(),
    backendUrlPresent: !!config.backend.url?.trim(),
    sessionTtlHours: config.session.ttlHours,
  };
}

/**
 * Config copy safe for logging – secrets removed (anonKey, adminInitialPassword, etc.).
 * Logger redaction is still applied; this is extra safety.
 */
export function sanitizeConfigForLog(config: AppConfig): Record<string, unknown> {
  return {
    mode: config.mode,
    supabase: { urlPresent: !!config.supabase.url?.trim() },
    backend: { urlPresent: !!config.backend.url?.trim(), healthTimeoutMs: config.backend.healthTimeoutMs },
    session: { ttlHours: config.session.ttlHours },
    seed: { adminInitialEmail: config.seed.adminInitialEmail, passwordSet: !!config.seed.adminInitialPassword },
    device: config.device,
    logging: { level: config.logging.level },
  };
}
