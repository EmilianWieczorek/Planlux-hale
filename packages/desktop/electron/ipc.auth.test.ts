/**
 * Testy sesji auth IPC: setSession/getSession. Handlery wymagają requireAuth() i zwracają
 * { ok: false, error: "Unauthorized" } lub "Forbidden" gdy brak sesji / zła rola.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import { setSession, getSession, type SessionUser } from "./ipc";

describe("IPC auth session", () => {
  const admin: SessionUser = { id: "a1", email: "admin@test.pl", role: "ADMIN", displayName: "Admin" };
  const sales: SessionUser = { id: "s1", email: "sales@test.pl", role: "SALESPERSON", displayName: "Handlowiec" };

  beforeEach(() => {
    setSession(null);
  });

  it("getSession returns null when no user", () => {
    expect(getSession()).toBeNull();
  });

  it("setSession and getSession roundtrip", () => {
    setSession(admin);
    expect(getSession()).toEqual(admin);
    setSession(sales);
    expect(getSession()).toEqual(sales);
    setSession(null);
    expect(getSession()).toBeNull();
  });
});
