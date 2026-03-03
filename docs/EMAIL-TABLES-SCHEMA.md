# Docelowy SQL CREATE TABLE – email_history i email_outbox

Zgodne z `packages/desktop/electron/migrations/crmMigrations.ts` (krok 2 i 7 + kroki 11–12 dla outbox).

---

## email_history

**Status:** tylko lowercase `'queued'` | `'sent'` | `'failed'`

```sql
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
```

---

## email_outbox

**Status:** uppercase `'QUEUED'` | `'SENT'` | `'FAILED'`. Kolumny `account_user_id` i `sent_at` dodawane w migracjach 11 i 12.

```sql
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES smtp_accounts(id),
  account_user_id TEXT REFERENCES users(id),
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
  sent_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
CREATE INDEX IF NOT EXISTS idx_email_outbox_next_retry ON email_outbox(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_created_at ON email_outbox(created_at);
CREATE INDEX IF NOT EXISTS idx_email_outbox_account_user_id ON email_outbox(account_user_id);
```
