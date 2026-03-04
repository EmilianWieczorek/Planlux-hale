/**
 * Test getEmailHistoryForOfferData: brak duplikatów gdy ten sam outbox_id jest w email_history i email_outbox.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("electron", () => ({ app: { getPath: () => require("path").join(require("os").tmpdir(), "planlux-test") } }));
import Database from "better-sqlite3";
import { getEmailHistoryForOfferData } from "./ipc";

describe("getEmailHistoryForOfferData", () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE offers_crm (id TEXT PRIMARY KEY, offer_number TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO users (id, email, password_hash, role, active, created_at, updated_at) VALUES ('u1', 'u@t.pl', 'h', 'SALESPERSON', 1, datetime('now'), datetime('now'));
      CREATE TABLE email_history (
        id TEXT PRIMARY KEY,
        related_offer_id TEXT,
        offer_id TEXT,
        outbox_id TEXT,
        account_id TEXT,
        user_id TEXT,
        from_email TEXT NOT NULL DEFAULT '',
        to_email TEXT NOT NULL DEFAULT '',
        to_addr TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
        sent_at TEXT,
        error_message TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE email_outbox (
        id TEXT PRIMARY KEY,
        related_offer_id TEXT,
        to_addr TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        html_body TEXT,
        text_body TEXT,
        status TEXT NOT NULL,
        sent_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        account_user_id TEXT
      );
    `);
    const now = "2025-01-15T10:00:00.000Z";
    db.prepare(
      "INSERT INTO offers_crm (id, offer_number, user_id, status, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("off1", "1/2025", "u1", "GENERATED", now);
    db.prepare(
      `INSERT INTO email_history (id, related_offer_id, offer_id, outbox_id, from_email, to_email, to_addr, subject, body, status, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("eh1", "off1", "off1", "ob1", "a@b.pl", "c@d.pl", "c@d.pl", "Sub", "", "sent", now, now);
    db.prepare(
      `INSERT INTO email_outbox (id, related_offer_id, to_addr, subject, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("ob1", "off1", "c@d.pl", "Sub", "failed", now, now);
  });

  it("returns one email when same outbox_id exists in email_history and email_outbox (no duplicate)", () => {
    const logger = { warn: () => {} };
    const emails = getEmailHistoryForOfferData(db as Parameters<typeof getEmailHistoryForOfferData>[0], "off1", logger);
    expect(emails).toHaveLength(1);
    expect(emails[0].id).toBe("eh1");
    expect(emails[0].status).toBe("sent");
  });
});
