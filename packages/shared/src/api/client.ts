/**
 * Klient API do Google Apps Script Web App.
 * Wymaga inject fetch (np. node-fetch w Node, global fetch w Electron).
 */

import type {
  BaseResponse,
  MetaOnlyResponse,
  LogPdfPayload,
  LogEmailPayload,
  HeartbeatPayload,
  ReserveOfferNumberPayload,
  ReserveOfferNumberResponse,
} from "./types";

const DEFAULT_BASE_URL =
  "https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec";

export interface ApiClientConfig {
  baseUrl?: string;
  /** W Node użyj np. import('node-fetch') lub global fetch (Node 18+) */
  fetchFn: (url: string, options?: RequestInit) => Promise<Response>;
  appToken?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryBackoffMultiplier?: number;
  /** Opcjonalny logger do diagnostyki (np. przy ERR_SHEETS_BAD_JSON). */
  log?: (level: "error" | "warn", message: string, data?: unknown) => void;
}

/** Błąd gdy Apps Script zwróci nie-JSON (HTML/redirect). */
export interface SheetsBadJsonDetails {
  status: number;
  contentType: string;
  bodySnippet: string;
  url?: string;
  method?: string;
}

export class SheetsBadJsonError extends Error {
  code = "ERR_SHEETS_BAD_JSON" as const;
  details: SheetsBadJsonDetails;
  constructor(message: string, details: SheetsBadJsonDetails) {
    super(message);
    this.name = "SheetsBadJsonError";
    this.details = details;
  }
}

const BODY_SNIPPET_MAX = 2000;

function isJsonLike(contentType: string, bodyTrim: string): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("application/json")) return true;
  const first = bodyTrim.slice(0, 50).trim();
  return first.startsWith("{") || first.startsWith("[");
}

export class ApiClient {
  private baseUrl: string;
  private fetchFn: (url: string, options?: RequestInit) => Promise<Response>;
  private appToken?: string;
  private timeoutMs: number;
  private retries: number;
  private retryDelayMs: number;
  private retryBackoffMultiplier: number;
  private log?: ApiClientConfig["log"];

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchFn = config.fetchFn;
    this.appToken = config.appToken;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.retries = config.retries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.retryBackoffMultiplier = config.retryBackoffMultiplier ?? 2;
    this.log = config.log;
  }

  private async request<T>(url: string, options?: RequestInit): Promise<T> {
    const method = (options?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options?.headers as Record<string, string>) ?? {}),
    };
    if (this.appToken) headers["X-App-Token"] = this.appToken;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let lastErr: Error | null = null;
    let delay = this.retryDelayMs;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          ...options,
          headers: { ...headers, ...(options?.headers ?? {}) },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const contentType = res.headers.get("content-type") ?? "";
        const rawBody = await res.text();
        const bodyTrim = rawBody.trim();

        if (!isJsonLike(contentType, bodyTrim)) {
          const bodySnippet = bodyTrim.slice(0, BODY_SNIPPET_MAX);
          const details: SheetsBadJsonDetails = {
            status: res.status,
            contentType,
            bodySnippet,
            url,
            method,
          };
          if (this.log) {
            this.log("error", "[API] Apps Script zwrócił nie-JSON (HISTORIA_EMAIL / logEmail)", {
              url,
              method,
              status: res.status,
              contentType,
              bodySnippet: bodySnippet.slice(0, 500),
            });
          }
          throw new SheetsBadJsonError("Apps Script zwrócił nieprawidłową odpowiedź (nie JSON).", details);
        }

        let data: T & { ok?: boolean; error?: string };
        try {
          data = JSON.parse(rawBody) as T & { ok?: boolean; error?: string };
        } catch (parseErr) {
          const bodySnippet = bodyTrim.slice(0, BODY_SNIPPET_MAX);
          const details: SheetsBadJsonDetails = {
            status: res.status,
            contentType,
            bodySnippet,
            url,
            method,
          };
          if (this.log) {
            this.log("error", "[API] Nieprawidłowa odpowiedź JSON – parse error", {
              url,
              method,
              status: res.status,
              bodySnippet: bodySnippet.slice(0, 500),
            });
          }
          throw new SheetsBadJsonError("Apps Script zwrócił nieprawidłową odpowiedź (błąd parsowania JSON).", details);
        }

        if (!res.ok) throw new Error((data?.error as string) ?? `HTTP ${res.status}`);
        return data as T;
      } catch (e) {
        if (e instanceof SheetsBadJsonError) {
          clearTimeout(timeoutId);
          throw e;
        }
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.retries && (lastErr.name === "AbortError" || lastErr.message.includes("fetch"))) {
          await new Promise((r) => setTimeout(r, delay));
          delay *= this.retryBackoffMultiplier;
        } else {
          clearTimeout(timeoutId);
          throw lastErr;
        }
      }
    }
    clearTimeout(timeoutId);
    throw lastErr ?? new Error("Request failed");
  }

  async getMeta(): Promise<MetaOnlyResponse | BaseResponse> {
    const url = `${this.baseUrl}?action=meta`;
    return this.request<MetaOnlyResponse | BaseResponse>(url);
  }

  /** Lightweight meta check – tries ?meta=1 then ?action=meta */
  async getMetaLight(): Promise<{ ok: boolean; meta?: { version: number; lastUpdated: string } }> {
    for (const q of ["meta=1", "action=meta"]) {
      try {
        const url = `${this.baseUrl}?${q}`;
        const data = await this.request<{ ok?: boolean; meta?: { version: number; lastUpdated: string } }>(url);
        if (data?.meta) return { ok: true, meta: data.meta };
      } catch {
        continue;
      }
    }
    throw new Error("Failed to fetch meta");
  }

  async getBase(): Promise<BaseResponse> {
    const url = `${this.baseUrl}?action=base`;
    return this.request<BaseResponse>(url);
  }

  async logPdf(payload: LogPdfPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    return this.request(`${this.baseUrl}`, {
      method: "POST",
      body: JSON.stringify({ action: "logPdf", payload }),
    });
  }

  async logEmail(payload: LogEmailPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    return this.request(`${this.baseUrl}`, {
      method: "POST",
      body: JSON.stringify({ action: "logEmail", payload }),
    });
  }

  async heartbeat(payload: HeartbeatPayload): Promise<{ ok: boolean; message?: string; id?: string }> {
    return this.request(`${this.baseUrl}`, {
      method: "POST",
      body: JSON.stringify({ action: "heartbeat", payload }),
    });
  }

  /** Rezerwacja numeru oferty (online). Backend musi mieć endpoint reserveNumber. */
  async reserveOfferNumber(payload: ReserveOfferNumberPayload): Promise<ReserveOfferNumberResponse> {
    console.log("[API] reserveOfferNumber req", payload);
    try {
      const data = await this.request<ReserveOfferNumberResponse>(`${this.baseUrl}`, {
        method: "POST",
        body: JSON.stringify({ action: "reserveNumber", payload }),
      });
      console.log("[API] reserveOfferNumber res", data);
      if (!data?.ok && data?.error) {
        const msg = data.error;
        console.error("[API] reserveOfferNumber backend error:", msg);
        throw new Error(msg);
      }
      if (data?.offerNumber?.startsWith("TEMP-")) {
        console.error("[API] reserveOfferNumber backend zwrócił TEMP – traktuję jako błąd");
        throw new Error("Backend zwrócił numer tymczasowy (TEMP)");
      }
      return data;
    } catch (err) {
      console.error("[API] reserveOfferNumber err", err);
      throw err;
    }
  }
}
