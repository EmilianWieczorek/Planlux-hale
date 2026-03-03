/**
 * Test migracji email_history (krok 20): stary CHECK (QUEUED/SENT/FAILED) → rebuild z mapowaniem na queued/sent/failed.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runCrmMigrations } from "./crmMigrations";

describe("email_history migration (step 20)", () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
    // Minimal schema so runCrmMigrations steps 1–19 don’t fail; step 2 uses IF NOT EXISTS so we create old table first
    db.exec(`
      CREATE TABLE offers_crm (id TEXT PRIMARY KEY, offer_number TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO users (id, email, password_hash, role, active, created_at, updated_at) VALUES ('u1', 'u@t.pl', 'h', 'SALESPERSON', 1, datetime('now'), datetime('now'));
    `);
    // Stara tabela email_history ze starym CHECK (wielkie litery)
    db.exec(`
      CREATE TABLE email_history (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        from_email TEXT NOT NULL,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        sent_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const now = "2025-01-15T10:00:00.000Z";
    db.prepare(
      "INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("eh1", "off1", "u1", "a@b.pl", "c@d.pl", "Sub", "", "QUEUED", now);
    db.prepare(
      "INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, status, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("eh2", "off1", "u1", "a@b.pl", "c@d.pl", "Sub2", "", "SENT", now, now);
    db.prepare(
      "INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, status, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("eh3", "off1", "u1", "a@b.pl", "c@d.pl", "Sub3", "", "FAILED", "err", now);
    db.exec("PRAGMA foreign_keys = ON");
  });

  it("rebuilds old CHECK table and maps QUEUED→queued, SENT→sent, FAILED→failed", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    runCrmMigrations(db as unknown as Parameters<typeof runCrmMigrations>[0], logger);

    const rows = db.prepare("SELECT id, status FROM email_history ORDER BY id").all() as Array<{ id: string; status: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === "eh1")?.status).toBe("queued");
    expect(rows.find((r) => r.id === "eh2")?.status).toBe("sent");
    expect(rows.find((r) => r.id === "eh3")?.status).toBe("failed");
  });

  it("new table has lowercase status CHECK and idempotency_key column", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    runCrmMigrations(db as unknown as Parameters<typeof runCrmMigrations>[0], logger);

    const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_history'").get() as { sql: string };
    expect(createSql.sql).toContain("'queued'");
    expect(createSql.sql).toContain("'sent'");
    expect(createSql.sql).toContain("'failed'");
    expect(createSql.sql).not.toContain("QUEUED");

    const info = db.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
    expect(info.some((c) => c.name === "idempotency_key")).toBe(true);
    expect(info.some((c) => c.name === "related_offer_id")).toBe(true);
    expect(info.some((c) => c.name === "to_addr")).toBe(true);
  });

  it("rebuilds when CHECK contains typo 'falled' or 'sending'", () => {
    db.exec("DROP TABLE email_history");
    db.exec(`
      CREATE TABLE email_history (
        id TEXT PRIMARY KEY,
        offer_id TEXT,
        from_email TEXT NOT NULL DEFAULT '',
        to_email TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'falled')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const now = "2025-01-15T10:00:00.000Z";
    db.prepare("INSERT INTO email_history (id, from_email, to_email, subject, body, status, created_at) VALUES (?, '', '', '', '', ?, ?)").run("e1", "falled", now);
    db.prepare("INSERT INTO email_history (id, from_email, to_email, subject, body, status, created_at) VALUES (?, '', '', '', '', ?, ?)").run("e2", "sending", now);
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    runCrmMigrations(db as unknown as Parameters<typeof runCrmMigrations>[0], logger);
    const rows = db.prepare("SELECT id, status FROM email_history ORDER BY id").all() as Array<{ id: string; status: string }>;
    expect(rows.find((r) => r.id === "e1")?.status).toBe("failed");
    expect(rows.find((r) => r.id === "e2")?.status).toBe("sent");
    const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_history'").get() as { sql: string };
    expect(createSql.sql).not.toMatch(/falled|sending/);
  });

  it("after migration CHECK accepts only lowercase sent/failed/queued", () => {
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    runCrmMigrations(db as unknown as Parameters<typeof runCrmMigrations>[0], logger);

    const id = "eh-new";
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO email_history (id, from_email, to_email, to_addr, subject, body, status, created_at) VALUES (?, '', '', '', '', '', 'sent', ?)"
    ).run(id, now);
    const row = db.prepare("SELECT id, status FROM email_history WHERE id = ?").get(id) as { id: string; status: string };
    expect(row.status).toBe("sent");

    db.prepare("UPDATE email_history SET status = 'failed' WHERE id = ?").run(id);
    const row2 = db.prepare("SELECT status FROM email_history WHERE id = ?").get(id) as { status: string };
    expect(row2.status).toBe("failed");
  });
});
