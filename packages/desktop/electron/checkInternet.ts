/**
 * Real Internet connectivity check (not just LAN).
 * Uses a public endpoint with timeout; safe to call from main process.
 */
const CHECK_INTERNET_TIMEOUT_MS = 3000;
const CHECK_INTERNET_URL = "https://www.google.com/generate_204";

export async function checkInternet(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_INTERNET_TIMEOUT_MS);
  try {
    const res = await fetch(CHECK_INTERNET_URL, {
      method: "HEAD",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timeout);
    return res.ok || res.status === 204 || res.status < 500;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}
