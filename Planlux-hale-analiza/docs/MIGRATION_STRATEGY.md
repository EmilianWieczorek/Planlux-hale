# Strategia migracji – Planlux Hale CRM

## Wersjonowanie migracji

Każda migracja ma numer wersji. Tabela `migrations` przechowuje wykonane wersje:

```sql
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## Kolejność migracji (MVP → Full)

### Wersja 1 – CRM (zaimplementowane)
- `offers_crm`
- `email_history`
- `event_log`
- `outbox` + OFFER_SYNC

### Wersja 2 – sync_state
```sql
CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  device_id TEXT NOT NULL,
  last_sync_at TEXT,
  meta_pricing_version INTEGER DEFAULT 0,
  meta_offers_version INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Wersja 3 – outbox idempotency_key
- Dodaj kolumnę `idempotency_key TEXT UNIQUE`
- Recreate table (SQLite nie wspiera ADD COLUMN z UNIQUE w prosty sposób)

### Wersja 4 – users role
- `ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'SALESPERSON'`
- UPDATE istniejących: role = 'ADMIN' WHERE email = 'admin@planlux.pl'

### Wersja 5 – offers_crm material_info
- `ALTER TABLE offers_crm ADD COLUMN material_info TEXT DEFAULT '{}'`

### Wersja 6 – SQLCipher (opcjonalna, wymaga zmiany drivera)
- Przed: better-sqlite3
- Po: @journeyapps/sqlcipher lub better-sqlite3-sqlcipher
- PRAGMA key przy każdym otwarciu (klucz z keytar)

## Bezpieczna migracja do SQLCipher

**Uwaga:** Migracja istniejącej bazy do SQLCipher wymaga:
1. Eksport danych z plain SQLite
2. Utworzenie nowej bazy z PRAGMA key
3. Import danych
4. Usunięcie starej bazy (opcjonalnie)

**Rekomendacja:** Wdrożyć SQLCipher od początku dla nowych instalacji; dla istniejących – migracja jednorazowa przy aktualizacji.

## Rollback

Migracje nie mają automatycznego rollbacku. W razie błędu:
- Wersja nie jest zapisywana w `migrations`
- Następne uruchomienie ponowi migrację
- Krytyczne migracje (np. DROP COLUMN) – unikać; preferować ADD COLUMN + deprecation
