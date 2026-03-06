# Przepływ startu aplikacji Planlux Hale

## Mapa przepływu (app start → renderer ready)

```
app start (Electron main)
  → getConfig() / initLogger / requireSupabase
  → createSupabaseClient + createSupabaseApiAdapter (apiClient)
  → getDb()
       → DB init: new Database(dbPath)
       → db.exec(SCHEMA_SQL)        // shared schema: users, offers, pricing_cache, pdfs, …
       → runMigrations(db)          // main.ts: users_roles_3/4, pdfs, offer_counters, config_sync_meta, pricing_surface, addons_surcharges, standard_included
       → runCrmMigrations(db)       // crmMigrations.ts: offers_crm, email_history, pdfs FK → offers_crm(id), …
       → runEmailHistoryToEmailMigration(db)
       → PRAGMA foreign_keys = ON
  → seedBaseIfEmpty(database)       // jeśli pricing_surface, addons_surcharges, standard_included puste → INSERT 10+10+10 wierszy
  → (opcjonalnie) usunięcie stale pricing_cache.json gdy localVersion === 0
  → syncConfig(database, logger, apiClient)
       → getMeta() z backendu (Supabase base_pricing)
       → jeśli remote > local lub localVersion === 0: getBase()
       → backend OK → baseData z API → saveBase(db, base)
       → backend błąd / BASE_PRICING_EMPTY → loadBaseFromLocalTables(db)
       → jeśli local puste → seedBaseIfEmpty(db) → loadBaseFromLocalTables(db)
       → jeśli dalej puste → lastSyncResult = error "No pricing base available"
       → w przeciwnym razie → saveBase(db, baseData) (cache + writeBaseToLocalTables)
  → registerIpcHandlers(getDb, apiClient, …)
  → createWindow() / loadWindow()
  → renderer ready (React ładuje planlux:getPricingCache / base:sync → kalkulator ma warianty)
```

## Kluczowe pliki

| Obszar | Plik |
|--------|------|
| Boot / init | `packages/desktop/electron/main.ts` (runStartup, getDb, seedBaseIfEmpty, syncConfig) |
| SQLite schema | `packages/shared/src/db/schema.ts` (SCHEMA_SQL) |
| Migracje | `packages/desktop/electron/main.ts` (runMigrations), `packages/desktop/electron/migrations/crmMigrations.ts` |
| Seed | `packages/desktop/src/infra/seedBase.ts` (seedBaseIfEmpty) |
| Config sync | `packages/desktop/src/services/configSync.ts` (syncConfig) |
| Supabase API | `packages/desktop/electron/supabase/apiAdapter.ts` (getMeta, getBase) |
| Cache / local tables | `packages/desktop/src/infra/db.ts` (getLocalVersion, saveBase, writeBaseToLocalTables, loadBaseFromLocalTables) |
| IPC | `packages/desktop/electron/ipc.ts` (base:sync, planlux:getPricingCache, planlux:calculatePrice) |
| Renderer | `packages/desktop/renderer/` (Kalkulator, api base:sync / getPricingCache) |

## Tryby działania cennika

1. **Supabase działa** → pobiera cennik z backendu (base_pricing), zapisuje do pricing_cache + pricing_surface/addons_surcharges/standard_included.
2. **Supabase padnie / payload null** → apiAdapter rzuca BASE_PRICING_EMPTY, configSync ładuje loadBaseFromLocalTables(db).
3. **SQLite puste** → seedBaseIfEmpty(db) wstawia 10+10+10 wierszy, potem loadBaseFromLocalTables + saveBase.

Kalkulator zawsze korzysta z pricing_cache (lub danych z local tables po fallbacku).
