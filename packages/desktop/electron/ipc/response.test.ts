/**
 * wrapIpcHandler: ok:true for object, ok:false on throw with correlationId.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { wrapIpcHandler } from "./response";

const noopLog = () => {};

describe("wrapIpcHandler", () => {
  it("returns ok:true and spreads object result", async () => {
    const wrapped = wrapIpcHandler("test", async () => ({ ok: true, user: { id: "1" } }), { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(true);
    expect((result as Record<string, unknown>).user).toEqual({ id: "1" });
  });

  it("returns ok:false with error and correlationId on throw", async () => {
    const wrapped = wrapIpcHandler("test", async () => {
      throw new Error("Something failed");
    }, { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string; message: string }; correlationId?: string }).error).toBeDefined();
    expect((result as { error: { code: string } }).error.code).toBe("UNKNOWN_ERROR");
    expect((result as { correlationId?: string }).correlationId).toBeDefined();
  });

  it("preserves legacy error string for backward compat", async () => {
    const wrapped = wrapIpcHandler("test", async () => {
      throw new Error("Bad request");
    }, { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as Record<string, unknown>).error).toBeDefined();
    expect((result as Record<string, unknown>).errorCode).toBe("UNKNOWN_ERROR");
  });

  it("passes through existing ok:false from handler", async () => {
    const wrapped = wrapIpcHandler("test", async () => ({ ok: false, error: "Invalid input" }), { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as { error: { message: string } }).error.message).toBe("Invalid input");
  });
});
