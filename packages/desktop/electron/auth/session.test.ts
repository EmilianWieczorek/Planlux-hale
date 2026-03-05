/**
 * Session module: createSession, getSession, isSessionValid, revokeSession, requireValidSession.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as session from "./session";

const user = { id: "u1", email: "u@test.pl", role: "ADMIN", displayName: "User" };

describe("auth/session", () => {
  beforeEach(() => {
    session.revokeSession();
  });

  it("createSession returns session with issuedAt and expiresAt", () => {
    const s = session.createSession(user);
    expect(s.userId).toBe(user.id);
    expect(s.email).toBe(user.email);
    expect(s.role).toBe(user.role);
    expect(s.issuedAt).toBeLessThanOrEqual(Date.now());
    expect(s.expiresAt).toBeGreaterThan(Date.now());
    expect(s.token).toBeDefined();
    expect(typeof s.token).toBe("string");
  });

  it("getSession returns current session after createSession", () => {
    const s = session.createSession(user);
    const current = session.getCurrentSession();
    expect(current).not.toBeNull();
    expect(current?.userId).toBe(user.id);
    expect(current?.token).toBe(s.token);
  });

  it("isSessionValid is true for newly created session", () => {
    const s = session.createSession(user);
    expect(session.isSessionValid(s)).toBe(true);
  });

  it("revokeSession clears session so getSession returns null", () => {
    session.createSession(user);
    expect(session.getCurrentSession()).not.toBeNull();
    session.revokeSession();
    expect(session.getCurrentSession()).toBeNull();
    expect(session.getSession()).toBeNull();
  });

  it("requireValidSession returns session when valid", () => {
    const s = session.createSession(user);
    const u = session.requireValidSession(s.token);
    expect(u.userId).toBe(user.id);
  });

  it("requireValidSession throws AUTH_SESSION_EXPIRED when no session", () => {
    expect(() => session.requireValidSession()).toThrow("AUTH_SESSION_EXPIRED");
  });

  it("requireRole throws Forbidden when role not allowed", () => {
    session.createSession(user);
    expect(() => session.requireRole(null, ["HANDLOWIEC"])).toThrow("Forbidden");
  });

  it("requireRole returns user when role allowed", () => {
    session.createSession(user);
    const u = session.requireRole(null, ["ADMIN", "SZEF"]);
    expect(u.id).toBe(user.id);
    expect(u.role).toBe("ADMIN");
  });
});
