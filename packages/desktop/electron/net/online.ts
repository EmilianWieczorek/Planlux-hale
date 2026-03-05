/**
 * Online detection for auth and sync. No Google; prefer Supabase or backend URL.
 * Never throws; returns "online" | "offline" | "unknown".
 * Do not log full URLs or tokens. Uses electron config for URLs and timeout.
 */

import { getConfig } from "../config";

export type OnlineState = "online" | "offline" | "unknown";

const MIN_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 2500;

function clampTimeout(ms: number): number {
  if (ms < MIN_TIMEOUT_MS) return MIN_TIMEOUT_MS;
  if (ms > MAX_TIMEOUT_MS) return MAX_TIMEOUT_MS;
  return ms;
}

/**
 * Resolve online state. Uses config.supabase.url for health if set; else config.backend.url (POST health).
 * 200–499 = reachable (online). DNS/TLS/timeout = offline. Missing URL = unknown.
 */
export async function getOnlineState(opts?: {
  timeoutMs?: number;
  /** Override backend URL when Supabase URL is not set. */
  backendUrl?: string;
}): Promise<OnlineState> {
  const config = getConfig();
  const timeoutMs = clampTimeout(opts?.timeoutMs ?? config.backend.healthTimeoutMs);
  const supabaseUrl = config.supabase.url?.trim();
  const backendUrl = (opts?.backendUrl ?? config.backend.url ?? "").trim();

  let healthUrl: string | null = null;
  let method: "HEAD" | "POST" = "HEAD";
  let body: string | undefined;

  if (supabaseUrl) {
    healthUrl = supabaseUrl.replace(/\/$/, "") + "/rest/v1/";
    method = "HEAD";
  } else if (backendUrl) {
    healthUrl = backendUrl;
    method = "POST";
    body = JSON.stringify({ action: "health" });
  }

  if (!healthUrl) return "unknown";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(healthUrl, {
      method,
      signal: controller.signal,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
    });
    clearTimeout(t);
    if (res.status >= 200 && res.status < 500) return "online";
    return "offline";
  } catch {
    clearTimeout(t);
    return "offline";
  }
}

/**
 * Convenience: true only when getOnlineState() === "online".
 */
export async function isOnline(timeoutMs?: number): Promise<boolean> {
  const state = await getOnlineState({ timeoutMs });
  return state === "online";
}
