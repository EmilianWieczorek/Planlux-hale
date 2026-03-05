/**
 * Email history to_email migration: idempotent, backfill from to_addr.
 * Uses FakeDb – no better-sqlite3.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { runEmailHistoryToEmailMigration } from "./0001_email_history_to_email";
import { FakeDb } from "../FakeDb";

describe("db/migrations email_history_to_email", () => {
  it("when to_addr exists and to_email missing, migration runs ALTER and UPDATE", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT name FROM sqlite_master WHERE type='table' AND name = ?"), { name: "email_history" });
    db.allReturns.set(db.key("PRAGMA table_info(email_history)"), [{ name: "id" }, { name: "to_addr" }]);
    const log: string[] = [];
    const logger = { info: (m: string) => log.push(m), warn: () => {} };
    runEmailHistoryToEmailMigration(db, logger);
    expect(log.some((m) => m.includes("to_email"))).toBe(true);
    expect(db.execCalls.some((s) => s.includes("ALTER TABLE email_history ADD COLUMN to_email"))).toBe(true);
  });

  it("idempotent: when to_email already exists, no ALTER", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT name FROM sqlite_master WHERE type='table' AND name = ?"), { name: "email_history" });
    db.allReturns.set(db.key("PRAGMA table_info(email_history)"), [{ name: "id" }, { name: "to_addr" }, { name: "to_email" }]);
    const log: string[] = [];
    const logger = { info: (m: string) => log.push(m), warn: () => {} };
    runEmailHistoryToEmailMigration(db, logger);
    const alterCalls = db.calls.filter((c) => c.sql.includes("ALTER TABLE"));
    expect(alterCalls.length).toBe(0);
  });

  it("skips when table does not exist", () => {
    const db = new FakeDb();
    db.getReturns.set(db.key("SELECT name FROM sqlite_master WHERE type='table' AND name = ?"), undefined);
    const log: string[] = [];
    const logger = { info: (m: string) => log.push(m), warn: () => {} };
    runEmailHistoryToEmailMigration(db, logger);
    expect(log.some((m) => m.includes("skipped") && m.includes("no table"))).toBe(true);
  });
});
