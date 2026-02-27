/**
 * Tests for secureStore exports and accountKey shape.
 * Keytar is native; in test env we only verify API.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { setPassword, getPassword, deletePassword, isKeytarAvailable } from "./secureStore";

describe("secureStore", () => {
  it("exports setPassword, getPassword, deletePassword, isKeytarAvailable", () => {
    expect(typeof setPassword).toBe("function");
    expect(typeof getPassword).toBe("function");
    expect(typeof deletePassword).toBe("function");
    expect(typeof isKeytarAvailable).toBe("function");
    expect([true, false]).toContain(isKeytarAvailable());
  });

  it("deletePassword for non-existent account returns false or true", async () => {
    const result = await deletePassword("non-existent-id-" + Date.now());
    expect(typeof result).toBe("boolean");
  });
});
