/**
 * Implementacja OutboxStorage dla Electron – SQLite (better-sqlite3).
 * Używać w procesie main.
 */

import type { OutboxStorage, OutboxRecord } from "@planlux/shared";

/** Minimal DB interface compatible with better-sqlite3. */
export type Db = {
  prepare: (sql: string) => {
    run: (...args: unknown[]) => unknown;
    all: (...args: unknown[]) => unknown[];
  };
};

export function createOutboxStorage(db: Db): OutboxStorage {
  return {
    async getPending(): Promise<OutboxRecord[]> {
      // Kolejność z ARCHITECTURE-ULTRA: HEARTBEAT → LOG_PDF → SEND_EMAIL → LOG_EMAIL → OFFER_SYNC
      const rows = db.prepare(
        `SELECT id, operation_type, payload_json, retry_count, max_retries, last_error, created_at, processed_at
         FROM outbox WHERE processed_at IS NULL
         ORDER BY CASE operation_type
           WHEN 'HEARTBEAT' THEN 1 WHEN 'LOG_PDF' THEN 2 WHEN 'SEND_EMAIL' THEN 3
           WHEN 'LOG_EMAIL' THEN 4 WHEN 'OFFER_SYNC' THEN 5 ELSE 6 END,
         created_at ASC`
      ).all() as unknown as OutboxRecord[];
      return rows;
    },

    markProcessed(id: string): void {
      db.prepare("UPDATE outbox SET processed_at = datetime('now') WHERE id = ?").run(id);
    },

    markFailed(id: string, error: string, incrementRetry: boolean): void {
      if (incrementRetry) {
        db.prepare(
          "UPDATE outbox SET retry_count = retry_count + 1, last_error = ? WHERE id = ?"
        ).run(error, id);
      } else {
        db.prepare("UPDATE outbox SET last_error = ?, processed_at = datetime('now') WHERE id = ?").run(error, id);
      }
    },
  };
}
