/**
 * Offer numbering: TEMP offline, FINAL on finalize with transactional counter + retry.
 * All DB access via bound parameters (db helpers).
 */

import crypto from "crypto";
import type { DbLike } from "../db/types";
import { qGet, qAll, qRun, withTx } from "../db/helpers";

const MAX_FINALIZE_RETRIES = 5;
const TEMP_RAND_BYTES = 2;

/** TEMP-<deviceId>-<epoch>-<rand4> (hex) */
export function generateTempOfferNumber(deviceId: string): string {
  const epoch = Date.now();
  const rand = crypto.randomBytes(TEMP_RAND_BYTES).toString("hex");
  return `TEMP-${deviceId}-${epoch}-${rand}`;
}

/**
 * Ensure offer has a number; if missing or empty set TEMP. Returns the offer number.
 */
export function ensureTempOfferNumber(db: DbLike, offerId: string, deviceId: string): string {
  const row = qGet(db, "SELECT offer_number FROM offers_crm WHERE id = ?", [offerId]) as { offer_number?: string } | undefined;
  const current = row?.offer_number?.trim();
  if (current) return current;
  const temp = generateTempOfferNumber(deviceId);
  const hasStatus = (qAll(db, "PRAGMA table_info(offers_crm)") as Array<{ name: string }>).some((c) => c.name === "offer_number_status");
  if (hasStatus) {
    qRun(db, "UPDATE offers_crm SET offer_number = ?, offer_number_status = 'TEMP', updated_at = datetime('now') WHERE id = ?", [temp, offerId]);
  } else {
    qRun(db, "UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?", [temp, offerId]);
  }
  return temp;
}

export type FinalizeOptions = {
  year?: number;
  prefix?: string;
  initial?: string;
  deviceId?: string;
};

/**
 * Assign final offer number using transactional counter. Retries on UNIQUE conflict.
 * If offer already has FINAL status, returns current number.
 */
export function finalizeOfferNumber(db: DbLike, offerId: string, opts: FinalizeOptions = {}): { offerNumber: string } {
  const year = opts.year ?? new Date().getFullYear();
  const prefix = opts.prefix ?? "PLX";
  const initial = opts.initial ?? "E";
  const counterId = `${prefix}-${initial}-${year}`;

  const row = qGet(db, "SELECT offer_number, offer_number_status FROM offers_crm WHERE id = ?", [offerId]) as
    | { offer_number?: string; offer_number_status?: string }
    | undefined;
  if (!row) throw new Error("Offer not found");
  if (row.offer_number_status === "FINAL" && row.offer_number && !row.offer_number.startsWith("TEMP-")) {
    return { offerNumber: row.offer_number };
  }

  const hasStatus = (qAll(db, "PRAGMA table_info(offers_crm)") as Array<{ name: string }>).some((c) => c.name === "offer_number_status");
  const hasReservedAt = (qAll(db, "PRAGMA table_info(offers_crm)") as Array<{ name: string }>).some((c) => c.name === "offer_number_reserved_at");

  for (let attempt = 0; attempt < MAX_FINALIZE_RETRIES; attempt++) {
    try {
      const result = withTx(db, () => {
        const counterRow = qGet(db, "SELECT next_seq FROM offer_counters WHERE id = ?", [counterId]) as { next_seq?: number } | undefined;
        let seq: number;
        if (!counterRow) {
          qRun(db, "INSERT OR IGNORE INTO offer_counters (id, prefix, year, next_seq, updated_at) VALUES (?, ?, ?, 1, datetime('now'))", [
            counterId,
            `${prefix}-${initial}`,
            year,
          ]);
          seq = 1;
          qRun(db, "UPDATE offer_counters SET next_seq = 2, updated_at = datetime('now') WHERE id = ?", [counterId]);
        } else {
          seq = counterRow.next_seq ?? 1;
          qRun(db, "UPDATE offer_counters SET next_seq = next_seq + 1, updated_at = datetime('now') WHERE id = ?", [counterId]);
        }
        const seqStr = String(seq).padStart(4, "0");
        const offerNumber = `${prefix}-${initial}${seqStr}/${year}`;
        if (hasStatus && hasReservedAt) {
          qRun(db, "UPDATE offers_crm SET offer_number = ?, offer_number_status = 'FINAL', offer_number_reserved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [
            offerNumber,
            offerId,
          ]);
        } else if (hasStatus) {
          qRun(db, "UPDATE offers_crm SET offer_number = ?, offer_number_status = 'FINAL', updated_at = datetime('now') WHERE id = ?", [offerNumber, offerId]);
        } else {
          qRun(db, "UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?", [offerNumber, offerId]);
        }
        return offerNumber;
      });
      return { offerNumber: result };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isUnique = msg.includes("UNIQUE") || msg.includes("SQLITE_CONSTRAINT");
      if (isUnique && attempt < MAX_FINALIZE_RETRIES - 1) continue;
      throw e;
    }
  }
  throw new Error("finalizeOfferNumber: max retries exceeded");
}
