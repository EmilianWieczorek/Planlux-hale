/**
 * App config – backend URL (Apps Script Web App), timeouts, appVersion.
 * Single source for base sync, auth, pdf/email logging.
 */
export const APPS_SCRIPT_BASE_URL =
  process.env.PLANLUX_BACKEND_URL ??
  "https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec";

export const config = {
  backend: {
    url: APPS_SCRIPT_BASE_URL,
    timeoutMs: 30_000,
    retries: 3,
    retryDelayMs: 1000,
    retryBackoffMultiplier: 2,
  },
  /** Full URL to Apps Script Web App /exec (no query). Used for action=version and action=history. Env PLANLUX_UPDATES_URL optional. */
  updatesUrl:
    process.env.PLANLUX_UPDATES_URL ??
    "https://script.google.com/macros/s/AKfycbyMSWhq-YwwwBDwtmxiyzwP8TOmnHOGovt4aS4QNlqiZqUqIo9xVMnfmnZPz_D0XUWJAQ/exec",
  appVersion: process.env.npm_package_version ?? "1.0.0",
  heartbeatIntervalMs: 90_000,
  outboxFlushIntervalMs: 15_000,
  pdfOutputDir: "PlanluxOferty",
} as const;
