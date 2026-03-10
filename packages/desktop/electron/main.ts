/**
 * Proces główny Electron – okno, inicjalizacja bazy SQLite, schema, IPC.
 * DEV: loadURL z VITE_DEV_SERVER_URL. PROD: loadFile z built renderer (React app z <div id="root">).
 */

import { app, BrowserWindow, dialog, protocol } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { SCHEMA_SQL, flushOutbox } from "@planlux/shared";
import type { ApiClient } from "@planlux/shared";
import { registerIpcHandlers } from "./ipc"; // IPC handlers registered in whenReady before createWindow()
import { config } from "../src/config";
import { getConfig, getBackendUrl, requireSupabase, sanitizeConfigForLog } from "./config";
import { logger, initLogger } from "./logger";
import { createOutboxStorage, type Db } from "../src/db/outboxStorage";
import { dumpFkInfo } from "../src/infra/db";
import { createSendEmailForFlush } from "./smtpSend";
import { checkInternet } from "./checkInternet";
import { sendEmail as sendGenericEmailSmtp } from "./mail";
import { getE2EConfig, ensureE2EDirs } from "./e2eEnv";

const e2eConfig = getE2EConfig();
if (e2eConfig.isE2E) {
  app.setPath("userData", e2eConfig.e2eBaseDir);
  ensureE2EDirs(e2eConfig.e2eBaseDir);
}
const dbPath = e2eConfig.isE2E
  ? path.join(e2eConfig.e2eBaseDir, "planlux-hale.e2e.db")
  : path.join(app.getPath("userData"), "planlux-hale.db");

let mainWindow: BrowserWindow | null = null;
let db: ReturnType<typeof Database> | null = null;

let apiClient: ApiClient;

function runMigrations(database: ReturnType<typeof Database>) {
  // Migracja users_roles_3: CHECK (ADMIN, BOSS, SALESPERSON) – idempotentna, bez cichego skip.
  database.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY)");
  const done = database.prepare("SELECT 1 FROM _migrations WHERE id = ?").get("users_roles_3");
  if (done) {
    logger.info("[migration] users_roles_3 ALREADY_APPLIED");
  } else {
    const usersExists =
      (database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        .get() as { name?: string } | undefined)?.name === "users";
    if (!usersExists) {
      logger.info("[migration] users_roles_3 skipped (no users table)");
      database.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").run("users_roles_3");
    } else {
      const sqlRow = database
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        .get() as { sql: string } | undefined;
      const sqlDef = (sqlRow?.sql ?? "").toUpperCase();
      const needsRebuild =
        sqlDef.includes("('USER','ADMIN')") ||
        sqlDef.includes("('USER', 'ADMIN')") ||
        !sqlDef.includes("BOSS") ||
        !sqlDef.includes("SALESPERSON");
      if (!needsRebuild) {
        database.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").run("users_roles_3");
        logger.info("[migration] users_roles_3 already has target schema (ADMIN/BOSS/SALESPERSON)");
      } else {
        logger.info("[migration] users_roles_3 START");
        database.exec("PRAGMA foreign_keys = OFF");
        database.exec("DROP TABLE IF EXISTS users_new");
        const cols = database
          .prepare("PRAGMA table_info(users)")
          .all() as Array<{ name: string }>;
        const hasActive = cols.some((c) => c.name === "active");
        const hasDisplayName = cols.some((c) => c.name === "display_name");
        const hasFullName = cols.some((c) => c.name === "full_name");
        const hasCreatedAt = cols.some((c) => c.name === "created_at");
        const hasUpdatedAt = cols.some((c) => c.name === "updated_at");
        const nameColumn = hasDisplayName ? "display_name" : hasFullName ? "full_name" : "email";
        const activeExpr = hasActive ? "COALESCE(active,1)" : "1";
        const createdExpr = hasCreatedAt ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";
        const updatedExpr = hasUpdatedAt ? "COALESCE(updated_at, datetime('now'))" : "datetime('now')";

        const sql = `
BEGIN TRANSACTION;
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
SELECT
  id,
  email,
  password_hash,
  CASE role
    WHEN 'USER' THEN 'SALESPERSON'
    WHEN 'MANAGER' THEN 'BOSS'
    WHEN 'BOSS' THEN 'BOSS'
    WHEN 'SALESPERSON' THEN 'SALESPERSON'
    WHEN 'ADMIN' THEN 'ADMIN'
    ELSE 'SALESPERSON'
  END AS role,
  ${nameColumn} AS display_name,
  ${activeExpr} AS active,
  ${createdExpr} AS created_at,
  ${updatedExpr} AS updated_at
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
COMMIT;
`;
        try {
          database.exec(sql);
          database.prepare("INSERT INTO _migrations (id) VALUES (?)").run("users_roles_3");
          logger.info("[migration] users_roles_3 APPLIED");
        } catch (e) {
          logger.error("[migration] users_roles_3 failed", e);
          throw e;
        } finally {
          database.exec("PRAGMA foreign_keys = ON");
        }
      }
    }
  }

  // Migracja users_roles_4: CHECK (HANDLOWIEC, SZEF, ADMIN). USER/SALESPERSON→HANDLOWIEC, BOSS/MANAGER→SZEF, ADMIN→ADMIN.
  const done4 = database.prepare("SELECT 1 FROM _migrations WHERE id = ?").get("users_roles_4");
  if (done4) {
    logger.info("[migration] users_roles_4 ALREADY_APPLIED");
  } else {
    const usersExists4 = (database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get() as { name?: string } | undefined)?.name === "users";
    if (!usersExists4) {
      database.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").run("users_roles_4");
      logger.info("[migration] users_roles_4 skipped (no users table)");
    } else {
      const sqlRow4 = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined;
      const sqlDef4 = (sqlRow4?.sql ?? "").toUpperCase();
      const alreadyNewRoles = sqlDef4.includes("'HANDLOWIEC'") && sqlDef4.includes("'SZEF'") && sqlDef4.includes("'ADMIN'");
      if (alreadyNewRoles) {
        database.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").run("users_roles_4");
        logger.info("[migration] users_roles_4 already has target schema (HANDLOWIEC/SZEF/ADMIN)");
      } else {
        logger.info("[migration] users_roles_4 START");
        database.exec("PRAGMA foreign_keys = OFF");
        database.exec("DROP TABLE IF EXISTS users_new");
        const cols4 = database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
        const hasActive4 = cols4.some((c) => c.name === "active");
        const hasDisplayName4 = cols4.some((c) => c.name === "display_name");
        const hasFullName4 = cols4.some((c) => c.name === "full_name");
        const hasCreatedAt4 = cols4.some((c) => c.name === "created_at");
        const hasUpdatedAt4 = cols4.some((c) => c.name === "updated_at");
        const nameColumn4 = hasDisplayName4 ? "display_name" : hasFullName4 ? "full_name" : "email";
        const activeExpr4 = hasActive4 ? "COALESCE(active,1)" : "1";
        const createdExpr4 = hasCreatedAt4 ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";
        const updatedExpr4 = hasUpdatedAt4 ? "COALESCE(updated_at, datetime('now'))" : "datetime('now')";
        database.exec(`
BEGIN TRANSACTION;
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('HANDLOWIEC','SZEF','ADMIN')),
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users_new (id, email, password_hash, role, display_name, active, created_at, updated_at)
SELECT id, email, password_hash,
  CASE UPPER(TRIM(role))
    WHEN 'USER' THEN 'HANDLOWIEC'
    WHEN 'SALESPERSON' THEN 'HANDLOWIEC'
    WHEN 'HANDLOWIEC' THEN 'HANDLOWIEC'
    WHEN 'BOSS' THEN 'SZEF'
    WHEN 'MANAGER' THEN 'SZEF'
    WHEN 'SZEF' THEN 'SZEF'
    WHEN 'ADMIN' THEN 'ADMIN'
    ELSE 'HANDLOWIEC'
  END,
  ${nameColumn4} AS display_name, ${activeExpr4} AS active, ${createdExpr4} AS created_at, ${updatedExpr4} AS updated_at
FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
COMMIT;
`);
        database.prepare("INSERT INTO _migrations (id) VALUES (?)").run("users_roles_4");
        logger.info("[migration] users_roles_4 APPLIED");
        database.exec("PRAGMA foreign_keys = ON");
      }
    }
  }

  // Proste, idempotentne migracje kolumnowe.
  const migrations = [
    "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN password_set_at TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN created_by_user_id TEXT DEFAULT NULL",
    "ALTER TABLE users ADD COLUMN last_synced_at TEXT DEFAULT NULL",
  ];
  for (const sql of migrations) {
    try {
      database.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate column") || msg.includes("already exists")) continue;
      logger.warn(`Migration skipped: ${sql}`, e);
    }
  }
  // pdfs: add error_message and allow PDF_CREATED/PDF_FAILED (recreate table)
  try {
    const info = database.prepare("PRAGMA table_info(pdfs)").all() as Array<{ name: string }>;
    const hasErrorMsg = info.some((c) => c.name === "error_message");
    if (!hasErrorMsg) {
      database.exec(`
        CREATE TABLE pdfs_new (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          offer_id TEXT REFERENCES offers(id),
          client_name TEXT NOT NULL,
          variant_hali TEXT,
          width_m REAL,
          length_m REAL,
          height_m REAL,
          area_m2 REAL,
          total_pln REAL,
          file_path TEXT NOT NULL,
          file_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'LOCAL' CHECK (status IN ('LOCAL', 'LOGGED', 'PDF_CREATED', 'PDF_FAILED')),
          error_message TEXT,
          logged_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO pdfs_new (id, user_id, offer_id, client_name, variant_hali, width_m, length_m, height_m, area_m2, total_pln, file_path, file_name, status, logged_at, created_at)
        SELECT id, user_id, offer_id, client_name, variant_hali, width_m, length_m, height_m, area_m2, total_pln, file_path, file_name, status, logged_at, created_at FROM pdfs;
        DROP TABLE pdfs;
        ALTER TABLE pdfs_new RENAME TO pdfs;
        CREATE INDEX IF NOT EXISTS idx_pdfs_user_id ON pdfs(user_id);
        CREATE INDEX IF NOT EXISTS idx_pdfs_created_at ON pdfs(created_at);
        CREATE INDEX IF NOT EXISTS idx_pdfs_status ON pdfs(status);
      `);
      logger.info("[migration] pdfs table recreated with error_message and PDF_CREATED/PDF_FAILED");
    }
  } catch (e) {
    logger.warn("[migration] pdfs migration skipped", e);
  }
  // offer_counters – licznik ofert PLX{X}-0001/{YYYY} per handlowiec i rok
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS offer_counters (
        id TEXT PRIMARY KEY,
        prefix TEXT NOT NULL,
        year INTEGER NOT NULL,
        next_seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_counters_prefix_year ON offer_counters(prefix, year);
    `);
    logger.info("[migration] offer_counters table ready");
  } catch (e) {
    logger.warn("[migration] offer_counters skipped", e);
  }
  // Supabase config cache tables (extend schema for remote pricing config).
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS config_sync_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        version INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT DEFAULT NULL
      );
      INSERT OR IGNORE INTO config_sync_meta (id, version) VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS pricing_surface (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS addons_surcharges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS standard_included (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_json TEXT NOT NULL
      );
    `);
    logger.info("[migration] config_sync_meta, pricing_surface, addons_surcharges, standard_included ready");
  } catch (e) {
    logger.warn("[migration] Supabase config tables skipped", e);
  }
  // pricing_surface: add technical spec columns for PDF (Konstrukcja, Dach, Ściany).
  try {
    const hasSurface = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pricing_surface'").get() as { name?: string } | undefined;
    if (hasSurface?.name) {
      const surfaceCols = database.prepare("PRAGMA table_info(pricing_surface)").all() as Array<{ name: string }>;
      const surfaceColSet = new Set(surfaceCols.map((c) => c.name));
      const adds = [
        { col: "construction_type", sql: "ALTER TABLE pricing_surface ADD COLUMN construction_type TEXT" },
        { col: "roof_type", sql: "ALTER TABLE pricing_surface ADD COLUMN roof_type TEXT" },
        { col: "walls", sql: "ALTER TABLE pricing_surface ADD COLUMN walls TEXT" },
      ];
      for (const { col, sql } of adds) {
        if (!surfaceColSet.has(col)) {
          database.exec(sql);
          surfaceColSet.add(col);
          logger.info("[migration] pricing_surface." + col + " added");
        }
      }
    }
  } catch (e) {
    logger.warn("[migration] pricing_surface technical spec columns skipped", e);
  }
  // Password auth v1: per-user salt, algo version, password_unavailable, last_online_login_at
  try {
    const usersCols = database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    const colNames = new Set(usersCols.map((c) => c.name));
    const migrations = [
      { col: "password_salt", sql: "ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT NULL" },
      { col: "password_algo_version", sql: "ALTER TABLE users ADD COLUMN password_algo_version INTEGER DEFAULT 0" },
      { col: "password_unavailable", sql: "ALTER TABLE users ADD COLUMN password_unavailable INTEGER NOT NULL DEFAULT 0" },
      { col: "last_online_login_at", sql: "ALTER TABLE users ADD COLUMN last_online_login_at TEXT DEFAULT NULL" },
    ];
    for (const { col, sql } of migrations) {
      if (!colNames.has(col)) {
        database.exec(sql);
        colNames.add(col);
        logger.info("[migration] users." + col + " added");
      }
    }
    database.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").run("password_auth_v1");
  } catch (e) {
    logger.warn("[migration] password_auth_v1 skipped", e);
  }
  const { runCrmMigrations } = require("./migrations/crmMigrations");
  runCrmMigrations(database, logger);
  const { runEmailHistoryToEmailMigration } = require("./db/migrations/0001_email_history_to_email");
  runEmailHistoryToEmailMigration(database as import("./db/types").DbLike, logger);

  // Diagnostyka: logujemy aktualny kształt kluczowych tabel po migracjach.
  try {
    const usersSqlRow = database
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
      .get() as { sql?: string } | undefined;
    logger.info("[schema] users.sql", { sql: usersSqlRow?.sql });
    const smtpInfo = database
      .prepare("PRAGMA table_info(smtp_accounts)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
    logger.info("[schema] smtp_accounts.columns", smtpInfo);

    const outboxSqlRow = database
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox'")
      .get() as { sql?: string } | undefined;
    logger.info("[schema] outbox.sql", { sql: outboxSqlRow?.sql });
  } catch (e) {
    logger.warn("[schema] log failed", e);
  }

  // DEV: table_info and foreign_key_list for email_history and pdfs (diagnose missing columns / FK mismatch).
  if (process.env.NODE_ENV !== "production") {
    try {
      const emailHistoryInfo = database.prepare("PRAGMA table_info('email_history')").all() as Array<{ name: string; type: string }>;
      const pdfsInfo = database.prepare("PRAGMA table_info('pdfs')").all() as Array<{ name: string; type: string }>;
      const pdfsFk = database.prepare("PRAGMA foreign_key_list('pdfs')").all() as Array<{ table: string; from: string; to: string }>;
      const emailHistoryFk = database.prepare("PRAGMA foreign_key_list('email_history')").all() as Array<{ table: string; from: string; to: string }>;
      logger.info("[schema] DEV email_history table_info", { columns: emailHistoryInfo.map((c) => c.name) });
      logger.info("[schema] DEV pdfs table_info", { columns: pdfsInfo.map((c) => c.name) });
      logger.info("[schema] DEV pdfs foreign_key_list", pdfsFk);
      logger.info("[schema] DEV email_history foreign_key_list", emailHistoryFk);
    } catch (e) {
      logger.warn("[schema] DEV table_info/fk log failed", e);
    }
  }
}

function getDb() {
  if (!db) {
    if (process.env.FORCE_RESET_DB === "true") {
      const toDelete = path.normalize(dbPath);
      if (fs.existsSync(toDelete)) {
        try {
          fs.rmSync(toDelete, { force: true });
          logger.info("[DEV] Deleted local DB: " + toDelete);
        } catch (e) {
          logger.warn("[DEV] Failed to delete local DB", { path: toDelete, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    db = new Database(dbPath);
    db.exec(SCHEMA_SQL);
    runMigrations(db);
    db.exec("PRAGMA foreign_keys = ON");
    try {
      const hasPdfs = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pdfs'").get() as { name?: string } | undefined)?.name === "pdfs";
      if (hasPdfs) {
        const r = db.prepare("DELETE FROM pdfs WHERE offer_id IS NULL OR offer_id = ''").run();
        if (r.changes > 0) logger.info("[db] cleanup: removed pdfs rows with null/empty offer_id", { count: r.changes });
      }
    } catch (e) {
      logger.warn("[db] pdfs cleanup skipped", e);
    }
    if (process.env.NODE_ENV !== "production") {
      try {
        dumpFkInfo(db);
      } catch (e) {
        logger.warn("[db] dumpFkInfo failed", e);
      }
    }
  }
  return db;
}

/** Sprawdza, czy plik HTML to prawdziwy renderer React (ma <div id="root">). */
function htmlHasRootDiv(filePath: string): boolean {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return /id\s*=\s*["']root["']/.test(content) && /<div/.test(content);
  } catch {
    return false;
  }
}

function resolveRendererPath(): string | null {
  const candidates = [
    path.join(__dirname, "../renderer/index.html"),
    path.join(app.getAppPath(), "dist/renderer/index.html"),
    path.join(process.resourcesPath, "app.asar/dist/renderer/index.html"),
    path.join(process.resourcesPath, "dist/renderer/index.html"),
  ];

  for (const p of candidates) {
    const normalized = path.normalize(p);
    if (fs.existsSync(normalized) && htmlHasRootDiv(normalized)) {
      return normalized;
    }
  }

  for (const p of candidates) {
    const normalized = path.normalize(p);
    if (fs.existsSync(normalized)) {
      console.warn("[Planlux] Skipping candidate (no id=\"root\"):", normalized);
    }
  }
  return null;
}

function loadWindow(mainWindow: BrowserWindow) {
  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
  const isDev = !!process.env.VITE_DEV_SERVER_URL;

  if (isDev) {
    console.log("[Planlux] Loading DEV URL:", devUrl);
    mainWindow.loadURL(devUrl).catch((err) => {
      console.error("[Planlux] Failed to load DEV URL:", err);
    });
    mainWindow.webContents.openDevTools();
  } else {
    const filePath = resolveRendererPath();
    if (filePath) {
      console.log("[Planlux] Loading PROD file (React renderer):", filePath);
      mainWindow.loadFile(filePath).catch((err) => {
        console.error("[Planlux] Failed to load file:", err);
        dialog.showErrorBox("Planlux Hale", `Nie można załadować renderera:\n${err.message}`);
      });
    } else {
      const attempted = [
        path.join(__dirname, "../renderer/index.html"),
        path.join(app.getAppPath(), "dist/renderer/index.html"),
      ];
      const msg =
        "Nie znaleziono index.html z <div id=\"root\"> (React renderer). Uruchom: npm run build";
      console.error("[Planlux]", msg, "\nPróbowane:", attempted.join(", "));
      dialog.showErrorBox("Planlux Hale", msg);
    }
  }
}

function resolveAppIcon(): string | undefined {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.ico")
    : path.join(__dirname, "..", "assets", "icon.ico");
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  const iconPath = resolveAppIcon();
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadWindow(mainWindow);

  const win = mainWindow;
  win.on("close", async (e) => {
    if (win.isDestroyed()) return;
    e.preventDefault();
    try {
      await win.webContents
        .executeJavaScript(
          "typeof window.__planlux_saveDraft === 'function' ? window.__planlux_saveDraft() : Promise.resolve()"
        )
        .catch(() => {});
      logger.info("[app] draft saved before window close");
    } catch (_) {}
    try {
      const database = getDb();
      const row = database.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) {
        database.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      }
    } catch (_) {}
    win.destroy();
  });

  win.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await runStartup();
  } catch (e) {
    logger.error("[app] startup failed (migrations or init)", e);
    process.exit(1);
  }
});

async function runStartup(): Promise<void> {
  const e2e = getE2EConfig();
  if (e2e.isE2E) logger.info("[E2E] enabled dir=" + e2e.e2eBaseDir);
  if (process.argv.includes("--test-pdf")) {
    const { generatePdfFromTemplate } = await import("./pdf/generatePdfFromTemplate");
    const mock = {
      offer: {
        clientName: "Test Klient Sp. z o.o.",
        clientNip: "123-456-78-90",
        clientEmail: "test@example.com",
        clientPhone: "+48 123 456 789",
        widthM: 20,
        lengthM: 40,
        heightM: 6,
        areaM2: 800,
        variantNazwa: "Hala T-18 + T-35 dach",
        variantHali: "T18_T35_DACH",
      },
      pricing: {
        base: { totalBase: 200_000, cenaPerM2: 250 },
        additions: [
          { nazwa: "Bramy segmentowe", stawka: 5_000, jednostka: "szt.", ilosc: 2, total: 10_000 },
        ],
        standardInPrice: [
          { element: "Fundament w cenie", ilosc: 1, jednostka: "komplet", wartoscRef: 50_000 },
        ],
        totalPln: 210_000,
      },
      offerNumber: `oferta-test-${Date.now()}`,
      sellerName: "Planlux",
    };
    const testLogger = {
      info: (m: string, d?: unknown) => console.log("[pdf]", m, d ?? ""),
      warn: (m: string, d?: unknown) => console.warn("[pdf]", m, d ?? ""),
      error: (m: string, e?: unknown) => console.error("[pdf]", m, e ?? ""),
    };
    const r = await generatePdfFromTemplate(mock, testLogger);
    console.log("PDF test result:", r.ok ? r.filePath : r.error);
    app.quit();
    return;
  }

  // Updater IPC is always registered; in dev it returns a friendly error.
  // Auto-checking is still disabled in dev (see below).
  {
    const { ipcMain } = require("electron");
    ipcMain.handle("planlux:downloadUpdate", async () => {
      const isDev = !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";
      if (isDev) return { ok: false, error: "Aktualizacje są wyłączone w trybie dev." };
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("[autoUpdater] downloadUpdate failed", { message: msg });
        return { ok: false, error: msg };
      }
    });
    ipcMain.handle("planlux:quitAndInstall", () => {
      const isDev = !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";
      if (isDev) return { ok: false, error: "Aktualizacje są wyłączone w trybie dev." };
      try {
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("[autoUpdater] quitAndInstall failed", { message: msg });
        return { ok: false, error: msg };
      }
    });
  }

  protocol.registerFileProtocol("planlux-pdf", (request, callback) => {
    const url = request.url.replace(/^planlux-pdf:\/\/preview\//, "");
    const previewDir = path.join(app.getPath("userData"), "preview");
    const filePath = path.join(previewDir, decodeURIComponent(url));
    callback({ path: filePath });
  });

  const electronCfg = getConfig();
  initLogger(app.getPath("userData"), { level: electronCfg.logging.level });
  requireSupabase(electronCfg);
  const { createSupabaseClient } = await import("./supabase/client");
  const { createSupabaseApiAdapter } = await import("./supabase/apiAdapter");
  const supabase = createSupabaseClient(electronCfg);
  apiClient = createSupabaseApiAdapter({
    supabase,
    supabaseUrl: electronCfg.supabase?.url,
  }) as unknown as ApiClient;

  logger.info("[app] started", {
    version: app.getVersion(),
    platform: process.platform,
    env: process.env.VITE_DEV_SERVER_URL ? "dev" : "production",
  });
  logger.info("[app] config", sanitizeConfigForLog(electronCfg));

  const database = getDb();
  const { seedBaseIfEmpty } = await import("../src/infra/seedBase");
  const { loadBaseFromLocalTables, saveBase, getCachedBase } = await import("../src/infra/db");

  const seeded = seedBaseIfEmpty(database);
  try {
    const pricingSurfaceCount =
      database.prepare("SELECT COUNT(1) as c FROM pricing_surface").get() as { c?: number } | undefined;
    const addonsCount =
      database.prepare("SELECT COUNT(1) as c FROM addons_surcharges").get() as { c?: number } | undefined;
    const standardCount =
      database.prepare("SELECT COUNT(1) as c FROM standard_included").get() as { c?: number } | undefined;
    logger.info("[bootstrap] local pricing tables", {
      seeded,
      pricing_surface: pricingSurfaceCount?.c ?? 0,
      addons_surcharges: addonsCount?.c ?? 0,
      standard_included: standardCount?.c ?? 0,
    });
    if (seeded && (pricingSurfaceCount?.c ?? 0) === 0) {
      logger.warn("[bootstrap] seed reported true but pricing_surface still empty – possible migration/table mismatch");
    }
  } catch (e) {
    logger.warn("[bootstrap] pricing tables count failed", e);
  }

  const { getLocalVersion } = await import("../src/infra/db");
  if (getLocalVersion(database) === 0) {
    const cachePath = path.join(app.getPath("userData"), "pricing_cache.json");
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
        logger.info("[configSync] removed stale pricing_cache.json");
      }
    } catch (e) {
      logger.warn("[configSync] remove pricing_cache.json failed", e);
    }
  }

  try {
    const { syncConfig } = await import("../src/services/configSync");
    await syncConfig(database, logger, apiClient);
  } catch (e) {
    logger.warn("[configSync] startup sync failed – app continues with local data", e);
  }

  // Ensure pricing_cache is never empty after bootstrap: if still empty, fill from local tables or seed.
  let cacheRow = getCachedBase(database);
  if (!cacheRow || !cacheRow.cennik?.length) {
    let local = loadBaseFromLocalTables(database);
    if (!local || local.cennik.length === 0) {
      const reseeded = seedBaseIfEmpty(database);
      if (reseeded) logger.info("[bootstrap] re-ran seed (cache empty after sync)");
      local = loadBaseFromLocalTables(database);
    }
    if (local && local.cennik.length > 0) {
      try {
        saveBase(database, local);
        logger.info("[bootstrap] filled pricing_cache from local/seed", { cennik: local.cennik.length, dodatki: local.dodatki.length, standard: local.standard.length });
      } catch (e) {
        logger.warn("[bootstrap] saveBase after fallback failed", e);
      }
    } else {
      logger.error("[bootstrap] pricing_cache still empty after sync and seed – variants/standards/addons will not load");
    }
  }

  if (app.isPackaged) {
    try {
      const { getPdfTemplateDir, getPdfTemplateDirCandidatesWithExists } = await import("./pdf/pdfPaths");
      const templateDir = getPdfTemplateDir();
      if (!templateDir) {
        const candidates = getPdfTemplateDirCandidatesWithExists();
        logger.error("[pdf] TEMPLATE_MISSING at startup (packaged app)", { resourcesPath: process.resourcesPath, candidates });
      } else {
        logger.info("[pdf] template dir resolved at startup", { dir: templateDir });
      }
    } catch (e) {
      logger.warn("[pdf] startup template check failed", e);
    }
  }
  await registerIpcHandlers({
    getDb,
    getDbPath: () => dbPath,
    apiClient,
    getSupabase: () => supabase,
    config: { appVersion: app.getVersion(), updatesUrl: config.updatesUrl },
    logger,
    sendToRenderer: (channel: string, payload?: unknown) => {
      try {
        mainWindow?.webContents?.send(channel, payload);
      } catch {
        // ignore
      }
    },
  });
  console.log("[IPC] Planlux IPC handlers initialized");
  // Promote ADMIN_INITIAL_EMAIL to ADMIN so local/Supabase-synced user gets admin role.
  const adminInitialEmail = (electronCfg.seed?.adminInitialEmail ?? "").trim().toLowerCase();
  if (adminInitialEmail) {
    try {
      const r = database.prepare("UPDATE users SET role = 'ADMIN' WHERE LOWER(TRIM(email)) = ? AND (role IS NULL OR role != 'ADMIN')").run(adminInitialEmail);
      if (r.changes > 0) logger.info("[seed] Promoted user to ADMIN (ADMIN_INITIAL_EMAIL)", { email: adminInitialEmail });
    } catch (e) {
      logger.warn("[seed] Promote ADMIN_INITIAL_EMAIL skipped", e);
    }
  }
  // Seed a single admin only if no admin exists. No hardcoded credentials.
  const { hashPassword, validatePassword } = await import("./auth/password");
  const anyAdmin = database.prepare("SELECT id FROM users WHERE role = 'ADMIN' AND active = 1 LIMIT 1").get();
  if (!anyAdmin) {
    const adminEmail = electronCfg.seed.adminInitialEmail;
    const initialPassword =
      electronCfg.seed.adminInitialPassword ?? require("crypto").randomBytes(12).toString("base64url").slice(0, 16);
    const validation = validatePassword(initialPassword);
    const isProd = electronCfg.mode === "production" && !process.env.VITE_DEV_SERVER_URL;
    if (!validation.ok && isProd) {
      logger.warn("[seed] In production set ADMIN_INITIAL_PASSWORD (min 8 chars, 1 letter + 1 digit). Skipping admin seed.");
    } else {
      const passwordToUse = validation.ok ? initialPassword : "Admin1" + Date.now().toString(36).slice(-4);
      const hashed = hashPassword(passwordToUse);
      const hasCols = (database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
      const hasMustChange = hasCols.includes("must_change_password");
      const hasCreated = hasCols.includes("created_at");
      const hasUpdated = hasCols.includes("updated_at");
      const hasPasswordUnavail = hasCols.includes("password_unavailable");
      const id = require("crypto").randomUUID();
      if (hasPasswordUnavail) {
        database.prepare(
          "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, role, active, display_name, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 'ADMIN', 1, 'Admin', 0, datetime('now'), datetime('now'))"
        ).run(id, adminEmail, hashed.hash, hashed.salt, hashed.version);
      } else if (hasMustChange && hasCreated && hasUpdated) {
        database.prepare(
          "INSERT INTO users (id, email, password_hash, role, active, display_name, must_change_password, created_at, updated_at) VALUES (?, ?, ?, 'ADMIN', 1, 'Admin', 0, datetime('now'), datetime('now'))"
        ).run(id, adminEmail, hashed.hash);
      } else {
        database.prepare("INSERT INTO users (id, email, password_hash, role, active, display_name) VALUES (?, ?, ?, 'ADMIN', 1, 'Admin')")
          .run(id, adminEmail, hashed.hash);
      }
      logger.info("[seed] Admin user created – show initial password once", { email: adminEmail });
    }
  }

  // E2E-only seed: ensure admin + salesperson exist so tests can log in without UI/backend.
  if (e2eConfig.isE2E) {
    const crypto = require("crypto");
    const { hashPassword: hashPasswordE2E } = await import("./auth/password");
    const ensureUser = (email: string, password: string, role: string, displayName: string) => {
      const existing = database.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (!existing) {
        const hashed = hashPasswordE2E(password);
        const hasPasswordUnavail = (database.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "password_unavailable");
        if (hasPasswordUnavail) {
          database.prepare(
            "INSERT INTO users (id, email, password_hash, password_salt, password_algo_version, password_unavailable, role, active, display_name, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, 0, datetime('now'), datetime('now'))"
          ).run(crypto.randomUUID(), email, hashed.hash, hashed.salt, hashed.version, role, displayName);
        } else {
          database.prepare("INSERT INTO users (id, email, password_hash, role, active, display_name, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, 0, datetime('now'), datetime('now'))")
            .run(crypto.randomUUID(), email, hashed.hash, role, displayName);
        }
        return true;
      }
      return false;
    };
    const a = ensureUser("emilian@planlux.pl", "1234", "ADMIN", "Admin E2E");
    const b = ensureUser("test@planlux.pl", "Planlux123", "HANDLOWIEC", "Handlowiec E2E");
    if (a || b) logger.info("[E2E] seed users ensured (emilian@planlux.pl, test@planlux.pl)");

    // E2E pricing: allow Kalkulator PDF generation without backend (minimal cennik for first default variant).
    try {
      const pricingCount = (database.prepare("SELECT COUNT(*) as c FROM pricing_cache").get() as { c: number }).c;
      if (pricingCount === 0) {
        const cennik = [{ wariant_hali: "T18_T35_DACH", Nazwa: "Hala T-18 + T-35 dach", area_min_m2: 1, area_max_m2: 5000, cena: 100 }];
        database.prepare(
          "INSERT INTO pricing_cache (pricing_version, last_updated, cennik_json, dodatki_json, standard_json, fetched_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
        ).run(1, new Date().toISOString(), JSON.stringify(cennik), JSON.stringify([]), JSON.stringify([]));
        logger.info("[E2E] pricing_cache seeded (minimal cennik for T18_T35_DACH)");
      }
    } catch (e) {
      logger.warn("[E2E] pricing seed skipped", e);
    }
  }

  createWindow();

  // Auto-update: custom Supabase-based when Supabase configured; otherwise electron-updater
  {
    const isDev = !!process.env.VITE_DEV_SERVER_URL || process.env.NODE_ENV === "development";
    if (!isDev && supabase) {
      // Custom updater: check Supabase app_releases (do not block startup)
      (async () => {
        try {
          const { checkForUpdates } = await import("./updates/updateService");
          const { setStatus } = await import("./updates/updateState");
          const result = await checkForUpdates({
            getVersion: () => app.getVersion(),
            getSupabase: () => supabase,
            logger,
          });
          if (result.updateAvailable && result.release) {
            setStatus("available", result.release);
          } else {
            setStatus("idle");
          }
        } catch (e) {
          logger.warn("[updates] startup check failed", e);
          const { setStatus } = await import("./updates/updateState");
          setStatus("idle");
        }
      })();
    } else if (!isDev) {
      // Fallback: electron-updater when Supabase not configured
      try {
        const updatesUrl = (config.updatesUrl ?? "").trim();
        if (updatesUrl && typeof autoUpdater.setFeedURL === "function") {
          try {
            autoUpdater.setFeedURL({ provider: "generic", url: updatesUrl });
            logger.info("[autoUpdater] feed configured", { provider: "generic", url: updatesUrl });
          } catch (e) {
            logger.warn("[autoUpdater] setFeedURL failed (will use build-time publish config)", e);
          }
        }
      } catch {
        // ignore
      }

      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;

      const send = (channel: string, payload?: unknown) => {
        try {
          mainWindow?.webContents?.send(channel, payload);
        } catch {
          // ignore
        }
      };

      autoUpdater.on("checking-for-update", () => {
        logger.info("[autoUpdater] checking-for-update");
        send("planlux:update-checking");
      });
      autoUpdater.on("update-available", (info: unknown) => {
        const version = (info != null && typeof info === "object" && "version" in info) ? (info as { version: string }).version : undefined;
        logger.info("[autoUpdater] update-available", { version });
        send("planlux:update-available", { version: version ?? "?" });
      });
      autoUpdater.on("update-not-available", (info: unknown) => {
        const version = (info != null && typeof info === "object" && "version" in info) ? (info as { version: string }).version : undefined;
        logger.info("[autoUpdater] update-not-available", { version });
        send("planlux:update-not-available", { version: version ?? null });
      });
      autoUpdater.on("download-progress", (p: unknown) => {
        const prog = p as { percent?: number; bytesPerSecond?: number; transferred?: number; total?: number };
        send("planlux:update-download-progress", {
          percent: typeof prog.percent === "number" ? prog.percent : null,
          bytesPerSecond: typeof prog.bytesPerSecond === "number" ? prog.bytesPerSecond : null,
          transferred: typeof prog.transferred === "number" ? prog.transferred : null,
          total: typeof prog.total === "number" ? prog.total : null,
        });
      });
      autoUpdater.on("update-downloaded", (info: unknown) => {
        const version = (info != null && typeof info === "object" && "version" in info) ? (info as { version: string }).version : undefined;
        logger.info("[autoUpdater] update-downloaded", { version });
        send("planlux:update-downloaded", { version: version ?? "?" });
      });
      autoUpdater.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("[autoUpdater] error", { message: msg });
        send("planlux:update-error", { message: msg });
      });

      const check = typeof autoUpdater.checkForUpdates === "function"
        ? autoUpdater.checkForUpdates.bind(autoUpdater)
        : autoUpdater.checkForUpdatesAndNotify.bind(autoUpdater);
      check().catch((err: unknown) => {
        logger.warn("[autoUpdater] update check failed", err);
      });
    }
  }

  // Flush outbox periodically; isOnline = real Internet check (not just LAN)
  setInterval(async () => {
    let online = false;
    try {
      online = await checkInternet();
    } catch (e) {
      logger.warn("[outbox] online check failed", e);
    }
    try {
      const r = await flushOutbox({
        api: apiClient,
        storage: createOutboxStorage(getDb() as Db),
        isOnline: () => online,
        sendEmail: createSendEmailForFlush(getDb),
        sendGenericEmail: async (payload) => {
          await sendGenericEmailSmtp({
            to: payload.to,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
          });
        },
        offerSync: async (payload) => {
          const db = getDb() as Db;
          const offers = Array.isArray(payload?.offers) ? payload.offers : [];
          for (const o of offers) {
            const offer = o as { id?: string };
            if (!offer?.id) continue;
            try {
              const result = await apiClient.reserveOfferNumber({
                id: offer.id,
                userId: (offer as { userId?: string }).userId ?? "",
                initial: (offer as { initial?: string }).initial ?? "E",
                year: (offer as { year?: number }).year ?? new Date().getFullYear(),
              });
              if (result.ok && result.offerNumber) {
                const hasStatus = (db.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>).some((c) => c.name === "offer_number_status");
                if (hasStatus) {
                  db.prepare("UPDATE offers_crm SET offer_number = ?, offer_number_status = 'FINAL' WHERE id = ?").run(result.offerNumber, offer.id);
                } else {
                  db.prepare("UPDATE offers_crm SET offer_number = ? WHERE id = ?").run(result.offerNumber, offer.id);
                }
                if (process.env.LOG_LEVEL === "debug") logger.info("[outbox] offerSync reserved", { offerId: offer.id, offerNumber: result.offerNumber });
              }
            } catch (e) {
              logger.warn("[outbox] offerSync reserveOfferNumber failed", { offerId: offer.id, error: e });
            }
          }
        },
      });
      if (r.processed > 0 || r.failed > 0) logger.info("[outbox] flush", r);
      if (r.firstError) logger.error("[outbox] flush firstError (np. ERR_SHEETS_BAD_JSON)", r.firstError);
    } catch (e) {
      logger.error("[outbox] flush error", e);
    }
  }, config.outboxFlushIntervalMs);
}

app.on("window-all-closed", () => {
  if (db) {
    db.close();
    db = null;
  }
  app.quit();
});
