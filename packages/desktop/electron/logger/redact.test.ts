/**
 * Redact: passwords, tokens, authorization, keys.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it("redacts password key", () => {
    expect(redact({ password: "secret123" })).toEqual({ password: "[REDACTED]" });
  });

  it("redacts token key", () => {
    expect(redact({ token: "abc", sessionToken: "xyz" })).toEqual({ token: "[REDACTED]", sessionToken: "[REDACTED]" });
  });

  it("redacts authorization header", () => {
    expect(redact({ authorization: "Bearer xyz" })).toEqual({ authorization: "[REDACTED]" });
  });

  it("redacts nested objects", () => {
    expect(redact({ user: { name: "a", password: "p" } })).toEqual({ user: { name: "a", password: "[REDACTED]" } });
  });

  it("leaves non-secret keys unchanged", () => {
    expect(redact({ email: "a@b.pl", message: "hi" })).toEqual({ email: "a@b.pl", message: "hi" });
  });

  it("redacts api_key and salt", () => {
    expect(redact({ api_key: "k", salt: "s" })).toEqual({ api_key: "[REDACTED]", salt: "[REDACTED]" });
  });

  it("returns primitives unchanged", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
