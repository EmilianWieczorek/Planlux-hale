"use strict";
/**
 * Generic HTTP API client for backend (Supabase or compatible).
 * No Google Apps Script. Requires baseUrl (e.g. Supabase project URL or Edge Function URL).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = exports.SheetsBadJsonError = void 0;
class SheetsBadJsonError extends Error {
    constructor(message, details) {
        super(message);
        this.code = "ERR_SHEETS_BAD_JSON";
        this.name = "SheetsBadJsonError";
        this.details = details;
    }
}
exports.SheetsBadJsonError = SheetsBadJsonError;
const BODY_SNIPPET_MAX = 2000;
function isJsonLike(contentType, bodyTrim) {
    const ct = (contentType || "").toLowerCase();
    if (ct.includes("application/json"))
        return true;
    const first = bodyTrim.slice(0, 50).trim();
    return first.startsWith("{") || first.startsWith("[");
}
class ApiClient {
    constructor(config) {
        this.baseUrl = config.baseUrl;
        this.fetchFn = config.fetchFn;
        this.appToken = config.appToken;
        this.timeoutMs = config.timeoutMs ?? 30000;
        this.retries = config.retries ?? 3;
        this.retryDelayMs = config.retryDelayMs ?? 1000;
        this.retryBackoffMultiplier = config.retryBackoffMultiplier ?? 2;
        this.log = config.log;
    }
    async request(url, options) {
        const method = (options?.method ?? "GET").toUpperCase();
        const headers = {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        };
        if (this.appToken)
            headers["X-App-Token"] = this.appToken;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        let lastErr = null;
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
                    const details = {
                        status: res.status,
                        contentType,
                        bodySnippet,
                        url,
                        method,
                    };
                    if (this.log) {
                        this.log("error", "[API] Backend zwrócił nie-JSON", {
                            url,
                            method,
                            status: res.status,
                            contentType,
                            bodySnippet: bodySnippet.slice(0, 500),
                        });
                    }
                    throw new SheetsBadJsonError("Backend zwrócił nieprawidłową odpowiedź (nie JSON).", details);
                }
                let data;
                try {
                    data = JSON.parse(rawBody);
                }
                catch (parseErr) {
                    const bodySnippet = bodyTrim.slice(0, BODY_SNIPPET_MAX);
                    const details = {
                        status: res.status,
                        contentType,
                        bodySnippet,
                        url,
                        method,
                    };
                    if (this.log) {
                        this.log("error", "[API] Nieprawidłowa odpowiedź JSON", {
                            url,
                            method,
                            status: res.status,
                            bodySnippet: bodySnippet.slice(0, 500),
                        });
                    }
                    throw new SheetsBadJsonError("Backend zwrócił nieprawidłową odpowiedź (błąd parsowania JSON).", details);
                }
                if (!res.ok)
                    throw new Error(data?.error ?? `HTTP ${res.status}`);
                return data;
            }
            catch (e) {
                if (e instanceof SheetsBadJsonError) {
                    clearTimeout(timeoutId);
                    throw e;
                }
                lastErr = e instanceof Error ? e : new Error(String(e));
                if (attempt < this.retries && (lastErr.name === "AbortError" || lastErr.message.includes("fetch"))) {
                    await new Promise((r) => setTimeout(r, delay));
                    delay *= this.retryBackoffMultiplier;
                }
                else {
                    clearTimeout(timeoutId);
                    throw lastErr;
                }
            }
        }
        clearTimeout(timeoutId);
        throw lastErr ?? new Error("Request failed");
    }
    async getMeta() {
        const url = `${this.baseUrl}?action=meta`;
        return this.request(url);
    }
    /** Lightweight meta check – tries ?meta=1 then ?action=meta */
    async getMetaLight() {
        for (const q of ["meta=1", "action=meta"]) {
            try {
                const url = `${this.baseUrl}?${q}`;
                const data = await this.request(url);
                if (data?.meta)
                    return { ok: true, meta: data.meta };
            }
            catch {
                continue;
            }
        }
        throw new Error("Failed to fetch meta");
    }
    async getBase() {
        const url = `${this.baseUrl}?action=base`;
        return this.request(url);
    }
    async logPdf(payload) {
        return this.request(`${this.baseUrl}`, {
            method: "POST",
            body: JSON.stringify({ action: "logPdf", payload }),
        });
    }
    async logEmail(payload) {
        return this.request(`${this.baseUrl}`, {
            method: "POST",
            body: JSON.stringify({ action: "logEmail", payload }),
        });
    }
    async heartbeat(payload) {
        return this.request(`${this.baseUrl}`, {
            method: "POST",
            body: JSON.stringify({ action: "heartbeat", payload }),
        });
    }
    /** Rezerwacja numeru oferty (online). Backend musi mieć endpoint reserveNumber. */
    async reserveOfferNumber(payload) {
        console.log("[API] reserveOfferNumber req", payload);
        try {
            const data = await this.request(`${this.baseUrl}`, {
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
        }
        catch (err) {
            console.error("[API] reserveOfferNumber err", err);
            throw err;
        }
    }
}
exports.ApiClient = ApiClient;
