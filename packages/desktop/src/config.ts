/**
 * App config – backend is Supabase only (no Google Apps Script).
 * Single source for timeouts, appVersion, updates URL (optional; can be Supabase or custom).
 */

export const config = {
  backend: {
    url: process.env.SUPABASE_URL ?? "",
    timeoutMs: 30_000,
    retries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
  },
  updatesUrl: process.env.PLANLUX_UPDATES_URL ?? "",
  appVersion: process.env.npm_package_version ?? "1.0.0",
  heartbeatIntervalMs: 90_000,
  outboxFlushIntervalMs: 15_000,
  pdfOutputDir: "PlanluxOferty",
} as const;
