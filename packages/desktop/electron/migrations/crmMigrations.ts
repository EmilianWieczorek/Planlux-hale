/**
 * Migracje CRM-lite: offers_crm, email_history, event_log, role, outbox.
 */

export type Db = {
  exec: (sql: string) => void;
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown; get: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] };
};

export function runCrmMigrations(database: Db, logger: { info: (m: string, d?: unknown) => void; warn: (m: string, e?: unknown) => void }): void {
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

  // 2. email_history
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS email_history (
        id TEXT PRIMARY KEY,
        offer_id TEXT NOT NULL REFERENCES offers_crm(id),
        user_id TEXT NOT NULL REFERENCES users(id),
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
      CREATE INDEX IF NOT EXISTS idx_email_history_offer_id ON email_history(offer_id);
      CREATE INDEX IF NOT EXISTS idx_email_history_user_id ON email_history(user_id);
    `);
    logger.info("[migration] email_history ready");
  } catch (e) {
    logger.warn("[migration] email_history skipped", e);
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

  // 4. outbox: dodaj OFFER_SYNC (wymaga recreate table)
  try {
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'").all() as Array<{ name: string }>;
    if (rows.length > 0) {
      database.exec(`
        CREATE TABLE outbox_new (
          id TEXT PRIMARY KEY,
          operation_type TEXT NOT NULL CHECK (operation_type IN ('SEND_EMAIL', 'LOG_PDF', 'LOG_EMAIL', 'HEARTBEAT', 'OFFER_SYNC')),
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
      logger.info("[migration] outbox OFFER_SYNC added");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate column") || msg.includes("already exists")) {
      logger.info("[migration] outbox already has OFFER_SYNC");
    } else {
      logger.warn("[migration] outbox OFFER_SYNC skipped", e);
    }
  }

  // 5. outbox: dodaj SEND_GENERIC_EMAIL (generic email queue)
  try {
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbox'").all() as Array<{ name: string }>;
    if (rows.length > 0) {
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
      logger.info("[migration] outbox SEND_GENERIC_EMAIL added");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate") || msg.includes("already exists")) {
      logger.info("[migration] outbox already has SEND_GENERIC_EMAIL");
    } else {
      logger.warn("[migration] outbox SEND_GENERIC_EMAIL skipped", e);
    }
  }

  // 6. smtp_accounts – konfiguracja SMTP w aplikacji (hasło NIE w DB, tylko w keychain/secureStore)
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS smtp_accounts (
        id TEXT PRIMARY KEY,
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
    `);
    logger.info("[migration] smtp_accounts ready");
  } catch (e) {
    logger.warn("[migration] smtp_accounts skipped", e);
  }

  // 7. email_outbox – kolejka offline-first z retry/backoff
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
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
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

  // 10. smtp_accounts: add user_id UNIQUE (one account per user)
  try {
    const info = database.prepare("PRAGMA table_info(smtp_accounts)").all() as Array<{ name: string }>;
    if (info.length > 0 && !info.some((c) => c.name === "user_id")) {
      database.exec("ALTER TABLE smtp_accounts ADD COLUMN user_id TEXT UNIQUE REFERENCES users(id)");
      logger.info("[migration] smtp_accounts user_id added");
    }
  } catch (e) {
    logger.warn("[migration] smtp_accounts user_id skipped", e);
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
}
