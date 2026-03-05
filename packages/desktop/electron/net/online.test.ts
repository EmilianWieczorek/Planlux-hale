/**
 * Online detection: getOnlineState returns online/offline/unknown; never throws.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearConfigCache } from "../config";
import { getOnlineState, isOnline } from "./online";

describe("net/online", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearConfigCache();
    delete (process.env as NodeJS.ProcessEnv).SUPABASE_URL;
    delete (process.env as NodeJS.ProcessEnv).PLANLUX_BACKEND_URL;
  });

  it("getOnlineState returns unknown when no SUPABASE_URL or backendUrl", async () => {
    const state = await getOnlineState({});
    expect(state).toBe("unknown");
  });

  it("getOnlineState returns online when fetch resolves with 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200 })
    );
    const state = await getOnlineState({ backendUrl: "https://example.com", timeoutMs: 2000 });
    expect(state).toBe("online");
  });

  it("getOnlineState returns online when fetch resolves with 404 (host reachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 404 })
    );
    const state = await getOnlineState({ backendUrl: "https://example.com", timeoutMs: 2000 });
    expect(state).toBe("online");
  });

  it("getOnlineState returns offline when fetch throws (timeout/network)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network"))
    );
    const state = await getOnlineState({ backendUrl: "https://example.com", timeoutMs: 2000 });
    expect(state).toBe("offline");
  });

  it("getOnlineState never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unexpected")));
    await expect(getOnlineState({ backendUrl: "https://x.com" })).resolves.toBe("offline");
  });

  it("isOnline returns true only when state is online", async () => {
    process.env.PLANLUX_BACKEND_URL = "https://example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    expect(await isOnline(2000)).toBe(true);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("err")));
    expect(await isOnline(2000)).toBe(false);
    delete (process.env as NodeJS.ProcessEnv).PLANLUX_BACKEND_URL;
  });
});
