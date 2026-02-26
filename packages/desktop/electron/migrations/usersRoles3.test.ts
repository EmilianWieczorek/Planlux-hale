/**
 * Test migracji users_roles_3: po migracji można zapisać role BOSS/SALESPERSON bez CHECK error.
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

describe("users_roles_3 migration", () => {
  let db: ReturnType<typeof Database>;

  beforeEach(() => {
    db = new Database(":memory:");
    // Stara schema: tylko USER, ADMIN
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
        display_name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_users_email ON users(email);
      INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at)
      VALUES ('u1', 'user@test.pl', 'hash', 'USER', 'Jan Kowalski', 1, datetime('now'), datetime('now'));
    `);
  });

  it("po migracji można wstawić BOSS i SALESPERSON", () => {
    db.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY)");
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN','BOSS','SALESPERSON')),
        display_name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, role, display_name, active, created_at, updated_at)
      SELECT id, email, password_hash,
        CASE role WHEN 'USER' THEN 'SALESPERSON' WHEN 'MANAGER' THEN 'BOSS' ELSE role END,
        display_name, COALESCE(active, 1), created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE INDEX idx_users_email ON users(email);
    `);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run("u2", "boss@test.pl", "hash", "BOSS", "Szef", 1);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run("u3", "sales@test.pl", "hash", "SALESPERSON", "Handlowiec", 1);
    const rows = db.prepare("SELECT id, role FROM users ORDER BY id").all() as Array<{ id: string; role: string }>;
    expect(rows.map((r) => r.role)).toEqual(["SALESPERSON", "BOSS", "SALESPERSON"]);
  });

  it("mapuje USER→SALESPERSON przy migracji", () => {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN','BOSS','SALESPERSON')),
        display_name TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, email, password_hash, role, display_name, active, created_at, updated_at)
      SELECT id, email, password_hash,
        CASE role WHEN 'USER' THEN 'SALESPERSON' WHEN 'MANAGER' THEN 'BOSS' ELSE role END,
        display_name, COALESCE(active, 1), created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    const row = db.prepare("SELECT role FROM users WHERE id = 'u1'").get() as { role: string };
    expect(row.role).toBe("SALESPERSON");
  });
});
