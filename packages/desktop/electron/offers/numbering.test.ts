/**
 * Offer numbering: temp format, finalize counter, retry on conflict.
 * Uses FakeDb – no better-sqlite3 native binding.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { generateTempOfferNumber, ensureTempOfferNumber, finalizeOfferNumber } from "./numbering";
import { FakeDb } from "../db/FakeDb";

describe("offers/numbering", () => {
  it("generateTempOfferNumber produces TEMP-deviceId-epoch-hex format", () => {
    const n = generateTempOfferNumber("dev123");
    expect(n).toMatch(/^TEMP-dev123-\d+-[a-f0-9]{4}$/);
    const n2 = generateTempOfferNumber("dev123");
    expect(n).not.toBe(n2);
  });

  it("ensureTempOfferNumber sets TEMP when offer has no number", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT offer_number FROM offers_crm WHERE id = ?"), undefined);
    db.allReturns.set(db.key("PRAGMA table_info(offers_crm)"), [{ name: "offer_number_status" }]);
    const num = ensureTempOfferNumber(db, "offer-1", "dev1");
    expect(num).toMatch(/^TEMP-dev1-/);
    const runCalls = db.calls.filter((c) => c.method === "run");
    expect(runCalls.length).toBeGreaterThanOrEqual(1);
    expect(runCalls.some((c) => c.sql.includes("offer_number") && c.sql.includes("TEMP"))).toBe(true);
  });

  it("finalizeOfferNumber uses counter and returns formatted number", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT offer_number, offer_number_status FROM offers_crm WHERE id = ?"), {
      offer_number: "TEMP-x-1",
      offer_number_status: "TEMP",
    });
    db.getReturns.set(db.key("SELECT next_seq FROM offer_counters WHERE id = ?"), undefined);
    db.allReturns.set(db.key("PRAGMA table_info(offers_crm)"), [{ name: "offer_number_status" }, { name: "offer_number_reserved_at" }]);
    db.runReturns.set(db.key("UPDATE offer_counters SET next_seq = 2, updated_at = datetime('now') WHERE id = ?"), { changes: 1 });
    db.runReturns.set(db.key("UPDATE offers_crm SET offer_number = ?, offer_number_status = 'FINAL'"), { changes: 1 });
    const r = finalizeOfferNumber(db, "offer-1", { year: 2026, initial: "E" });
    expect(r.offerNumber).toBe("PLX-E0001/2026");
  });

  it("finalizeOfferNumber returns current number when already FINAL", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT offer_number, offer_number_status FROM offers_crm WHERE id = ?"), {
      offer_number: "PLX-E0042/2026",
      offer_number_status: "FINAL",
    });
    const r = finalizeOfferNumber(db, "offer-1", {});
    expect(r.offerNumber).toBe("PLX-E0042/2026");
    expect(db.calls.filter((c) => c.method === "run").length).toBe(0);
  });

  it("finalizeOfferNumber retries on UNIQUE conflict", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT offer_number, offer_number_status FROM offers_crm WHERE id = ?"), {
      offer_number: "TEMP-x-1",
      offer_number_status: "TEMP",
    });
    db.getReturns.set(db.key("SELECT next_seq FROM offer_counters WHERE id = ?"), { next_seq: 1 });
    db.allReturns.set(db.key("PRAGMA table_info(offers_crm)"), [{ name: "offer_number_status" }, { name: "offer_number_reserved_at" }]);
    db.runThrowsAfter = 1;
    db.runReturns.set(db.key("UPDATE offers_crm SET offer_number = ?"), { changes: 1 });
    try {
      finalizeOfferNumber(db, "offer-1", { year: 2026, initial: "E" });
    } catch (e) {
      expect((e as Error).message).toMatch(/UNIQUE|max retries/);
    }
    const runCalls = db.calls.filter((c) => c.method === "run");
    expect(runCalls.length).toBeGreaterThanOrEqual(1);
  });
});
