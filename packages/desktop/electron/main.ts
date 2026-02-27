/**
 * Proces główny Electron – okno, inicjalizacja bazy SQLite, schema, IPC.
 * DEV: loadURL z VITE_DEV_SERVER_URL. PROD: loadFile z built renderer (React app z <div id="root">).
 */

import { app, BrowserWindow, dialog, protocol } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { SCHEMA_SQL, ApiClient, flushOutbox } from "@planlux/shared";
import { registerIpcHandlers } from "./ipc"; // IPC handlers registered in whenReady before createWindow()
import { config } from "../src/config";
import { logger } from "../src/logger";
import { createOutboxStorage, type Db } from "../src/db/outboxStorage";
import { getRemoteMeta } from "../src/infra/baseSync";
import { createSendEmailForFlush } from "./smtpSend";
import { checkInternet } from "./checkInternet";
import { sendEmail as sendGenericEmailSmtp } from "./mail";

const dbPath = path.join(app.getPath("userData"), "planlux-hale.db");

let mainWindow: BrowserWindow | null = null;
let db: ReturnType<typeof Database> | null = null;

const apiClient = new ApiClient({
  baseUrl: config.backend.url,
  fetchFn: globalThis.fetch.bind(globalThis),
  timeoutMs: config.backend.timeoutMs,
  retries: config.backend.retries,
  retryDelayMs: config.backend.retryDelayMs,
  retryBackoffMultiplier: config.backend.retryBackoffMultiplier,
});

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

  // Proste, idempotentne migracje kolumnowe.
  const migrations = [
    "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
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
  const { runCrmMigrations } = require("./migrations/crmMigrations");
  runCrmMigrations(database, logger);

  // Diagnostyka: logujemy aktualny kształt tabel users i smtp_accounts po migracjach.
  try {
    const usersSqlRow = database
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
      .get() as { sql?: string } | undefined;
    logger.info("[schema] users.sql", { sql: usersSqlRow?.sql });
    const smtpInfo = database
      .prepare("PRAGMA table_info(smtp_accounts)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
    logger.info("[schema] smtp_accounts.columns", smtpInfo);
  } catch (e) {
    logger.warn("[schema] log failed", e);
  }
}

function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.exec(SCHEMA_SQL);
    runMigrations(db);
    db.exec("PRAGMA foreign_keys = ON");
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
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

  if (!process.env.VITE_DEV_SERVER_URL && process.env.NODE_ENV !== "development") {
    const { ipcMain } = require("electron");
    ipcMain.handle("planlux:downloadUpdate", async () => {
      await autoUpdater.downloadUpdate();
    });
    ipcMain.handle("planlux:quitAndInstall", () => {
      autoUpdater.quitAndInstall(false, true);
    });
  }

  protocol.registerFileProtocol("planlux-pdf", (request, callback) => {
    const url = request.url.replace(/^planlux-pdf:\/\/preview\//, "");
    const previewDir = path.join(app.getPath("userData"), "preview");
    const filePath = path.join(previewDir, decodeURIComponent(url));
    callback({ path: filePath });
  });

  const database = getDb();
  await registerIpcHandlers({
    getDb,
    apiClient,
    config: { appVersion: config.appVersion },
    logger,
  });
  console.log("[IPC] Planlux IPC handlers initialized");
  const existing = database.prepare("SELECT id FROM users WHERE email = ?").get("admin@planlux.pl");
  if (!existing) {
    const crypto = require("crypto");
    const hash = crypto.scryptSync("admin123", "planlux-hale-v1", 64).toString("hex");
    database.prepare("INSERT INTO users (id, email, password_hash, role, active, display_name) VALUES (?, ?, ?, 'ADMIN', 1, 'Admin')")
      .run(crypto.randomUUID(), "admin@planlux.pl", hash);
    logger.info("Seeded admin user (admin@planlux.pl / admin123)");
  }
  createWindow();

  // Auto-update: check on startup (tylko w produkcji, gdy jest opublikowany release)
  if (!process.env.VITE_DEV_SERVER_URL && process.env.NODE_ENV !== "development") {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      logger.warn("[autoUpdater] check failed", err);
    });
    autoUpdater.on("update-available", (info: unknown) => {
      const version = (info != null && typeof info === "object" && "version" in info) ? (info as { version: string }).version : undefined;
      logger.info("[autoUpdater] update available", version);
      mainWindow?.webContents.send("planlux:update-available", { version });
    });
    autoUpdater.on("update-downloaded", () => {
      mainWindow?.webContents.send("planlux:update-downloaded");
    });
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
      });
      if (r.processed > 0 || r.failed > 0) logger.info("[outbox] flush", r);
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
