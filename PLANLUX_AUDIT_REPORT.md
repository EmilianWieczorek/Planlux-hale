# PLANLUX HALE — FULL AUDIT REPORT

**Repo:** https://github.com/EmilianWieczorek/Planlux-hale.git  
**Audit type:** Production software — correctness, data integrity, security, maintainability.  
**No code changes in this run; analysis only.**

---

## SECTION 0 — Repo map (folder structure)

### Top-level folders

| Folder | Purpose |
|--------|--------|
| `packages/` | Workspace packages (desktop, shared) |
| `scripts/` | Root scripts: prepare.js, clean-all.js, etc. |
| `docs/` | Documentation (RELEASE-WINDOWS, SUPABASE-SETUP, TEST_CHECKLIST, etc.) |
| `supabase/` | Supabase Edge Functions and migrations (e.g. send_offer_email, migrations) |
| `.github/` | CI/CD workflows (release, etc.) |

### Main entrypoints

| Entrypoint | Path | Role |
|------------|------|------|
| **Electron main** | `packages/desktop/electron/main.ts` | Main process: app lifecycle, DB, window, IPC registration. `main` in package.json: `dist/electron/main.js`. |
| **Renderer UI** | `packages/desktop/renderer/index.html` + `packages/desktop/renderer/src/main.tsx` | React app; main.tsx renders `<App />` from `app/App.tsx`. |
| **Shared/core** | `packages/shared/src/index.ts` | Exports schema, pricing engine, RBAC, PDF, email, sync types. |
| **DB schema (shared)** | `packages/shared/src/db/schema.ts` (and `packages/shared/sql/schema.sql`) | Base SQLite schema (users, offers, pricing_cache, pdfs, emails, outbox, activity, sessions). |
| **Migrations** | `packages/desktop/electron/main.ts` (`runMigrations`) + `packages/desktop/electron/migrations/crmMigrations.ts` + `packages/desktop/electron/db/migrations/0001_email_history_to_email.ts` | In-main migrations: users_roles_3/4, pdfs, offer_counters, config_sync_meta, password_auth_v1, CRM, email_history. Supabase: `supabase/migrations/`. |
| **Build** | Root: `npm run build` (workspaces). Desktop: `vite build` + `tsc` + copy:assets. Shared: `tsc`. | Vite builds renderer to `packages/desktop/dist/renderer`; tsc compiles electron + src to dist. |

---

## SECTION 1 — Run/build pipeline

### 1) Scripts that matter

**Root `package.json`:**
- **install:** (default npm install; workspaces)
- **dev:** `dev:desktop` — concurrently: `npm run dev -w packages/desktop` (Vite), then `wait-on http://localhost:5173` → `npm run build:electron` → `cross-env VITE_DEV_SERVER_URL=http://localhost:5173 npm run start -w packages/desktop`
- **build:** `npm run build --workspaces --if-present` (shared then desktop)
- **dist:** `dist:win` — build desktop then `electron-builder --win --publish never --projectDir packages/desktop`

**packages/desktop/package.json:**
- **install:** postinstall runs `electron-builder install-app-deps`
- **dev:** `vite` (renderer dev server, port 5173)
- **start:** `electron .` (main process)
- **build:** `npm run build -w @planlux/shared && vite build && tsc && npm run copy:assets`
- **build:electron:** `tsc` (compiles electron + src to dist)
- **dist:** `electron-builder --win nsis`

**packages/shared/package.json:**
- **build:** `tsc` (output to dist/)

### 2) Node, workspace, electron-builder

- **Node:** `engines.node": ">=20.19.0"` (root). `.nvmrc`: `20.19.0`.
- **Workspace:** npm workspaces (`"workspaces": ["packages/*"]`). No pnpm/yarn in scripts.
- **electron-builder** (in packages/desktop): `build` block in package.json. Output: `directories.output`: `release`. AppId: `pl.planlux.hale`. Files: `dist/**/*`, node_modules, package.json. asar with unpack for better-sqlite3 and keytar. Win target: nsis; icon: assets/icon.ico.

### 3) How the app boots in dev

1. `npm run dev:desktop` runs concurrently:
   - **vite:** `npm run dev -w packages/desktop` → Vite dev server (renderer) on http://localhost:5173.
   - **electron:** After wait-on 5173, runs `npm run build:electron` (tsc), then `cross-env VITE_DEV_SERVER_URL=http://localhost:5173 npm run start -w packages/desktop` (electron .).
2. Electron main loads; in `loadWindow`, `process.env.VITE_DEV_SERVER_URL` is set by cross-env to `http://localhost:5173`, so main loads `mainWindow.loadURL(devUrl)` (main.ts ~428–429). DevTools opened in dev.

### 4) Minimal “known-good” command sequence (Windows)

```powershell
cd "c:\Users\emilw\Desktop\Planlux hale"
npm install
npm run build
npm run dev:desktop
```

Or with env for debug/reset:

```powershell
$env:LOG_LEVEL="debug"; $env:FORCE_RESET_DB="true"; npm run dev:desktop
```

---

## SECTION 2 — Electron main process audit

### main.ts (`packages/desktop/electron/main.ts`)

- **Role:** E2E path override, dbPath (userData/planlux-hale.db or e2e), getDb() (lazy init, FORCE_RESET_DB delete, SCHEMA_SQL, runMigrations, PRAGMA foreign_keys ON), resolveRendererPath, loadWindow (dev URL vs file), createWindow, registerIpcHandlers, seedBaseIfEmpty, syncConfig, admin seed, auto-updater, protocol planlux-pdf.
- **Errors:** getDb() catch for pdfs cleanup and dumpFkInfo; loadWindow shows dialog on missing renderer; syncConfig failure only logged (app continues). No top-level process uncaught handler shown.
- **Depends on:** config, logger, SCHEMA_SQL, flushOutbox, ipc (registerIpcHandlers), configSync, seedBase, db path from app.getPath("userData").

### ipc.ts (`packages/desktop/electron/ipc.ts`)

- **Role:** Registers all IPC handlers (auth, pricing, offers, PDF, email, SMTP, config, updates, shell). Uses wrap() for logging; requireAuth()/requireRole() for protected handlers. handleLogin calls performLogin (auth/login.ts) with getDb, backendUrl, supabaseLogin.
- **Errors:** Handlers use try/catch and return { ok: false, error } or throw AppError; wrap() logs. getPricingCache returns { ok: true, data: null } when no base.
- **Depends on:** getDb, getConfig, apiClient, getSupabase, logger, auth/login, configSync, db (getCachedBase, saveBase), outbox, SMTP, etc.

### preload (`packages/desktop/electron/preload.ts`)

- **Role:** contextBridge.exposeInMainWorld("planlux", planlux) and ("api", api). Whitelist ALLOWED_CHANNELS; safeInvoke checks channel. planlux.invoke(channel, ...args), app, updates, onUpdateAvailable/onUpdateDownloaded; api.syncBase, generatePdf, sendEmail, email.*, smtp.*.
- **Errors:** If channel not in ALLOWED_CHANNELS, Promise.reject. No direct node/fs exposure.
- **Depends on:** electron contextBridge, ipcRenderer.

### Window creation

- **Where:** main.ts createWindow(): BrowserWindow with webPreferences (nodeIntegration: false, contextIsolation: true, preload: path to preload). loadWindow(mainWindow) then either loadURL(devUrl) or loadFile(rendererPath).
- **Errors:** If no renderer file with id="root", dialog.showErrorBox.

### Auto-update

- **Where:** main.ts (around 556–568): electron-updater; setFeedURL from config.updatesUrl; on update-available/downloaded sent to renderer; planlux:downloadUpdate, planlux:quitAndInstall.
- **Errors:** Logged; no forced quit without user.

### File system paths

- **userData:** `app.getPath("userData")` — overridden in E2E to e2eConfig.e2eBaseDir (main.ts 26–27).
- **DB path:** `dbPath = path.join(app.getPath("userData"), "planlux-hale.db")` (or e2e path) (main.ts 29–31). getDb() uses dbPath; FORCE_RESET_DB deletes that file before opening (main.ts 361–371).

### Logging

- **Where:** `packages/desktop/electron/logger/index.ts` — initLogger(userDataPath, opts); writes to userData/logs; level from config (electron config logging.level).
- **Usage:** logger.info/warn/error throughout main and ipc.

### Main-process runtime flow (diagram)

```
app.whenReady()
  → E2E path override (if E2E)
  → initLogger(userData)
  → requireSupabase(config)
  → createSupabaseClient → apiClient = createSupabaseApiAdapter(supabase, supabaseUrl)
  → database = getDb()
       → [if FORCE_RESET_DB] delete dbPath
       → new Database(dbPath)
       → db.exec(SCHEMA_SQL)
       → runMigrations(db)  [users_roles_3, users_roles_4, pdfs, offer_counters, config_sync_meta, password_auth_v1, crmMigrations, email_history migration]
       → PRAGMA foreign_keys = ON
  → seedBaseIfEmpty(database)
  → [if getLocalVersion === 0] remove stale pricing_cache.json
  → syncConfig(database, logger, apiClient)  [getMeta → getBase or fallback/seed → saveBase]
  → registerIpcHandlers({ getDb, getDbPath, apiClient, getSupabase, config, logger })
  → [optional] ADMIN_INITIAL_EMAIL promote, admin seed
  → createWindow() → loadWindow() → loadURL or loadFile
  → IPC ready
```

---

## SECTION 3 — Local DB (SQLite) audit

### 1) Schema definitions

- **Base schema:** `packages/shared/src/db/schema.ts` — exports `SCHEMA_SQL` (users, offers, pricing_cache, pdfs, emails, outbox, activity, sessions). Mirrored in `packages/shared/sql/schema.sql` (no sessions in snippet seen; schema.ts has sessions).
- **Migrations (in main):** `packages/desktop/electron/main.ts` runMigrations():
  - users_roles_3: CHECK (ADMIN, BOSS, SALESPERSON)
  - users_roles_4: CHECK (HANDLOWIEC, SZEF, ADMIN)
  - Column adds: active, must_change_password, password_set_at, created_by_user_id, last_synced_at
  - pdfs: recreate with error_message, PDF_CREATED/PDF_FAILED
  - offer_counters table
  - config_sync_meta, pricing_surface, addons_surcharges, standard_included
  - password_auth_v1: password_salt, password_algo_version, password_unavailable, last_online_login_at
- **CRM:** `packages/desktop/electron/migrations/crmMigrations.ts` — offers_crm, email_history (unified), event_log, smtp_accounts, outbox CHECK extension, etc.
- **Email history:** `packages/desktop/electron/db/migrations/0001_email_history_to_email.ts` — add to_email, backfill from to_addr.

### 2) Tables and columns (from schema + migrations)

- **users:** id PK, email UNIQUE, password_hash, role CHECK (HANDLOWIEC|SZEF|ADMIN after users_roles_4), display_name, active, must_change_password, password_set_at, created_by_user_id, created_at, updated_at; + password_salt, password_algo_version, password_unavailable, last_online_login_at, last_synced_at (migrations).
- **offers:** id PK, user_id FK users(id), client_name, client_email, client_phone, width_m, length_m, height_m, area_m2, variant_hali, variant_nazwa, base_price_pln, base_row_json, additions_json, standard_json, total_pln, created_at, updated_at.
- **offers_crm:** id PK, offer_number, user_id FK users(id), status, created_at, pdf_generated_at, emailed_at, realized_at, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, material_info, version, updated_at (+ indexes).
- **pricing_cache:** id AUTOINCREMENT, pricing_version UNIQUE, last_updated, cennik_json, dodatki_json, standard_json, fetched_at.
- **config_sync_meta:** id CHECK (id=1), version, last_synced_at.
- **pricing_surface, addons_surcharges, standard_included:** id AUTOINCREMENT, data_json.
- **pdfs:** id PK, user_id FK users(id), offer_id FK offers(id), client_name, variant_hali, width_m, length_m, height_m, area_m2, total_pln, file_path, file_name, status CHECK (LOCAL|LOGGED|PDF_CREATED|PDF_FAILED), error_message, logged_at, created_at.
- **emails:** id PK, user_id FK users(id), pdf_id FK pdfs(id), to_email, subject, status CHECK (DO_WYSŁANIA|SENT|FAILED), sent_at, error_message, created_at.
- **email_history:** (crmMigrations) id, related_offer_id, offer_id, outbox_id, account_id, user_id, from_email, to_email, to_addr, subject, body, attachments_json, status, error_message, sent_at, idempotency_key, etc.
- **outbox:** id PK, operation_type CHECK (SEND_EMAIL, SEND_GENERIC_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT, OFFER_SYNC), payload_json, retry_count, max_retries, last_error, created_at, processed_at.
- **activity:** id PK, user_id FK users(id), device_type, app_version, online, occurred_at, synced.
- **sessions:** id PK, user_id FK users(id), started_at, ended_at, device_type, app_version.

### 3) PKs, FKs, constraints, indexes

- **users:** PK id; idx_users_email, idx_users_role; role CHECK.
- **offers:** PK id; FK user_id → users(id); idx_offers_user_id, idx_offers_created_at, idx_offers_client_name.
- **offers_crm:** PK id; FK user_id → users(id); status CHECK; indexes on user_id, status, offer_number, created_at.
- **pdfs:** PK id; FK user_id → users(id), offer_id → **offers(id)**; status CHECK; indexes on user_id, created_at, status.
- **emails:** PK id; FK user_id → users(id), pdf_id → pdfs(id); status CHECK; indexes on user_id, status, created_at.
- **email_history:** FK and CHECK from crmMigrations (e.g. status values).
- **outbox:** operation_type CHECK; indexes on processed_at, created_at, operation_type.

### 4) SQLITE_CONSTRAINT_FOREIGNKEY in login flow — root cause

- **Which FK:** Any insert that references `users(id)` (e.g. offers_crm.user_id, pdfs.user_id, email_history.user_id, activity.user_id) will fail if the referenced user row does not exist.
- **Where insert order is wrong:** Login flow in `packages/desktop/electron/auth/login.ts`: after Supabase auth success, the code runs `ensureLocalUserExists(db, {...})` (INSERT OR IGNORE into users) then continues with UPDATE or further INSERTs. If `ensureLocalUserExists` is skipped (e.g. wrong schema/role) or fails silently, or if another code path (e.g. syncConfig, activity, or offer creation) runs before the user row exists, an insert that references `user_id` can run before the user is in `users`.
- **What ensureLocalUserExists should do:** Run **before** any other write that might reference users: INSERT OR IGNORE INTO users (id, email, display_name, role, active, password_hash, created_at, updated_at) with the Supabase user id and profile (display_name, role). Map role to DB enum (roleForDb) when table has (ADMIN, BOSS, SALESPERSON). So: 1) Ensure user row exists immediately after auth success; 2) Use correct role value for the current table CHECK; 3) No dependent inserts (offers_crm, pdfs, activity, etc.) before this.

**Additional FK risk:** `pdfs.offer_id` REFERENCES **offers(id)**. If the app stores offers in `offers_crm` and uses `offers_crm.id` as `pdfs.offer_id`, the FK fails because offers_crm.id is not in offers(id). Need to confirm whether pdfs.offer_id is set to offers.id or offers_crm.id (see ipc insertPdf / ensureOfferPdf usage).

---

## SECTION 4 — Supabase integration audit

### 1) Client creation and keys

- **Where:** `packages/desktop/electron/supabase/client.ts` — createSupabaseClient(config). Uses config.supabase.url and config.supabase.anonKey (no service role). auth.persistSession: true, storageKey: "planlux-supabase-auth", detectSessionInUrl: false.
- **Config source:** `packages/desktop/electron/config.ts` — loadDotenvOnce(); reads SUPABASE_URL, SUPABASE_ANON_KEY (or VITE_SUPABASE_*). getConfig() returns AppConfig with supabase.url, supabase.anonKey.
- **Session:** Stored by Supabase client (persistSession); main process only; no explicit refresh logic shown in client.ts.

### 2) Supabase tables/RPC used

- **profiles:** authSupabase.ts — select id, email, display_name, role; eq("id", userId). Used after signInWithPassword to get role and display_name. App expects display_name (no "name").
- **base_pricing:** apiAdapter.ts — select payload, version; order by version desc; limit 1; maybeSingle(). Expected: one row with payload (object or JSON string) and version. Payload expected keys: cennik, dodatki, standard (and optional meta).
- **pdf_history:** apiAdapter logPdf — insert with offer_id, meta (id, userEmail, clientName, variantHali, …), created_by; select id.
- **email_history:** apiAdapter logEmail — insert (table and columns from adapter).
- **sync_log:** (referenced in comment in apiAdapter; not shown in snippet.)
- **app_users:** authSupabase — legacy read-only check (id, email, name, role) for diagnostics.
- **offers (Supabase):** ipc planlux:testEndToEnd — insert created_by, offer_number_status, status, payload, totals; select id. Then rpc_finalize_offer_number(p_offer_id). Storage offer-pdfs upload.

### 3) base_pricing specifics

- **Query:** `supabase.from("base_pricing").select("payload, version").order("version", { ascending: false }).limit(1).maybeSingle()` (apiAdapter.ts basePricingQuery).
- **Parsing:** parsePayload(row?.payload) — if object use as-is; if string JSON.parse; else {}. Then BasePricingPayload: cennik, dodatki, standard as arrays (Array.isArray guard); if cennik.length === 0 throw BASE_PRICING_EMPTY. Normalize to CennikRow, DodatkiRow, StandardRow (Polish keys: wariant_hali, Nazwa, cena, area_min_m2, stawka_jedn, etc.).
- **Versioning:** Row version used as meta.version; config_sync_meta.version and pricing_cache.pricing_version updated on save (db.ts saveBase, updateConfigSyncMeta).

### 4) Mismatches

- **profiles.display_name vs name:** App uses display_name (authSupabase select "id, email, display_name, role"; return user.name = displayName). No "name" column expected in profiles. Legacy app_users has "name" (diagnostics only).
- **offers vs offers_crm:** Local DB has both offers and offers_crm. Supabase testEndToEnd inserts into Supabase "offers" table (different schema: created_by, offer_number_status, status, payload, totals). Local pdfs.offer_id REFERENCES offers(id) — if UI/main only write offers_crm, FK target is wrong.
- **email_history:** Local email_history (crmMigrations) has many columns (to_email, to_addr, status, etc.); migration 0001 adds to_email and backfills from to_addr. Supabase email_history (logEmail) — shape must match what apiAdapter expects.
- **rpc_finalize_offer_number:** Called with p_offer_id (Supabase offers.id). Requires Supabase offers table and RPC existing; inputs: p_offer_id.

---

## SECTION 5 — Pricing engine audit

### 1) Calculator logic

- **Where:** `packages/shared/src/pricing/pricingEngine.ts` — calculatePrice(data: PricingEngineData, input: PricingInput): PricingResult. Data = { cennik, dodatki, standard } (arrays). matchBaseRow(cennik, variantHali, areaM2) filters by wariant_hali, then area_min_m2 <= areaM2 <= area_max_m2; fallbacks AREA_ABOVE_MAX, AREA_BELOW_MIN, AREA_GAP. Addons and standard applied per shared types.
- **Variants:** Built from cennik: unique wariant_hali (pricingEngine uses variantHali from input; UI must get variant list from cennik).
- **Area/price:** area_min_m2, area_max_m2, cena per row; totalBase = cena * areaM2 for matched row.

### 2) Canonical data model

- **PricingEngineData:** cennik: CennikRow[], dodatki: DodatkiRow[], standard: StandardRow[] (shared api/types and pricing/types). CennikRow: wariant_hali, Nazwa, cena, area_min_m2, area_max_m2, stawka_jednostka, etc. DodatkiRow: wariant_hali, nazwa, stawka, jednostka, warunek*. StandardRow: wariant_hali, element, ilosc, wartosc_ref, jednostka, uwagi.

### 3) Why “no variants” happens

- **Empty payload:** Supabase base_pricing returns no row or payload null/empty → parsePayload gives {} → cennikArr.length === 0 → BASE_PRICING_EMPTY; configSync then tries loadBaseFromLocalTables, then seedBaseIfEmpty; if still empty, lastSyncResult error.
- **Wrong key names:** If Supabase payload uses different keys (e.g. variant instead of wariant_hali), normalizeCennikRow maps them; but if payload is string and parsed to wrong shape, or keys missing, cennik can be [] or rows can lack wariant_hali so variants list is empty.
- **Cache not overwritten:** getLocalVersion from config_sync_meta or pricing_cache; forceRefresh when localVersion === 0 or LOG_LEVEL=debug; if meta.version <= localVersion and !forceRefresh, sync skipped — so if local version is stuck or meta is 0, cache may not refresh.
- **Fallback tables empty:** pricing_surface, addons_surcharges, standard_included empty until seedBaseIfEmpty or writeBaseToLocalTables runs. seedBaseIfEmpty runs on first getDb() and again in configSync when backend fails and local is empty.

### 4) Functions to modify later (for pricing/variants)

- `packages/desktop/electron/supabase/apiAdapter.ts`: getBase(), parsePayload(), normalizeBasePayload(), basePricingQuery() — ensure response shape and keys.
- `packages/desktop/src/services/configSync.ts`: syncConfig() — forceRefresh logic, fallback order, seed then reload.
- `packages/desktop/src/infra/db.ts`: getLocalVersion(), loadBaseFromLocalTables(), saveBase(), writeBaseToLocalTables().
- `packages/desktop/src/infra/seedBase.ts`: seedBaseIfEmpty() — default rows and table checks.
- `packages/desktop/electron/ipc.ts`: planlux:getPricingCache, planlux:calculatePrice — ensure data shape passed to calculatePrice matches PricingEngineData.
- `packages/shared/src/pricing/pricingEngine.ts`: calculatePrice(), matchBaseRow() — no change needed if data shape is correct; consider defensive checks for empty cennik.

---

## SECTION 6 — PDF & Email pipeline audit

### 1) PDF generation

- **Templates:** Referenced in ipc (planlux:loadPdfTemplateConfig, planlux:savePdfTemplateConfig, planlux:getPdfPreviewHtml); template config in userData (createFilePdfTemplateConfigStore). generatePdfFromTemplate in electron/pdf/.
- **Data mapping:** mapOfferDataToPayload; payload has offer, pricing, etc. (from shared/crm types).
- **Output naming:** buildPdfFileName / formatOfferNumberForFile (shared); output under userData/pdf or E2E dir.
- **History:** Local: insertPdf(getDb(), { id, offerId, userId, clientName, filePath, file_name, status: PDF_CREATED, … }) (ipc and generatePdf). Supabase: apiClient.logPdf(payload) (apiAdapter logPdf → pdf_history insert). pdfs table: offer_id REFERENCES offers(id) — must be existing offers.id or null/empty (cleanup in getDb deletes pdfs where offer_id IS NULL or '').

### 2) Email sending

- **SMTP config:** userData: smtp-config.json, .smtp_key, smtp_passwords.enc (secureStore). smtpSend.ts createSendEmailForFlush(getDb). List/upsert/test in ipc (planlux:smtp:*).
- **Outbox:** OutboxStorage (db/outboxStorage); operation_type SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT, OFFER_SYNC. flushOutbox(api, storage, sendEmail) processes queue; order HEARTBEAT → LOG_PDF → SEND_EMAIL → LOG_EMAIL.
- **email_history:** Local table (crmMigrations + 0001); inserts from ipc (e.g. planlux:sendOfferEmail, planlux:email:sendOfferEmail) with status, to_email, etc. Supabase logEmail via apiAdapter.
- **Errors:** Handlers catch and return ok: false or set status failed; outbox markFailed; retry_count/max_retries in outbox.

### 3) Table/column mismatches

- **outbox CHECK:** shared schema.ts has CHECK (operation_type IN ('SEND_EMAIL', 'SEND_GENERIC_EMAIL', 'LOG_PDF', 'LOG_EMAIL', 'HEARTBEAT', 'OFFER_SYNC')); shared sql/schema.sql snippet had only SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT — ensure migration or schema used at runtime includes all types.
- **email_history:** Multiple migrations and crmMigrations define columns; 0001 adds to_email. Ensure all code paths use same column set (to_email vs to_addr).
- **pdfs.offer_id:** FK to offers(id). If app only inserts offers_crm and uses offers_crm.id when creating pdfs, FK violation. Need to either use offers.id for pdfs or add a migration to reference offers_crm or make offer_id not a FK.

---

## SECTION 7 — IPC contract audit

### Channels (from ipc.ts and preload)

| Channel | Request | Response | Handler |
|---------|--------|----------|--------|
| planlux:login | (_, email, password) | { ok, user?, mustChangePassword?, error? } | handleLogin → performLogin |
| login | (_, payloadOrEmail, passwordMaybe?) | (legacy) | Same handleLogin |
| planlux:syncUsers | - | { ok, error?, synced? } | syncConfig users from backend |
| planlux:logout, planlux:endSession | - | - | Clear session |
| planlux:session | - | { user? } or throw | requireAuth |
| planlux:getPricingCache | - | { ok, data?: CachedBase \| null } | getCachedBase(getDb()) |
| planlux:getConfigSyncStatus | - | ConfigSyncResult | getConfigSyncStatus() |
| planlux:syncPricing, base:sync | - | { ok, status, version, lastUpdated, error?, data? } | syncConfig(db, logger, apiClient) |
| planlux:calculatePrice | (_, input: PricingInput) | { ok, result?: PricingResult } | getCachedBase + calculatePrice from shared |
| planlux:seedAdmin | - | { ok, error? } | Seed admin user |
| planlux:getOffers, planlux:saveOffer, planlux:createOffer, … | various | various | Offers/CRM |
| pdf:generate, planlux:generatePdf, planlux:pdf:ensureOfferPdf, … | payload/options | file path / result | PDF pipeline |
| planlux:sendOfferEmail, planlux:email:sendOfferEmail, planlux:email:send | payload | { ok, error? } | Email + outbox |
| planlux:smtp:*, planlux:settings:*, planlux:email:outboxList, … | various | various | SMTP / history |
| planlux:app:getVersion, planlux:updates:* | - | version/url | Config / updater |
| shell:openPath, shell:showItemInFolder | (_, path) | - | shell |
| planlux:checkInternet, planlux:isOnline | - | { ok, online? } | checkInternet / getOnlineState |
| planlux:testSupabaseConnection, planlux:testEndToEnd | - | { ok, error?, steps? } | Supabase test |

- **Dead/unused:** "login" (legacy) still registered alongside planlux:login; both point to same handler. api.syncBase → base:sync used by UI (Kalkulator autoSync).
- **Naming:** Mix of planlux:* and base:sync, pdf:generate, shell:*. Consistent planlux:* for app features.
- **Error propagation:** Most handlers return { ok: false, error } or throw; wrap() logs. getPricingCache returns { ok: true, data: null } on no cache (no throw).

---

## SECTION 8 — UI/Renderer audit

### 1) Entrypoint and main screens

- **Entry:** main.tsx → App.tsx (packages/desktop/renderer/src/app/App.tsx). LoginScreen, ChangePasswordScreen, MainLayout; state: user, mustChangePassword, loading, syncError, configOffline, updateInfo.
- **Screens:** Login (planlux:login), Change password (planlux:changePassword), MainLayout (tabs: Kalkulator, Oferty, PDF, Email, Admin, etc. from layout/routes).

### 2) How UI reads variants/base

- **Kalkulator.tsx:** loadPricing() calls api("planlux:getPricingCache"); sets setPricingData(r.data). useEffect runs loadPricing on mount. autoSync() calls api("base:sync") and if r.ok && r.data sets setPricingData(r.data). Variants likely derived from pricingData.cennik (e.g. unique wariant_hali). recalc() calls api("planlux:calculatePrice", { variantHali, widthM, lengthM, … }) (lines 307, 403, 494).
- **Empty state:** If getPricingCache returns data: null or cennik [], pricingData is null/empty; variant dropdown and calculation show “no variants” or error.

### 3) UI assumptions when base is missing

- **Kalkulator:** Expects pricingData with cennik, dodatki, standard; variant list from cennik; calculatePrice needs non-empty cennik for given variant. If base missing: no variants, recalc can return error (“Brak ceny – brak wariantu w cenniku” from pricingEngine).
- **Sync status:** getConfigSyncStatus() and base:sync response (status, error) shown in UI; syncError/offline state can block or warn but app continues with local data when possible.

---

## SECTION 9 — Risk register (top 20 issues)

| # | Severity | Symptom | Root cause | File/line | Fix strategy | Effort |
|---|----------|--------|------------|-----------|--------------|--------|
| 1 | Blocker | Pricing base empty; calculator no variants | Supabase base_pricing empty or RLS/query returns no row; fallback/seed not run or seed tables empty | apiAdapter getBase; configSync; seedBaseIfEmpty | 1) Verify base_pricing row and RLS. 2) Ensure seedBaseIfEmpty runs before sync and on fallback path. 3) Log payload keys and counts always in getBase. | M |
| 2 | Blocker | SQLITE_CONSTRAINT_FOREIGNKEY on login | Insert into tables with user_id FK before user row exists in users | auth/login.ts; ipc handlers that write user_id | 1) ensureLocalUserExists() first after auth with INSERT OR IGNORE. 2) Map role to DB enum (roleForDb). 3) Audit all code that inserts offers_crm/pdf/activity to run after login path. | M |
| 3 | Major | pdfs.offer_id FK to offers(id) | App may write offers_crm.id into pdfs.offer_id; FK references offers(id) | shared schema pdfs; ipc insertPdf | 1) Use offers_crm.id only if pdfs has no FK or FK updated to offers_crm. 2) Or ensure every offers_crm row has matching offers row and set pdfs.offer_id = offers.id. | M |
| 4 | Major | getLocalVersion can disagree with pricing_cache | getLocalVersion reads config_sync_meta first then pricing_cache; config_sync_meta updated in saveBase but pricing_cache is source of truth for rows | db.ts getLocalVersion; configSync | 1) Unify: either always use config_sync_meta.version or always MAX(pricing_version). 2) Ensure both updated together. | S |
| 5 | Major | Outbox CHECK vs shared constants | schema CHECK may omit SEND_GENERIC_EMAIL, OFFER_SYNC if old migration | shared db/schema.ts; crmMigrations outbox | 1) Align CHECK in all migrations and schema with OUTBOX_OPERATION_TYPES. 2) Migration to alter outbox CHECK if needed. | S |
| 6 | Major | Supabase profiles missing → login fails | If profile row missing, auth returns ok: false and user cannot log in | authSupabase.ts loginViaSupabase | 1) Auto-create profile with id, email on first login. 2) Return ok: true with minimal role (e.g. HANDLOWIEC) when profile null. | S |
| 7 | Major | base_pricing payload string vs object | Payload may be JSON string; parsePayload handles it but row.payload type from Supabase may be unknown | apiAdapter parsePayload, getBase | 1) Always parse (string or object). 2) Log typeof payload. 3) Validate after parse. | S |
| 8 | Minor | Two login channels (login, planlux:login) | Redundant; preload whitelists both | ipc.ts; preload ALLOWED_CHANNELS | 1) Deprecate "login" or route both to same handler. 2) Document single channel for renderer. | S |
| 9 | Minor | VITE_DEV_SERVER_URL not set in production | loadWindow uses process.env.VITE_DEV_SERVER_URL; in prod it's undefined so loadFile path used | main.ts loadWindow | 1) No change needed; document that dev uses cross-env. 2) Ensure build leaves renderer in expected path. | S |
| 10 | Minor | E2E testEndToEnd assumes Supabase offers table | Inserts into supabase.from("offers") with created_by, offer_number_status, status, payload, totals | ipc.ts planlux:testEndToEnd | 1) Document Supabase schema for offers. 2) Skip or mock if Supabase not configured. | S |
| 11 | Minor | email_history to_email vs to_addr | Migration 0001 adds to_email; some code may still use to_addr | db/migrations/0001; ipc email handlers | 1) Prefer to_email everywhere. 2) Backfill done; remove to_addr usage over time. | S |
| 12 | Minor | Logger level from config only | LOG_LEVEL=debug not read if config.logging.level is different | config.ts; apiAdapter console.log | 1) In apiAdapter, also check process.env.LOG_LEVEL for debug logs. 2) Or centralize debug flag. | S |
| 13 | Minor | FORCE_RESET_DB deletes DB before open | getDb() deletes then opens; if open fails, app may crash | main.ts getDb | 1) Keep; document for dev only. 2) Add guard to avoid in production (e.g. NODE_ENV). | S |
| 14 | Minor | session storage in Supabase client | persistSession in memory; main process restart loses session unless persisted to disk | supabase/client.ts | 1) Check Supabase docs for custom storage. 2) Or accept re-login after restart. | S |
| 15 | Minor | Preload ALLOWED_CHANNELS may miss new handlers | New ipcMain.handle in ipc.ts must be added to preload | preload.ts ALLOWED_CHANNELS | 1) Add new channels when adding handlers. 2) Consider single list in shared constant. | S |
| 16 | Minor | offer_counters and offers_crm offer_number | Temp numbers TEMP-*; finalize via Supabase RPC or local logic | ipc offer number handlers; Supabase rpc_finalize_offer_number | 1) Document flow. 2) Ensure local and Supabase numbering consistent. | M |
| 17 | Minor | createWindow single window | No multi-window; reopening may need state | main.ts createWindow | 1) No change unless multi-window required. | - |
| 18 | Minor | Auto-updater setFeedURL from config | If updatesUrl wrong, updates fail silently | main.ts autoUpdater | 1) Log update errors. 2) Expose update status in UI. | S |
| 19 | Minor | Kalkulator autoSync on mount | base:sync called once on mount; no periodic refresh | Kalkulator.tsx useEffect | 1) Optional: refresh on focus or interval. 2) User can trigger sync. | S |
| 20 | Minor | Type CachedBase in db.ts | Moved from baseSync; shared types depend on it | db.ts CachedBase | 1) Export from db.ts. 2) Keep single source. | S |

---

## SECTION 10 — Fix plan (phased)

### Phase 1: App boots reliably + TS clean + no FK crashes (Est. M)

- Ensure Node >= 20.19.0 and known-good dev command (Section 1).
- Fix login FK: ensureLocalUserExists() always first after Supabase auth; roleForDb() for CHECK; verify no insert with user_id before user exists (auth/login.ts, ipc).
- Resolve pdfs.offer_id: either migrate to FK offers_crm(id) or ensure pdfs.offer_id is always offers.id when set (main + ipc insertPdf / ensureOfferPdf).
- Run full TS build and fix any remaining strict errors (apiAdapter, db, configSync already touched).
- Unify getLocalVersion and config_sync_meta vs pricing_cache (db.ts).

### Phase 2: Pricing base works (variants + compute) + cache refresh (Est. M)

- Verify Supabase base_pricing: one row, payload with cennik, dodatki, standard; RLS allows read.
- Harden getBase: logging (URL, status, body slice), validate structure, throw BASE_PRICING_EMPTY; normalize Polish keys.
- configSync: forceRefresh when localVersion === 0; on getBase failure try loadBaseFromLocalTables → if empty seedBaseIfEmpty → reload from local; then saveBase + writeBaseToLocalTables.
- main: seedBaseIfEmpty(database) after getDb() before syncConfig.
- UI: ensure getPricingCache and base:sync response feed Kalkulator; show “no variants” and sync error clearly.

### Phase 3: PDF + Email + history stable end-to-end (Est. M)

- Align outbox operation_type CHECK with shared OUTBOX_OPERATION_TYPES in schema and migrations.
- email_history: standardize on to_email; ensure all inserts use same columns (crmMigrations + 0001).
- PDF: confirm offer_id source (offers.id vs offers_crm.id); insertPdf only with valid offer_id or null per FK.
- Log PDF and log Email: verify Supabase pdf_history and email_history table shapes match apiAdapter.
- Outbox flush order and retries; expose failure in UI (email history, outbox list).

### Phase 4: Hardening (RLS, security, migrations, tests) (Est. L)

- Supabase RLS: document and verify for profiles, base_pricing, pdf_history, email_history, offers.
- No secrets in logs; config sanitization (already sanitizeConfigForLog).
- Migrations: idempotent and ordered; add migration log table if needed.
- E2E: testEndToEnd and admin/login specs; optional coverage for pricing sync and login.
- Preload: keep ALLOWED_CHANNELS in sync with ipc handlers; consider shared enum.

---

**End of report.**  
For implementation, start with Phase 1 (login FK and pdfs FK), then Phase 2 (pricing base and seed), then Phase 3 (PDF/email), then Phase 4.
