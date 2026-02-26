/**
 * Testy: formatowanie numeru offline PLX-E0001/2026, inkrementacja offer_counters.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { getNextOfferNumber } from "./offerCounters";

describe("offerCounters", () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS offer_counters (
        id TEXT PRIMARY KEY,
        prefix TEXT NOT NULL,
        year INTEGER NOT NULL,
        next_seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_counters_prefix_year ON offer_counters(prefix, year);
    `);
  });

  it("generuje PLX-E0001/2026 dla pierwszego wywołania", () => {
    const n = getNextOfferNumber(db, "PLX", 2026, "E");
    expect(n).toBe("PLX-E0001/2026");
  });

  it("inkrementuje sekwencję w transakcji", () => {
    const n1 = getNextOfferNumber(db, "PLX", 2026, "E");
    const n2 = getNextOfferNumber(db, "PLX", 2026, "E");
    const n3 = getNextOfferNumber(db, "PLX", 2026, "E");
    expect(n1).toBe("PLX-E0001/2026");
    expect(n2).toBe("PLX-E0002/2026");
    expect(n3).toBe("PLX-E0003/2026");
  });

  it("rozróżnia handlowców (initial) i lata", () => {
    const e1 = getNextOfferNumber(db, "PLX", 2026, "E");
    const a1 = getNextOfferNumber(db, "PLX", 2026, "A");
    const e2 = getNextOfferNumber(db, "PLX", 2026, "E");
    expect(e1).toBe("PLX-E0001/2026");
    expect(a1).toBe("PLX-A0001/2026");
    expect(e2).toBe("PLX-E0002/2026");
  });

  it("formatuje SEQ4 z paddingiem", () => {
    for (let i = 0; i < 9998; i++) {
      getNextOfferNumber(db, "PLX", 2027, "X");
    }
    const n = getNextOfferNumber(db, "PLX", 2027, "X");
    expect(n).toBe("PLX-X9999/2027");
  });
});
