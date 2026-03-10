#!/usr/bin/env node
/**
 * Builds planlux_seed.db from default-pricing.json using sql.js (no native deps).
 * Run from packages/desktop: npm run build:seed
 * Output: assets/db/planlux_seed.db (included in app via extraResources).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const ASSETS_DB = path.join(ROOT, "assets", "db");
const SEED_DB_PATH = path.join(ASSETS_DB, "planlux_seed.db");
const DEFAULT_PRICING_PATH = path.join(ROOT, "assets", "default-pricing.json");

const SEED_VERSION = 1;
const SEED_BUILT_AT = new Date().toISOString();

if (!fs.existsSync(DEFAULT_PRICING_PATH)) {
  console.error("Missing default-pricing.json at", DEFAULT_PRICING_PATH);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DEFAULT_PRICING_PATH, "utf-8"));
const cennik = Array.isArray(data.cennik) ? data.cennik : [];
const dodatki = Array.isArray(data.dodatki) ? data.dodatki : [];
const standard = Array.isArray(data.standard) ? data.standard : [];
const version = data.version ?? 1;
const lastUpdated = data.lastUpdated ?? SEED_BUILT_AT;

if (cennik.length === 0) {
  console.error("default-pricing.json has no cennik");
  process.exit(1);
}

async function main() {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  const cennikJson = JSON.stringify(cennik);
  const dodatkiJson = JSON.stringify(dodatki);
  const standardJson = JSON.stringify(standard);

  db.run(`
    CREATE TABLE config_sync_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL DEFAULT 0, last_synced_at TEXT DEFAULT NULL);
    CREATE TABLE pricing_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pricing_version INTEGER NOT NULL UNIQUE,
      last_updated TEXT NOT NULL,
      cennik_json TEXT NOT NULL,
      dodatki_json TEXT NOT NULL,
      standard_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE pricing_surface (id INTEGER PRIMARY KEY AUTOINCREMENT, data_json TEXT NOT NULL);
    CREATE TABLE addons_surcharges (id INTEGER PRIMARY KEY AUTOINCREMENT, data_json TEXT NOT NULL);
    CREATE TABLE standard_included (id INTEGER PRIMARY KEY AUTOINCREMENT, data_json TEXT NOT NULL);
    CREATE TABLE seed_meta (id INTEGER PRIMARY KEY CHECK (id = 1), seed_version INTEGER NOT NULL, seed_built_at TEXT NOT NULL);
  `);
  db.run("INSERT INTO config_sync_meta (id, version, last_synced_at) VALUES (1, ?, ?)", [version, lastUpdated]);
  db.run("INSERT INTO seed_meta (id, seed_version, seed_built_at) VALUES (1, ?, ?)", [SEED_VERSION, SEED_BUILT_AT]);

  db.run(
    "INSERT INTO pricing_cache (pricing_version, last_updated, cennik_json, dodatki_json, standard_json, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
    [version, lastUpdated, cennikJson, dodatkiJson, standardJson]
  );

  for (const row of cennik) {
    db.run("INSERT INTO pricing_surface (data_json) VALUES (?)", [JSON.stringify(row)]);
  }
  for (const row of dodatki) {
    db.run("INSERT INTO addons_surcharges (data_json) VALUES (?)", [JSON.stringify(row)]);
  }
  for (const row of standard) {
    db.run("INSERT INTO standard_included (data_json) VALUES (?)", [JSON.stringify(row)]);
  }

  if (!fs.existsSync(ASSETS_DB)) {
    fs.mkdirSync(ASSETS_DB, { recursive: true });
  }
  if (fs.existsSync(SEED_DB_PATH)) {
    fs.unlinkSync(SEED_DB_PATH);
  }
  const buffer = db.export();
  fs.writeFileSync(SEED_DB_PATH, Buffer.from(buffer));
  db.close();

  console.log("[buildSeedDb] Written", SEED_DB_PATH, "| cennik:", cennik.length, "dodatki:", dodatki.length, "standard:", standard.length, "| seed_version:", SEED_VERSION);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
