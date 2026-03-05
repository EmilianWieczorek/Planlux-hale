/**
 * Config: getConfig, clamps, sanitizeConfigForLog, getPublicConfig (no secrets).
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getConfig,
  clearConfigCache,
  getPublicConfig,
  sanitizeConfigForLog,
  requireSupabase,
  type AppConfig,
} from "./config";

describe("config", () => {
  beforeEach(() => {
    clearConfigCache();
    vi.stubEnv("NODE_ENV", "test");
    delete (process.env as NodeJS.ProcessEnv).SUPABASE_URL;
    delete (process.env as NodeJS.ProcessEnv).SUPABASE_ANON_KEY;
    delete (process.env as NodeJS.ProcessEnv).PLANLUX_BACKEND_URL;
    delete (process.env as NodeJS.ProcessEnv).ONLINE_TIMEOUT_MS;
    delete (process.env as NodeJS.ProcessEnv).SESSION_TTL_HOURS;
    delete (process.env as NodeJS.ProcessEnv).LOG_LEVEL;
    delete (process.env as NodeJS.ProcessEnv).ADMIN_INITIAL_EMAIL;
    delete (process.env as NodeJS.ProcessEnv).ADMIN_INITIAL_PASSWORD;
  });

  it("getConfig returns defaults and uses dev/test mode when NODE_ENV=test", () => {
    const cfg = getConfig();
    expect(cfg.mode).toBe("test");
    expect(cfg.session.ttlHours).toBe(12);
    expect(cfg.backend.healthTimeoutMs).toBe(2000);
    expect(cfg.seed.adminInitialEmail).toBe("admin@planlux.pl");
    expect(cfg.logging.level).toBe("debug");
  });

  it("clamps ONLINE_TIMEOUT_MS to 1500..2500", () => {
    process.env.ONLINE_TIMEOUT_MS = "1000";
    clearConfigCache();
    expect(getConfig().backend.healthTimeoutMs).toBe(1500);
    process.env.ONLINE_TIMEOUT_MS = "3000";
    clearConfigCache();
    expect(getConfig().backend.healthTimeoutMs).toBe(2500);
  });

  it("sanitizeConfigForLog removes anonKey and adminInitialPassword", () => {
    const cfg: AppConfig = {
      mode: "test",
      supabase: { url: "https://x.supabase.co", anonKey: "secret-key-123" },
      backend: { url: "https://api.example.com", healthTimeoutMs: 2000 },
      session: { ttlHours: 12 },
      seed: { adminInitialEmail: "admin@planlux.pl", adminInitialPassword: "secret123" },
      device: { idFileName: "device-id.txt" },
      logging: { level: "debug" },
    };
    const out = sanitizeConfigForLog(cfg);
    expect(out).toHaveProperty("mode");
    expect(out).toHaveProperty("supabase");
    expect((out.supabase as Record<string, unknown>).urlPresent).toBe(true);
    expect((out.supabase as Record<string, unknown>).anonKey).toBeUndefined();
    expect(out).toHaveProperty("seed");
    expect((out.seed as Record<string, unknown>).passwordSet).toBe(true);
    expect((out.seed as Record<string, unknown>).adminInitialPassword).toBeUndefined();
  });

  it("getPublicConfig does not include secrets", () => {
    const cfg: AppConfig = {
      mode: "dev",
      supabase: { url: "https://x.supabase.co", anonKey: "anon-secret" },
      backend: { url: "https://api.example.com", healthTimeoutMs: 2000 },
      session: { ttlHours: 24 },
      seed: { adminInitialEmail: "a@b.pl", adminInitialPassword: "pwd" },
      device: { idFileName: "device-id.txt" },
      logging: { level: "info" },
    };
    const pub = getPublicConfig(cfg);
    expect(pub.mode).toBe("dev");
    expect(pub.supabaseUrlPresent).toBe(true);
    expect(pub.backendUrlPresent).toBe(true);
    expect(pub.sessionTtlHours).toBe(24);
    expect(JSON.stringify(pub)).not.toContain("anon");
    expect(JSON.stringify(pub)).not.toContain("pwd");
  });

  it("requireSupabase throws when url or anonKey missing", () => {
    const cfg = getConfig();
    try {
      requireSupabase(cfg);
      expect.fail("should throw");
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe("CONFIG_MISSING_SUPABASE");
    }
    clearConfigCache();
    process.env.SUPABASE_URL = "https://x.supabase.co";
    try {
      requireSupabase(getConfig());
      expect.fail("should throw");
    } catch (e: unknown) {
      expect((e as { code?: string }).code).toBe("CONFIG_MISSING_SUPABASE");
    }
    process.env.SUPABASE_ANON_KEY = "anon-key";
    clearConfigCache();
    const result = requireSupabase(getConfig());
    expect(result.url).toBe("https://x.supabase.co");
    expect(result.anonKey).toBe("anon-key");
  });
});
