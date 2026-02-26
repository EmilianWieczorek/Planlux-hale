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
}
