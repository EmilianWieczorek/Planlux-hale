/**
 * Idempotent migration: ensure email_history has to_email; backfill from to_addr if needed.
 * Safe to run multiple times.
 */

import type { DbLike } from "../types";
import { qGet, qAll, qRun } from "../helpers";

function hasTable(db: DbLike, name: string): boolean {
  const row = qGet(db, "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]) as { name?: string } | undefined;
  return row?.name === name;
}

function hasColumn(db: DbLike, table: string, column: string): boolean {
  if (!/^[a-zA-Z0-9_]+$/.test(table) || !/^[a-zA-Z0-9_]+$/.test(column)) return false;
  const info = qAll(db, `PRAGMA table_info(${table})`) as Array<{ name: string }>;
  return info.some((c) => c.name === column);
}

export function runEmailHistoryToEmailMigration(
  database: DbLike,
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, e?: unknown) => void }
): void {
  try {
    if (!hasTable(database, "email_history")) {
      logger.info("[migration] email_history_to_email skipped (no table)");
      return;
    }
    const hasToAddr = hasColumn(database, "email_history", "to_addr");
    const hasToEmail = hasColumn(database, "email_history", "to_email");
    if (!hasToAddr && !hasToEmail) {
      logger.info("[migration] email_history_to_email skipped (no to_addr or to_email)");
      return;
    }
    if (!hasToEmail) {
      database.exec("ALTER TABLE email_history ADD COLUMN to_email TEXT DEFAULT NULL");
      logger.info("[migration] email_history to_email column added");
    }
    if (hasToAddr) {
      const r = qRun(
        database,
        "UPDATE email_history SET to_email = COALESCE(NULLIF(TRIM(to_email), ''), to_addr) WHERE to_email IS NULL OR TRIM(to_email) = ''"
      );
      if (r.changes > 0) logger.info("[migration] email_history to_email backfilled from to_addr", { rows: r.changes });
    }
    logger.info("[migration] email_history_to_email done");
  } catch (e) {
    logger.warn("[migration] email_history_to_email failed", e);
  }
}
