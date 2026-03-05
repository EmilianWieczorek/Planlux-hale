/**
 * AppError: toPublic, fromUnknown, expose flag.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { AppError, authErrors } from "./AppError";

describe("AppError", () => {
  it("expose true returns message in toPublic", () => {
    const err = new AppError("TEST_CODE", "User-facing message", { expose: true });
    const pub = err.toPublic();
    expect(pub.code).toBe("TEST_CODE");
    expect(pub.message).toBe("User-facing message");
  });

  it("expose false returns generic message in toPublic", () => {
    const err = new AppError("TEST_CODE", "Internal detail", { expose: false });
    const pub = err.toPublic();
    expect(pub.code).toBe("TEST_CODE");
    expect(pub.message).toBe("Wystąpił błąd. Spróbuj ponownie.");
  });

  it("fromUnknown maps AUTH_SESSION_EXPIRED", () => {
    const err = AppError.fromUnknown(new Error("AUTH_SESSION_EXPIRED"));
    expect(err.code).toBe("AUTH_SESSION_EXPIRED");
    expect(err.expose).toBe(true);
  });

  it("fromUnknown maps UNIQUE constraint to DB_CONSTRAINT", () => {
    const err = AppError.fromUnknown(new Error("SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed"));
    expect(err.code).toBe("DB_CONSTRAINT");
  });

  it("fromUnknown wraps generic Error as UNKNOWN_ERROR", () => {
    const err = AppError.fromUnknown(new Error("Something broke"));
    expect(err.code).toBe("UNKNOWN_ERROR");
    expect(err.message).toBe("Something broke");
  });

  it("authErrors.invalidCredentials has stable code", () => {
    const err = authErrors.invalidCredentials();
    expect(err.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(err.toPublic().message).toContain("hasło");
  });
});
