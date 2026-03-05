/**
 * Migracje CRM-lite: offers_crm, email_history, event_log, role, outbox.
 */

export type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] };
};

/** Result of better-sqlite3 Statement.run() */
type SqliteRunResult = { changes: number; lastInsertRowid?: number };

function hasTable(database: Db, tableName: string): boolean {
  const row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName) as { name?: string } | undefined;
  return row?.name === tableName;
}

function hasColumn(database: Db, tableName: string, columnName: string): boolean {
  if (!/^[a-zA-Z0-9_]+$/.test(tableName) || !/^[a-zA-Z0-9_]+$/.test(columnName)) return false;
  const info = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return info.some((c) => c.name === columnName);
}

export function runCrmMigrations(database: Db, logger: { info: (m: string, d?: unknown) => void; warn: (m: string, e?: unknown) => void; error?: (m: string, e?: unknown) => void }): void {
  // 1. offers_crm – pełna tabela CRM ofert
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS offers_crm (
        id TEXT PRIMARY KEY,
        offer_number TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS', 'GENERATED', 'SENT', 'REALIZED')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        pdf_generated_at TEXT,
        emailed_at TEXT,
        realized_at TEXT,
        client_first_name TEXT NOT NULL DEFAULT '',
        client_last_name TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        nip TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        variant_hali TEXT NOT NULL,
        width_m REAL NOT NULL,
        length_m REAL NOT NULL,
        height_m REAL,
        area_m2 REAL NOT NULL,
        hall_summary TEXT NOT NULL DEFAULT '',
        base_price_pln REAL NOT NULL DEFAULT 0,
        additions_total_pln REAL NOT NULL DEFAULT 0,
        total_pln REAL NOT NULL DEFAULT 0,
        standard_snapshot TEXT NOT NULL DEFAULT '[]',
        addons_snapshot TEXT NOT NULL DEFAULT '[]',
        note_html TEXT NOT NULL DEFAULT '',
        material_info TEXT DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_offers_crm_user_id ON offers_crm(user_id);
      CREATE INDEX IF NOT EXISTS idx_offers_crm_status ON offers_crm(status);
      CREATE INDEX IF NOT EXISTS idx_offers_crm_offer_number ON offers_crm(offer_number);
      CREATE INDEX IF NOT EXISTS idx_offers_crm_created_at ON offers_crm(created_at);
    `);
    logger.info("[migration] offers_crm ready");
  } catch (e) {
    logger.warn("[migration] offers_crm skipped", e);
  }

  // 2. email_history – unified schema (single source of truth); new DBs get this; old DBs get rebuilt in step 20
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_history (
        id TEXT PRIMARY KEY,
        related_offer_id TEXT DEFAULT NULL,
        offer_id TEXT DEFAULT NULL,
        outbox_id TEXT DEFAULT NULL,
        account_id TEXT DEFAULT NULL,
        user_id TEXT DEFAULT NULL,
        from_email TEXT NOT NULL DEFAULT '',
        to_email TEXT NOT NULL DEFAULT '',
        to_addr TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
        error_message TEXT DEFAULT NULL,
        error TEXT DEFAULT NULL,
        accepted_json TEXT DEFAULT NULL,
        rejected_json TEXT DEFAULT NULL,
        smtp_response TEXT DEFAULT NULL,
        provider_message_id TEXT DEFAULT NULL,
        sent_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        idempotency_key TEXT DEFAULT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_email_history_related_offer_id ON email_history(related_offer_id);
      CREATE INDEX IF NOT EXISTS idx_email_history_offer_id ON email_history(offer_id);
      CREATE INDEX IF NOT EXISTS idx_email_history_outbox_id ON email_history(outbox_id);
      CREATE INDEX IF NOT EXISTS idx_email_history_created_at ON email_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_email_history_idempotency_key ON email_history(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_email_history_user_id ON email_history(user_id);
    `);
    logger.info("[migration] email_history ready");
  } catch (e) {
    logger.warn("[migration] email_history skipped", e);
  }

  // 2a. email_history: body_preview, updated_at (for smtp flush / Supabase logEmail)
  try {
    if (hasTable(database, "email_history")) {
      if (!hasColumn(database, "email_history", "body_preview")) {
        database.exec("ALTER TABLE email_history ADD COLUMN body_preview TEXT DEFAULT NULL");
        logger.info("[migration] email_history body_preview added");
      }
      if (!hasColumn(database, "email_history", "updated_at")) {
        database.exec("ALTER TABLE email_history ADD COLUMN updated_at TEXT DEFAULT NULL");
        logger.info("[migration] email_history updated_at added");
      }
    }
  } catch (e) {
    logger.warn("[migration] email_history body_preview/updated_at skipped", e);
  }

  // 2b. offer_audit – audit trail per oferta
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS offer_audit (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL REFERENCES offers_crm(id),
        user_id TEXT NOT NULL REFERENCES users(id),
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_offer_audit_offer_id ON offer_audit(offer_id);
      CREATE INDEX IF NOT EXISTS idx_offer_audit_created_at ON offer_audit(created_at);
    `);
    logger.info("[migration] offer_audit ready");
  } catch (e) {
    logger.warn("[migration] offer_audit skipped", e);
  }

  // 3. event_log
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        offer_id TEXT,
        user_id TEXT NOT NULL REFERENCES users(id),
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_event_log_offer_id ON event_log(offer_id);
      CREATE INDEX IF NOT EXISTS idx_event_log_user_id ON event_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at);
    `);
    logger.info("[migration] event_log ready");
  } catch (e) {
    logger.warn("[migration] event_log skipped", e);
  }

  // 3b. offers_crm: material_info (wersja 5 z MIGRATION_STRATEGY)
  try {
    const info = database.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>;
    if (info.length > 0 && !info.some((c) => c.name === "material_info")) {
      database.exec("ALTER TABLE offers_crm ADD COLUMN material_info TEXT DEFAULT '{}'");
      logger.info("[migration] offers_crm material_info added");
    }
  } catch (e) {
    logger.warn("[migration] offers_crm material_info skipped", e);
  }

  // 3c. offers_crm: offer_number_status, offer_number_reserved_at (TEMP/FINAL numbering)
  try {
    const info = database.prepare("PRAGMA table_info(offers_crm)").all() as Array<{ name: string }>;
    if (info.length > 0) {
      if (!info.some((c) => c.name === "offer_number_status")) {
        database.exec("ALTER TABLE offers_crm ADD COLUMN offer_number_status TEXT DEFAULT 'TEMP'");
        logger.info("[migration] offers_crm offer_number_status added");
      }
      if (!info.some((c) => c.name === "offer_number_reserved_at")) {
        database.exec("ALTER TABLE offers_crm ADD COLUMN offer_number_reserved_at TEXT DEFAULT NULL");
        logger.info("[migration] offers_crm offer_number_reserved_at added");
      }
      database.prepare(
        "UPDATE offers_crm SET offer_number_status = 'FINAL' WHERE offer_number IS NOT NULL AND TRIM(offer_number) != '' AND (offer_number_status IS NULL OR offer_number_status = '') AND offer_number NOT LIKE 'TEMP-%'"
      ).run();
      database.prepare("UPDATE offers_crm SET offer_number_status = 'TEMP' WHERE offer_number_status IS NULL OR offer_number_status = ''").run();
      const idxExists = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_offers_crm_offer_number_final'").get() as { name?: string } | undefined;
      if (!idxExists?.name) {
        database.exec("CREATE UNIQUE INDEX idx_offers_crm_offer_number_final ON offers_crm(offer_number) WHERE offer_number_status = 'FINAL'");
        logger.info("[migration] offers_crm unique index on FINAL offer_number");
      }
    }
  } catch (e) {
    logger.warn("[migration] offers_crm offer_number_status skipped", e);
  }

  // 4 & 5. outbox: ensure CHECK includes OFFER_SYNC and SEND_GENERIC_EMAIL (single idempotent rebuild)
  try {
    const outboxRow = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox'").get() as { sql?: string } | undefined;
    const outboxSql = outboxRow?.sql ?? "";
    const needsRebuild = outboxSql.length > 0 && (!outboxSql.includes("OFFER_SYNC") || !outboxSql.includes("SEND_GENERIC_EMAIL"));
    if (needsRebuild) {
      database.exec(`
        CREATE TABLE outbox_new (
          id TEXT PRIMARY KEY,
          operation_type TEXT NOT NULL CHECK (operation_type IN ('SEND_EMAIL', 'SEND_GENERIC_EMAIL', 'LOG_PDF', 'LOG_EMAIL', 'HEARTBEAT', 'OFFER_SYNC')),
          payload_json TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          max_retries INTEGER NOT NULL DEFAULT 5,
          last_error TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          processed_at TEXT
        );
        INSERT INTO outbox_new SELECT id, operation_type, payload_json, retry_count, max_retries, last_error, created_at, processed_at FROM outbox;
        DROP TABLE outbox;
        ALTER TABLE outbox_new RENAME TO outbox;
        CREATE INDEX IF NOT EXISTS idx_outbox_processed ON outbox(processed_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at);
        CREATE INDEX IF NOT EXISTS idx_outbox_type ON outbox(operation_type);
      `);
      logger.info("[migration] outbox rebuilt with OFFER_SYNC and SEND_GENERIC_EMAIL");
    } else if (outboxSql.length > 0) {
      logger.info("[migration] outbox CHECK already up to date");
    }
  } catch (e) {
    logger.warn("[migration] outbox rebuild skipped", e);
  }

  // 6. smtp_accounts – konfiguracja SMTP (pełna tabela z user_id). Idempotentna.
  // SMTP password is not stored here; it is encrypted using OS-level encryption (Electron safeStorage) in secureStore.
  if (!hasTable(database, "smtp_accounts")) {
    database.exec(`
      CREATE TABLE smtp_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE REFERENCES users(id),
        name TEXT NOT NULL DEFAULT '',
        from_name TEXT NOT NULL DEFAULT '',
        from_email TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 587,
        secure INTEGER NOT NULL DEFAULT 0,
        auth_user TEXT NOT NULL DEFAULT '',
        reply_to TEXT DEFAULT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_smtp_accounts_active ON smtp_accounts(active);
      CREATE INDEX IF NOT EXISTS idx_smtp_accounts_is_default ON smtp_accounts(is_default);
      CREATE INDEX IF NOT EXISTS idx_smtp_accounts_user_id ON smtp_accounts(user_id);
    `);
    logger.info("[migration] smtp_accounts created");
  } else {
    logger.info("[migration] smtp_accounts table already exists");
  }

  // 7. email_outbox – kolejka offline-first z retry/backoff (runtime status: queued/sent/failed lowercase)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY,
        account_id TEXT REFERENCES smtp_accounts(id),
        to_addr TEXT NOT NULL,
        cc TEXT DEFAULT NULL,
        bcc TEXT DEFAULT NULL,
        subject TEXT NOT NULL DEFAULT '',
        text_body TEXT DEFAULT NULL,
        html_body TEXT DEFAULT NULL,
        attachments_json TEXT NOT NULL DEFAULT '[]',
        related_offer_id TEXT DEFAULT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT DEFAULT NULL,
        last_error TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
      CREATE INDEX IF NOT EXISTS idx_email_outbox_next_retry ON email_outbox(next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_email_outbox_created_at ON email_outbox(created_at);
    `);
    logger.info("[migration] email_outbox ready");
  } catch (e) {
    logger.warn("[migration] email_outbox skipped", e);
  }

  // 8. email_history – historia wysłanych/błędów (po wysłaniu z outbox lub send now)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_history (
        id TEXT PRIMARY KEY,
        outbox_id TEXT DEFAULT NULL,
        account_id TEXT DEFAULT NULL,
        to_addr TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('sent','failed')),
        provider_message_id TEXT DEFAULT NULL,
        error TEXT DEFAULT NULL,
        sent_at TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_email_history_created_at ON email_history(created_at);
      CREATE INDEX IF NOT EXISTS idx_email_history_account_id ON email_history(account_id);
    `);
    logger.info("[migration] email_history (new) ready");
  } catch (e) {
    logger.warn("[migration] email_history (new) skipped", e);
  }

  // 9. app_settings – office CC, templates (key/value)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT ''
      );
    `);
    logger.info("[migration] app_settings ready");
  } catch (e) {
    logger.warn("[migration] app_settings skipped", e);
  }

  // 10. smtp_accounts: dodanie user_id (one account per user) – idempotentne dla istniejącej tabeli bez user_id.
  if (!hasTable(database, "smtp_accounts")) {
    logger.info("[migration] smtp_accounts step 10 skipped (table created in step 6 with user_id)");
  } else if (hasColumn(database, "smtp_accounts", "user_id")) {
    logger.info("[migration] smtp_accounts user_id already present");
  } else {
    logger.info("[migration] smtp_accounts adding user_id via rebuild");
    // Upewnij się, że stara tabela ma kolumny wymagane przez INSERT (ALTER ADD COLUMN ignoruje duplicate).
    const addColumnIfMissing = (col: string, def: string) => {
      try {
        database.exec(`ALTER TABLE smtp_accounts ADD COLUMN ${col} ${def}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("duplicate column") && !msg.includes("already exists")) throw e;
      }
    };
    addColumnIfMissing("name", "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing("is_default", "INTEGER NOT NULL DEFAULT 0");
    addColumnIfMissing("active", "INTEGER NOT NULL DEFAULT 1");
    try {
      database.exec(`
BEGIN TRANSACTION;

CREATE TABLE smtp_accounts_new (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure INTEGER NOT NULL DEFAULT 0,
  auth_user TEXT NOT NULL,
  reply_to TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO smtp_accounts_new (
  id,
  user_id,
  name,
  from_name,
  from_email,
  host,
  port,
  secure,
  auth_user,
  reply_to,
  is_default,
  active,
  created_at,
  updated_at
)
SELECT
  id,
  (SELECT id FROM users WHERE email = smtp_accounts.from_email LIMIT 1) AS user_id,
  COALESCE(name, '') AS name,
  from_name,
  from_email,
  host,
  port,
  secure,
  auth_user,
  reply_to,
  COALESCE(is_default, 0) AS is_default,
  COALESCE(active, 1) AS active,
  COALESCE(created_at, datetime('now')) AS created_at,
  COALESCE(updated_at, datetime('now')) AS updated_at
FROM smtp_accounts
WHERE EXISTS (
  SELECT 1 FROM users WHERE email = smtp_accounts.from_email
);

DROP TABLE smtp_accounts;
ALTER TABLE smtp_accounts_new RENAME TO smtp_accounts;

CREATE INDEX IF NOT EXISTS idx_smtp_accounts_active ON smtp_accounts(active);
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_is_default ON smtp_accounts(is_default);
CREATE INDEX IF NOT EXISTS idx_smtp_accounts_user_id ON smtp_accounts(user_id);

COMMIT;
`);
      logger.info("[migration] smtp_accounts rebuilt with user_id");
    } catch (e) {
      if (logger.error) logger.error("[migration] smtp_accounts user_id rebuild failed", e);
      else logger.warn("[migration] smtp_accounts user_id rebuild failed", e);
      throw e;
    }
  }

  // 11. email_outbox: add account_user_id (sender user)
  try {
    const info = database.prepare("PRAGMA table_info(email_outbox)").all() as Array<{ name: string }>;
    if (info.length > 0 && !info.some((c) => c.name === "account_user_id")) {
      database.exec("ALTER TABLE email_outbox ADD COLUMN account_user_id TEXT REFERENCES users(id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_email_outbox_account_user_id ON email_outbox(account_user_id)");
      logger.info("[migration] email_outbox account_user_id added");
    }
  } catch (e) {
    logger.warn("[migration] email_outbox account_user_id skipped", e);
  }

  // 12. email_outbox: add sent_at if missing
  try {
    const info = database.prepare("PRAGMA table_info(email_outbox)").all() as Array<{ name: string }>;
    if (info.length > 0 && !info.some((c) => c.name === "sent_at")) {
      database.exec("ALTER TABLE email_outbox ADD COLUMN sent_at TEXT DEFAULT NULL");
      logger.info("[migration] email_outbox sent_at added");
    }
  } catch (e) {
    logger.warn("[migration] email_outbox sent_at skipped", e);
  }

  // 13. email_history: add related_offer_id, provider_message_id if missing (for outbox-linked history)
  try {
    const info = database.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
    if (info.length > 0) {
      if (!info.some((c) => c.name === "related_offer_id")) {
        database.exec("ALTER TABLE email_history ADD COLUMN related_offer_id TEXT DEFAULT NULL");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_related_offer_id ON email_history(related_offer_id)");
        logger.info("[migration] email_history related_offer_id added");
      }
    }
  } catch (e) {
    logger.warn("[migration] email_history related_offer_id skipped", e);
  }

  // 14. email_history: add SMTP result columns (accepted_json, rejected_json, smtp_response)
  try {
    const info = database.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
    if (info.length > 0) {
      if (!info.some((c) => c.name === "accepted_json")) {
        database.exec("ALTER TABLE email_history ADD COLUMN accepted_json TEXT DEFAULT NULL");
        logger.info("[migration] email_history accepted_json added");
      }
      if (!info.some((c) => c.name === "rejected_json")) {
        database.exec("ALTER TABLE email_history ADD COLUMN rejected_json TEXT DEFAULT NULL");
        logger.info("[migration] email_history rejected_json added");
      }
      if (!info.some((c) => c.name === "smtp_response")) {
        database.exec("ALTER TABLE email_history ADD COLUMN smtp_response TEXT DEFAULT NULL");
        logger.info("[migration] email_history smtp_response added");
      }
    }
  } catch (e) {
    logger.warn("[migration] email_history SMTP result columns skipped", e);
  }

  // 15. email_history: ensure new-schema columns (outbox_id, account_id, to_addr, provider_message_id, error) for outbox-linked inserts
  try {
    if (!hasTable(database, "email_history")) {
      logger.info("[migration] email_history step 15 skipped (no table)");
    } else {
      const addIfMissing = (col: string, def: string) => {
        if (!hasColumn(database, "email_history", col)) {
          database.exec(`ALTER TABLE email_history ADD COLUMN ${col} ${def}`);
          logger.info("[migration] email_history column added", { column: col });
        }
      };
      addIfMissing("outbox_id", "TEXT DEFAULT NULL");
      addIfMissing("account_id", "TEXT DEFAULT NULL");
      addIfMissing("to_addr", "TEXT DEFAULT NULL");
      addIfMissing("provider_message_id", "TEXT DEFAULT NULL");
      addIfMissing("error", "TEXT DEFAULT NULL");
      addIfMissing("offer_id", "TEXT DEFAULT NULL");
    }
  } catch (e) {
    logger.warn("[migration] email_history new-schema columns skipped", e);
  }

  // 16. pdfs: rebuild with offer_id REFERENCES offers_crm(id) when current FK points to offers (legacy)
  try {
    if (!hasTable(database, "pdfs") || !hasTable(database, "offers_crm")) {
      logger.info("[migration] pdfs FK step 16 skipped (no pdfs or offers_crm)");
    } else {
      const fkList = database.prepare("PRAGMA foreign_key_list('pdfs')").all() as Array<{ from: string; table: string }>;
      const refsOffers = fkList.some((fk) => fk.from === "offer_id" && fk.table === "offers");
      if (!refsOffers) {
        logger.info("[migration] pdfs already references offers_crm or other, skip FK migration");
      } else {
        database.exec("PRAGMA foreign_keys = OFF");
        try {
          database.exec(`
            BEGIN TRANSACTION;
            ALTER TABLE pdfs RENAME TO pdfs_old;
            CREATE TABLE pdfs (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL REFERENCES users(id),
              offer_id TEXT REFERENCES offers_crm(id),
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
            INSERT INTO pdfs (id, user_id, offer_id, client_name, variant_hali, width_m, length_m, height_m, area_m2, total_pln, file_path, file_name, status, error_message, logged_at, created_at)
            SELECT p.id, p.user_id, p.offer_id, p.client_name, p.variant_hali, p.width_m, p.length_m, p.height_m, p.area_m2, p.total_pln, p.file_path, p.file_name, p.status, p.error_message, p.logged_at, p.created_at
            FROM pdfs_old p
            WHERE p.offer_id IN (SELECT id FROM offers_crm);
            DROP TABLE pdfs_old;
            COMMIT;
          `);
          database.exec("CREATE INDEX IF NOT EXISTS idx_pdfs_user_id ON pdfs(user_id)");
          database.exec("CREATE INDEX IF NOT EXISTS idx_pdfs_created_at ON pdfs(created_at)");
          database.exec("CREATE INDEX IF NOT EXISTS idx_pdfs_status ON pdfs(status)");
          logger.info("[migration] pdfs rebuilt with offer_id REFERENCES offers_crm(id)");
        } finally {
          database.exec("PRAGMA foreign_keys = ON");
        }
      }
    }
  } catch (e) {
    logger.warn("[migration] pdfs FK migration skipped", e);
    try {
      database.exec("PRAGMA foreign_keys = ON");
    } catch {
      // ignore
    }
  }

  // 17. offers_crm: client_address (adres klienta)
  try {
    if (hasTable(database, "offers_crm") && !hasColumn(database, "offers_crm", "client_address")) {
      database.exec("ALTER TABLE offers_crm ADD COLUMN client_address TEXT NOT NULL DEFAULT ''");
      logger.info("[migration] offers_crm client_address added");
    }
  } catch (e) {
    logger.warn("[migration] offers_crm client_address skipped", e);
  }

  // 18. email_history: idempotency_key (unikanie duplikatów wysyłki)
  try {
    if (hasTable(database, "email_history") && !hasColumn(database, "email_history", "idempotency_key")) {
      database.exec("ALTER TABLE email_history ADD COLUMN idempotency_key TEXT DEFAULT NULL");
      database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_idempotency_key ON email_history(idempotency_key)");
      logger.info("[migration] email_history idempotency_key added");
    }
  } catch (e) {
    logger.warn("[migration] email_history idempotency_key skipped", e);
  }

  // 19. email_history: backfill user_id where NULL (idempotent; if column is NOT NULL there are no NULL rows)
  try {
    if (!hasTable(database, "email_history") || !hasColumn(database, "email_history", "user_id")) {
      logger.info("[migration] email_history user_id backfill skipped (no table or no user_id column)");
    } else {
      const first = database.prepare("SELECT id FROM users WHERE active = 1 ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
      if (first) {
        const result = database.prepare("UPDATE email_history SET user_id = ? WHERE user_id IS NULL").run(first.id) as SqliteRunResult;
        if (result.changes > 0) logger.info("[migration] email_history user_id backfilled", { count: result.changes });
        else logger.info("[migration] email_history user_id backfill OK (no NULL rows)");
      } else {
        logger.warn("[migration] email_history user_id backfill skipped (no active user for fallback)");
      }
    }
  } catch (e) {
    logger.warn("[migration] email_history user_id backfill skipped", e);
  }

  // 20. email_history: unified schema (single source of truth) – rebuild if old/wrong CHECK
  try {
    runEmailHistoryUnifiedStep(database, logger);
  } catch (e) {
    logger.warn("[migration] email_history unified skipped", e);
    try {
      database.exec("PRAGMA foreign_keys = ON");
    } catch {
      // ignore
    }
  }
}

/** Krok 20: ujednolicenie email_history (rebuild przy starym CHECK). Eksport do wywołania przy CHECK constraint failed w runtime. */
export function runEmailHistoryUnifiedStep(
  database: Db,
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, e?: unknown) => void; error?: (m: string, e?: unknown) => void }
): void {
  try {
    const createStmt = database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='email_history'").get() as { sql: string } | undefined;
    const sql = createStmt?.sql ?? "";
    const hasOldCheck =
      sql.includes("QUEUED") ||
      sql.includes("'falled'") ||
      sql.includes("'sending'");

    if (!hasTable(database, "email_history")) {
      database.exec(`
        CREATE TABLE email_history (
          id TEXT PRIMARY KEY,
          related_offer_id TEXT DEFAULT NULL,
          offer_id TEXT DEFAULT NULL,
          outbox_id TEXT DEFAULT NULL,
          account_id TEXT DEFAULT NULL,
          user_id TEXT DEFAULT NULL,
          from_email TEXT NOT NULL DEFAULT '',
          to_email TEXT NOT NULL DEFAULT '',
          to_addr TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          attachments_json TEXT NOT NULL DEFAULT '[]',
          status TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
          error_message TEXT DEFAULT NULL,
          error TEXT DEFAULT NULL,
          accepted_json TEXT DEFAULT NULL,
          rejected_json TEXT DEFAULT NULL,
          smtp_response TEXT DEFAULT NULL,
          provider_message_id TEXT DEFAULT NULL,
          sent_at TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          idempotency_key TEXT DEFAULT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_email_history_related_offer_id ON email_history(related_offer_id);
        CREATE INDEX IF NOT EXISTS idx_email_history_offer_id ON email_history(offer_id);
        CREATE INDEX IF NOT EXISTS idx_email_history_outbox_id ON email_history(outbox_id);
        CREATE INDEX IF NOT EXISTS idx_email_history_created_at ON email_history(created_at);
        CREATE INDEX IF NOT EXISTS idx_email_history_idempotency_key ON email_history(idempotency_key);
        CREATE INDEX IF NOT EXISTS idx_email_history_user_id ON email_history(user_id);
      `);
      logger.info("[migration] email_history unified (new table) ready");
    } else if (hasOldCheck) {
      database.exec("PRAGMA foreign_keys = OFF");
      try {
        const run = database.prepare("SELECT * FROM email_history").all() as Array<Record<string, unknown>>;

        database.exec(`
          CREATE TABLE email_history_new (
            id TEXT PRIMARY KEY,
            related_offer_id TEXT DEFAULT NULL,
            offer_id TEXT DEFAULT NULL,
            outbox_id TEXT DEFAULT NULL,
            account_id TEXT DEFAULT NULL,
            user_id TEXT DEFAULT NULL,
            from_email TEXT NOT NULL DEFAULT '',
            to_email TEXT NOT NULL DEFAULT '',
            to_addr TEXT NOT NULL DEFAULT '',
            subject TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            attachments_json TEXT NOT NULL DEFAULT '[]',
            status TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
            error_message TEXT DEFAULT NULL,
            error TEXT DEFAULT NULL,
            accepted_json TEXT DEFAULT NULL,
            rejected_json TEXT DEFAULT NULL,
            smtp_response TEXT DEFAULT NULL,
            provider_message_id TEXT DEFAULT NULL,
            sent_at TEXT DEFAULT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            idempotency_key TEXT DEFAULT NULL
          );
        `);
        const mapStatus = (s: unknown): string => {
          const raw = String(s ?? "").trim();
          const v = raw.toUpperCase();
          if (v === "QUEUED") return "queued";
          if (v === "SENT") return "sent";
          if (v === "FAILED") return "failed";
          if (v === "SENDING" || raw.toLowerCase() === "sending") return "sent";
          if (raw.toLowerCase() === "falled") return "failed";
          return raw ? raw.toLowerCase() : "sent";
        };
        const ins = database.prepare(`
          INSERT INTO email_history_new (id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, error_message, error, sent_at, created_at, idempotency_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of run) {
          const status = mapStatus(r.status);
          const toEmail = (r.to_email ?? r.to_addr ?? "") as string;
          ins.run(
            r.id ?? "",
            r.related_offer_id ?? r.offer_id ?? null,
            r.offer_id ?? null,
            r.outbox_id ?? null,
            r.account_id ?? null,
            r.user_id ?? null,
            (r.from_email ?? "") as string,
            toEmail,
            (r.to_addr ?? toEmail) as string,
            (r.subject ?? "") as string,
            (r.body ?? "") as string,
            (r.attachments_json ?? "[]") as string,
            status,
            r.error_message ?? null,
            r.error ?? null,
            r.sent_at ?? null,
            (r.created_at ?? new Date().toISOString()) as string,
            r.idempotency_key ?? null
          );
        }
        database.exec("DROP TABLE email_history");
        database.exec("ALTER TABLE email_history_new RENAME TO email_history");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_related_offer_id ON email_history(related_offer_id)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_offer_id ON email_history(offer_id)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_outbox_id ON email_history(outbox_id)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_created_at ON email_history(created_at)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_idempotency_key ON email_history(idempotency_key)");
        database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_user_id ON email_history(user_id)");
        logger.info("[migration] email_history unified (rebuilt from old CHECK)", { rows: run.length });
      } finally {
        database.exec("PRAGMA foreign_keys = ON");
      }
    } else {
      const info = database.prepare("PRAGMA table_info(email_history)").all() as Array<{ name: string }>;
      const addIfMissing = (col: string, def: string) => {
        if (!info.some((c) => c.name === col)) {
          database.exec(`ALTER TABLE email_history ADD COLUMN ${col} ${def}`);
          logger.info("[migration] email_history column added", { column: col });
        }
      };
      addIfMissing("related_offer_id", "TEXT DEFAULT NULL");
      addIfMissing("to_addr", "TEXT NOT NULL DEFAULT ''");
      addIfMissing("error", "TEXT DEFAULT NULL");
      addIfMissing("idempotency_key", "TEXT DEFAULT NULL");
      database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_related_offer_id ON email_history(related_offer_id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_outbox_id ON email_history(outbox_id)");
      database.exec("CREATE INDEX IF NOT EXISTS idx_email_history_idempotency_key ON email_history(idempotency_key)");
      logger.info("[migration] email_history unified (columns ensured)");
    }
  } catch (e) {
    logger.warn("[migration] email_history unified skipped", e);
    try {
      database.exec("PRAGMA foreign_keys = ON");
    } catch {
      // ignore
    }
  }
}
