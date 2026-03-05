/**
 * F4-batch: wrapIpcHandler + AppError normalization and legacy fields.
 * No electron runtime or native modules.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { wrapIpcHandler } from "./response";
import { AppError, authErrors } from "../errors/AppError";

const noopLog = () => {};

describe("ipc wrap batch", () => {
  it("handler throws AppError(expose true) -> returns ok:false with error.code, error.message, errorCode, correlationId", async () => {
    const wrapped = wrapIpcHandler("test", async () => {
      throw authErrors.invalidCredentials();
    }, { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect((result as { error: { message: string } }).error.message).toContain("hasło");
    expect((result as Record<string, unknown>).errorCode).toBe("AUTH_INVALID_CREDENTIALS");
    expect((result as { correlationId?: string }).correlationId).toBeDefined();
  });

  it("handler returns { ok: false, error: 'x' } -> normalized error object + errorCode", async () => {
    const wrapped = wrapIpcHandler("test", async () => ({ ok: false, error: "Something went wrong" }), { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBeDefined();
    expect((result as { error: { message: string } }).error.message).toBe("Something went wrong");
    expect((result as Record<string, unknown>).errorCode).toBeDefined();
  });

  it("handler returns { user, token } -> ok:true and spreads fields + correlationId optional", async () => {
    const wrapped = wrapIpcHandler("test", async () => ({
      user: { id: "u1", email: "a@b.pl", role: "ADMIN", displayName: "Admin" },
      token: "sess-token-123",
    }), { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(true);
    expect((result as Record<string, unknown>).user).toEqual({ id: "u1", email: "a@b.pl", role: "ADMIN", displayName: "Admin" });
    expect((result as Record<string, unknown>).token).toBe("sess-token-123");
  });

  it("handler throws AppError AUTH_SESSION_EXPIRED -> error.code and expose message", async () => {
    const wrapped = wrapIpcHandler("test", async () => {
      throw authErrors.sessionExpired();
    }, { log: noopLog });
    const result = await wrapped(null);
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe("AUTH_SESSION_EXPIRED");
    expect((result as { error: { message: string } }).error.message).toContain("Sesja");
  });
});
