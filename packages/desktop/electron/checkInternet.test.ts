/**
 * Unit tests for checkInternet (real connectivity, not just navigator.onLine).
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("checkInternet", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    globalThis.fetch = originalFetch;
  });

  it("returns true when fetch succeeds with 204", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));
    const { checkInternet } = await import("./checkInternet");
    const result = await checkInternet();
    expect(result).toBe(true);
  });

  it("returns true when fetch succeeds with 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const { checkInternet } = await import("./checkInternet");
    const result = await checkInternet();
    expect(result).toBe(true);
  });

  it("returns false when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const { checkInternet } = await import("./checkInternet");
    const result = await checkInternet();
    expect(result).toBe(false);
  });

  it("returns false when response is 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { checkInternet } = await import("./checkInternet");
    const result = await checkInternet();
    expect(result).toBe(false);
  });
});
