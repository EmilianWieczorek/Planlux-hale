/**
 * Lokalna numeracja ofert PLX-{INITIAL}{SEQ4}/{YEAR}.
 * Używane gdy offline lub reserveOfferNumber się nie powiedzie.
 */

type Database = ReturnType<typeof import("better-sqlite3")>;

/** Generuje następny numer oferty PLX-{INITIAL}{SEQ4}/{YEAR} (np. PLX-E0001/2026) w transakcji. */
export function getNextOfferNumber(
  db: Database,
  prefix: string,
  year: number,
  initial: string
): string {
  const id = `${prefix}-${initial}-${year}`;
  return db.transaction(() => {
    const row = db.prepare("SELECT next_seq FROM offer_counters WHERE id = ?").get(id) as
      | { next_seq: number }
      | undefined;
    if (!row) {
      db.prepare(
        "INSERT INTO offer_counters (id, prefix, year, next_seq, updated_at) VALUES (?, ?, ?, 2, datetime('now'))"
      ).run(id, `${prefix}-${initial}`, year);
      return `PLX-${initial}0001/${year}`;
    }
    const seq = row.next_seq;
    db.prepare("UPDATE offer_counters SET next_seq = next_seq + 1, updated_at = datetime('now') WHERE id = ?").run(id);
    const seqStr = String(seq).padStart(4, "0");
    return `PLX-${initial}${seqStr}/${year}`;
  })();
}
