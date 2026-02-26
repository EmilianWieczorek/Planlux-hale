# Raport audytu – Planlux Hale (A→J). BEFORE / AFTER + poprawki P0/P1

Źródło wymagań: kanoniczny raport audytu (Raport audytu – Planlux Hale vs założenia projektu).

---

## Step 1 — BEFORE (as-is) compliance checklist (A→J)

| Heading | Requirement | Status | File path(s) / function or lines |
|---------|-------------|--------|-----------------------------------|
| **A) Product & users** | Desktop Electron MVP, ~10 users, internal-only | ✅ | `packages/desktop/` (Electron + React) |
| | Roles USER and ADMIN | ✅ | `packages/desktop/electron/ipc.ts` (login, role); `packages/desktop/renderer/src/types/index.ts` (UserRole) |
| **B) Offline-first** | Pricing works offline | ✅ | `packages/shared/src/pricing/pricingEngine.ts`; cache `pricing_cache` |
| | PDF generation works offline | ✅ | `packages/desktop/electron/ipc.ts` planlux:generatePdf (local write, insertPdf) |
| | History from local DB | ✅ | planlux:getPdfs, planlux:getEmails – SQLite |
| | Email offline → OUTBOX DO_WYSŁANIA | ⚠️ | Type in renderer types; send-email button disabled; no enqueue flow yet |
| | Online returns: base sync + OUTBOX flush | ❌ | base:sync existed; **flushOutbox was not called** (main.ts, ipc.ts) |
| **C) Data source** | Endpoint configured | ✅ | `packages/desktop/src/config.ts` L9–10; `packages/shared/src/api/client.ts` DEFAULT_BASE_URL |
| | Local cache SQLite (pricing_cache) | ✅ | `packages/shared/src/db/schema.ts`; `packages/desktop/src/infra/db.ts` getLocalVersion, saveBase, getCachedBase |
| | META.version, lastUpdated | ✅ | `packages/desktop/src/infra/baseSync.ts` getRemoteMeta, version compare |
| | Tables CENNIK / DODATKI / STANDARD | ✅ | API cennik, dodatki, standard |
| **D) Pricing base match** | areaM2 = widthM * lengthM | ✅ | `ipc.ts` areaM2 = inp.widthM * inp.lengthM; engine input.areaM2 |
| | max_width_m ignored | ✅ | `packages/shared/src/pricing/pricingEngine.ts` (no use); types without max_width_m in logic |
| | Match 1–4 (range / above max / below min / gap) | ✅ | `pricingEngine.ts` matchBaseRow L54–146 |
| | UI banner when fallback | ✅ | `Kalkulator.tsx` (AREA_ABOVE_MAX, AREA_BELOW_MIN, AREA_GAP) |
| **E) Addons** | Units m2 (mkw), mb, szt, kpl | ✅ | `pricingEngine.ts` computeAdditions |
| | Normalize mkw → m2 | ✅ | `normalizeJednostka` in computeAdditions (`packages/shared/src/pricing/pricingEngine.ts` L183) |
| | Stawka string "4 000zł" → number | ✅ | toNumber in normalize; normalizeDodatki |
| | Height condition (warunek_min/max) | ✅ | satisfiesCondition; normalizeDodatki |
| **F) Standard in price** | Shown "w cenie" in breakdown | ✅ | `packages/shared/src/pdf/template.ts` standardRows |
| | perimeterMb = 2*(width+length) | ✅ | getStandardInPrice, calculatePrice perimeterMb |
| | (P2) standardRefValue total line | ⚠️ | Not implemented (P2) |
| **G) PDF** | Offline HTML→PDF, local save, DB insert | ✅ | ipc planlux:generatePdf; insertPdf; renderOfferHtml |
| | LOG_PDF on fail → outbox | ✅ | ipc generatePdf: on logPdf failure enqueue LOG_PDF |
| | (P2) Planlux-PDF.zip template | ⚠️ | Inline template only (P2) |
| **H) Email** | SMTP CyberFolks in code | ✅ | `packages/shared/src/email/smtpSender.ts` |
| | Password only locally | ✅ | `packages/shared/src/email/credentials.ts` |
| | Offline → OUTBOX; online → send + log | ⚠️ | flushOutbox now called; send-email flow still disabled |
| **I) History & Admin** | USER: own history | ✅ | getPdfs/getEmails(userId, false) |
| | ADMIN: global history + activity | ✅ | getPdfs/getEmails(isAdmin true); Admin panel |
| | Admin user mgmt / reset (no break) | ⚠️ | Partial; must not break |
| **J) Stability & build** | npm run build, npm run desktop | ✅ | Root package.json; desktop vite + tsc |
| | No unhandled rejections | ✅ | IPC try/catch + logger.error; flush and logPdf catch |
| | UI diagnostics human-friendly | ✅ | formatNoMatchMessage; Kalkulator errorMessage + fallback |

---

## Step 2 — Code changes (P0/P1)

### Modified files (full content in repo)

1. **packages/desktop/electron/main.ts**
   - Import: `getRemoteMeta` from `../src/infra/baseSync`, and `Db` from `../src/db/outboxStorage`.
   - After `createWindow()`, `setInterval` (every `config.outboxFlushIntervalMs`):
     - **Real online check:** `getRemoteMeta(config.backend.url, globalThis.fetch.bind(globalThis), 5000)`; set `online = meta != null`; on exception set `online = false` and log `[outbox] online check failed`.
     - Call `flushOutbox({ api: apiClient, storage: createOutboxStorage(getDb() as Db), isOnline: () => online, sendEmail: undefined })`; log `[outbox] flush` when processed or failed > 0; in catch log `[outbox] flush error`.
   - All inside try/catch; no unhandled rejections.

2. **packages/desktop/electron/ipc.ts**
   - **base:sync:** After sync, if status is `synced`, `unchanged`, or `offline`, trigger `flushOutbox` asynchronously (do not await before returning IPC response). Use `createOutboxStorage(db as Parameters<typeof createOutboxStorage>[0])`, `isOnline: () => true`, `sendEmail: undefined`. `.then(r => ...)` and `.catch(e => logger.error("[outbox] flush after sync failed", e))`.
   - **planlux:generatePdf:** On `apiClient.logPdf(logPdfPayload)` failure: log `[pdf] logPdf failed -> enqueue LOG_PDF`; enqueue LOG_PDF to outbox (`generateOutboxId`, INSERT into outbox); log `[pdf] LOG_PDF enqueued` with outboxId and pdfId; inner try/catch so no unhandled rejection.

3. **packages/shared/src/pricing/pricingEngine.ts**
   - **P1-1:** In `computeAdditions`, use `normalizeJednostka(def.jednostka)` (import from `./normalize`) instead of `(def.jednostka || "").toLowerCase()`. Comparisons remain against `"m2"`, `"mb"`, `"kpl"`.
   - **P1-3:** `runPricingSelfTest()` covers: in-range match; AREA_ABOVE_MAX; AREA_BELOW_MIN; missing variant → error; AREA_GAP; string price `"4 000zł"`. Runnable via node after build.

4. **packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx**
   - **P1-2:** When result.success, display “Cena bazowa: {base.totalBase} zł” and “Dodatki: {totalAdditions} zł”. Result state and API response typing include `totalAdditions` and `base.totalBase`.

5. **packages/desktop/src/db/outboxStorage.ts**
   - Export type `Db` with `run: (...args: unknown[]) => unknown` and `all: (...args: unknown[]) => unknown[]` so better-sqlite3 Database is accepted. Used for type assertion in main/ipc.

### New files

None.

---

## Step 3 — AFTER (to-be) compliance checklist (A→J)

| Heading | Requirement | Status | Notes |
|---------|-------------|--------|--------|
| **A) Product & users** | Desktop MVP, USER/ADMIN, internal | ✅ | Unchanged |
| **B) Offline-first** | Pricing offline | ✅ | Unchanged |
| | PDF offline | ✅ | Unchanged |
| | History from local DB | ✅ | Unchanged |
| | Email offline → OUTBOX | ⚠️ | Type/UI present; full send flow still disabled |
| | **Online returns: sync + OUTBOX flush** | ✅ | **main.ts:** setInterval + real online (GET meta); **ipc.ts:** flush after base:sync (synced/unchanged/offline) |
| **C) Data source** | Endpoint, cache, META, tables | ✅ | Unchanged |
| **D) Pricing base match** | area, no max_width, match 1–4, UI banner | ✅ | Unchanged |
| **E) Addons** | Units, mkw→m2, stawka string, height | ✅ | normalizeJednostka in computeAdditions |
| **F) Standard in price** | "w cenie", perimeterMb | ✅ | (P2: standardRefValue sum not done) |
| **G) PDF** | Offline gen, local+DB, LOG_PDF→outbox on fail | ✅ | logPdf failed → enqueue LOG_PDF; log enqueue result |
| **H) Email** | SMTP, credentials local; flush runs | ✅ | sendEmail undefined; full send flow P2 |
| **I) History & Admin** | USER/ADMIN history, admin partial | ✅ | Unchanged |
| **J) Stability & build** | build, desktop, no unhandled rejections, friendly UI | ✅ | Unchanged |

**Remaining P2 (not required now):** standardRefValue sum in UI/PDF; Planlux-PDF.zip template; full email send flow (button + SEND_EMAIL/LOG_EMAIL enqueue).

---

## Commands to verify

```bash
cd "c:\Users\emilw\Desktop\Planlux hale"
npm run build
npm run desktop
```

```bash
# Pricing self-test (after build)
node -e "require('./packages/shared/dist/pricing/pricingEngine.js').runPricingSelfTest()"
# Expected output: "Pricing self-test OK"
```

---

## Manual test checklist

1. **Online: sync + pricing + PDF**
   - Start app (online). Login (e.g. admin@planlux.pl / admin123). Kalkulator → Synchronizuj bazę. Enter dimensions (e.g. 12×20). Check total and breakdown (Cena bazowa, Dodatki). Generuj PDF. Open file; check Historia PDF. Expect: PDF created; if backend reachable, logPdf succeeds.

2. **Offline: pricing + PDF**
   - Disconnect network. Kalkulator: change dimensions; pricing and breakdown work from cache. Generuj PDF. Expect: file saved; entry in pdfs (LOCAL). Log: "logPdf failed -> enqueue LOG_PDF" and "LOG_PDF enqueued". Outbox has one pending LOG_PDF row.

3. **Offline: email queued (DO_WYSŁANIA)**
   - When send-email is implemented: offline send should enqueue. Current: button disabled.

4. **Reconnect → outbox flush**
   - After step 2, reconnect. Wait for interval (e.g. 60 s) or click Synchronizuj bazę. Expect: outbox LOG_PDF processed (processed_at set); backend receives log. Logs: "[outbox] flush" or "[outbox] flush after sync" with processed > 0 when online.

---

*Raport zgodny z kanoniczną specyfikacją audytu. Zmiany minimalne; reguły cenowe (max_width_m wyłączone, fallbacki area) bez zmian. Tryb file:// zachowany.*
