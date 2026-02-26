/**
 * App config – backend URL, timeouts, appVersion.
 */

export const config = {
  backend: {
    url:
      process.env.PLANLUX_BACKEND_URL ??
      "https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec",
    timeoutMs: 30_000,
    retries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
  },
  appVersion: process.env.npm_package_version ?? "1.0.0",
  heartbeatIntervalMs: 90_000,
  outboxFlushIntervalMs: 15_000,
  pdfOutputDir: "PlanluxOferty",
} as const;
