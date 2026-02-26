-- Planlux Hale – schema SQLite
-- Tabele: users, offers, pricing_cache, pdfs, emails, outbox, activity

-- ========== USERS ==========
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ========== OFFERS (konfiguracja oferty – klient + wymiary + wariant + dodatki) ==========
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  width_m REAL NOT NULL,
  length_m REAL NOT NULL,
  height_m REAL,
  area_m2 REAL NOT NULL,
  variant_hali TEXT NOT NULL,
  variant_nazwa TEXT,
  base_price_pln REAL,
  base_row_json TEXT,
  additions_json TEXT,
  standard_json TEXT,
  total_pln REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_user_id ON offers(user_id);
CREATE INDEX IF NOT EXISTS idx_offers_created_at ON offers(created_at);
CREATE INDEX IF NOT EXISTS idx_offers_client_name ON offers(client_name);

-- ========== PRICING_CACHE (snapshot bazy z backendu) ==========
CREATE TABLE IF NOT EXISTS pricing_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pricing_version INTEGER NOT NULL UNIQUE,
  last_updated TEXT NOT NULL,
  cennik_json TEXT NOT NULL,
  dodatki_json TEXT NOT NULL,
  standard_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_cache_version ON pricing_cache(pricing_version);

-- ========== PDFs (historia wygenerowanych PDF) ==========
CREATE TABLE IF NOT EXISTS pdfs (
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
CREATE INDEX IF NOT EXISTS idx_pdfs_user_id ON pdfs(user_id);
CREATE INDEX IF NOT EXISTS idx_pdfs_created_at ON pdfs(created_at);
CREATE INDEX IF NOT EXISTS idx_pdfs_status ON pdfs(status);

-- ========== EMAILS (historia wysłanych / do wysłania) ==========
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  pdf_id TEXT REFERENCES pdfs(id),
  to_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('DO_WYSŁANIA', 'SENT', 'FAILED')),
  sent_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_emails_user_id ON emails(user_id);
CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at);

-- ========== OUTBOX (kolejka operacji do wysłania przy połączeniu) ==========
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('SEND_EMAIL', 'LOG_PDF', 'LOG_EMAIL', 'HEARTBEAT')),
  payload_json TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_processed ON outbox(processed_at);
CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_type ON outbox(operation_type);

-- ========== ACTIVITY / SESSIONS (heartbeat, czas w aplikacji, urządzenie) ==========
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_type TEXT NOT NULL CHECK (device_type IN ('phone', 'desktop')),
  app_version TEXT,
  online INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activity_user_id ON activity(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_occurred_at ON activity(occurred_at);
CREATE INDEX IF NOT EXISTS idx_activity_synced ON activity(synced);
