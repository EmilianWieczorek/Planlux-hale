# Planlux Hale – Architektura i Audyt

**Wersja audytu:** 2026-02-24  
**Autor:** Senior Software Architect + Electron Lead Developer

---

## 1. Mapa repozytorium

### 1.1 Struktura główna

```
planlux-hale/
├── packages/
│   ├── shared/          # Logika współdzielona (pricing, PDF, API, sync, typy CRM)
│   │   └── src/
│   │       ├── api/         # ApiClient, typy request/response
│   │       ├── crm/        # OfferCrm, EmailHistory, UserRole
│   │       ├── db/         # SCHEMA_SQL
│   │       ├── email/      # smtpSender, credentials
│   │       ├── pdf/        # generator, template, generatePdfPayload
│   │       ├── pricing/    # pricingEngine, normalize, types
│   │       ├── sync/       # outbox, pricingSync
│   │       └── utils/      # pdfFileName
│   │
│   └── desktop/         # Aplikacja Electron
│       ├── electron/    # Main process
│       │   ├── main.ts           # Okno, DB init, flush outbox
│       │   ├── ipc.ts            # 48 handlerów IPC (~1810 linii)
│       │   ├── preload.ts
│       │   ├── smtpSend.ts
│       │   ├── deviceId.ts
│       │   ├── migrations/       # crmMigrations
│       │   └── pdf/              # generatePdf, generatePdfFromTemplate, renderTemplate
│       ├── src/          # Shared desktop code
│       │   ├── config.ts, logger.ts
│       │   ├── db/               # outboxStorage, pricingSyncStorage
│       │   └── infra/            # baseSync, db
│       └── renderer/     # React UI
│           └── src/
│               ├── features/     # admin, auth, dashboard, historia, kalkulator, layout, oferty
│               ├── state/        # offerDraftStore, pdfOverrides, useOfferDraft
│               ├── theme/        # tokens, planluxTheme
│               └── types/
│
├── Planlux-hale-analiza/  # Docs + osobne repo (nested .git)
│   └── docs/             # ARCHITECTURE-ULTRA, API_CONTRACT, SCHEMA_SQLITE, ...
└── docs/                 # (jeśli istnieje)
```

**Uwaga:** Brak pakietu `mobile` – workspace ma `packages/*`, ale mobile nie istnieje.

---

### 1.2 Przepływ danych

```
┌─────────────────┐     IPC (planlux:*)      ┌─────────────────┐
│   React UI      │ ◄──────────────────────► │   Main Process  │
│   (renderer)    │   invoke(channel, args)  │   (ipc.ts)      │
└────────┬────────┘                          └────────┬────────┘
         │                                             │
         │                                             ├──► SQLite (users, offers_crm, email_history, outbox, pdfs)
         │                                             │
         │                                             ├──► ApiClient (Google Apps Script)
         │                                             │     • meta, base, logPdf, logEmail, heartbeat, reserveNumber
         │                                             │
         │                                             ├──► PDF: generatePdfFromTemplate → printToPDF
         │                                             │
         │                                             └──► SMTP (nodemailer) – sendOfferEmail
         │
         └──► offerDraftStore (zustand) – persystencja draft → planlux:saveOfferDraft
```

**Kolejność outbox (ARCHITECTURE-ULTRA):** HEARTBEAT → LOG_PDF → SEND_EMAIL → LOG_EMAIL → OFFER_SYNC

---

## 2. Hotspots (plików z największą złożonością)

| Plik | Szac. linie | Problem |
|------|-------------|---------|
| `packages/desktop/electron/ipc.ts` | **~1810** | 48 handlerów IPC w jednym pliku, trudne utrzymanie |
| `packages/desktop/renderer/.../Kalkulator.tsx` | **~1028** | Monolit: konfiguracja + addons + PDF preview + numeracja |
| `packages/desktop/renderer/.../OfferDetailsView.tsx` | ~350 | Duży, ale czytelny |
| `packages/shared/src/pricing/pricingEngine.ts` | ~400 | Złożona logika, OK |
| `packages/desktop/electron/pdf/generatePdfFromTemplate.ts` | ~350 | mapOfferDataToPayload + szablony |

---

## 3. Duplikacje i łamanie zasad

### 3.1 Numeracja oferty (ryzyko: WYSOKIE)

- **Źródło prawdy:** `planlux:getNextOfferNumber` (ipc) – reserveNumber API lub TEMP-{deviceId}-{ts}
- **Duplikacja:** Kalkulator.tsx ma własną logikę fallback w **3 miejscach**:
  - localStorage licznik `offerCounter:PLX-${initial}:${year}` (linie ~504–514, ~708–716, ~776–786)
- **Problemy:**  
  - Renderer generuje numer lokalnie (localStorage), co może powodować konflikty  
  - `saveOfferDraft` (ipc) też generuje numer przy `TEMP-` (linia 915) – kolejna ścieżka  
  - Brak jednego miejsca decyzji: „gdy tworzę ofertę, numer przychodzi z main”

**Rekomendacja:** Numer tworzony wyłącznie w main/IPC; saveDraft nigdy nie nadaje numeru; Kalkulator usuwa fallback localStorage.

---

### 3.2 escapeHtml i fmtNum (ryzyko: ŚREDNIE)

- `escapeHtml` – zduplikowane w 3 plikach:  
  - `shared/src/pdf/template.ts`  
  - `desktop/electron/pdf/generatePdfFromTemplate.ts`  
  - `desktop/electron/pdf/renderTemplate.ts`
- `fmt` / `fmtNum` – w 2 plikach: `shared/pdf/template.ts`, `desktop/.../generatePdfFromTemplate.ts`

**Rekomendacja:** Jeden moduł `shared/utils/format.ts` z `escapeHtml` i `formatCurrency`.

---

### 3.3 Statusy oferty

- `OfferStatus` w `shared/crm/types.ts`: IN_PROGRESS | GENERATED | SENT | REALIZED ✅  
- Używane w wielu miejscach jako string literal – ryzyko literówek.  
**Rekomendacja:** Używać wyłącznie `OfferStatus` z shared, bez duplikowania stringów.

---

### 3.4 Mapowanie oferty → PDF

- `mapOfferDataToPayload` w `generatePdfFromTemplate.ts` – główny builder
- `shared/pdf/template.ts` – `renderOfferHtml` – inny format danych (PdfTemplateData)
- `renderTemplate.ts` – tokeny {{}} – trzeci mechanizm

**Rekomendacja:** Jeden „payload builder” w shared, desktop tylko go wywołuje i przekazuje do szablonu.

---

## 4. Spis modułów i odpowiedzialności

| Moduł | Odpowiedzialność | Stan |
|-------|-----------------|------|
| `shared/api` | Klient HTTP do Apps Script | ✅ OK |
| `shared/crm/types` | OfferCrm, EmailHistory, UserRole, OfferStatus | ✅ OK |
| `shared/pricing` | Silnik wyceny, dodatki, standard | ✅ OK |
| `shared/pdf` | Generator PDF, template fallback | ⚠️ 2 ścieżki (template vs Canva) |
| `shared/sync` | Outbox, flush, kolejność operacji | ✅ OK |
| `desktop/electron/ipc` | Wszystkie handlery IPC | ❌ Za duży |
| `desktop/electron/pdf` | Canva template, printToPDF | ⚠️ escapeHtml/fmtNum duplikaty |
| `desktop/renderer/kalkulator` | Konfiguracja, addons, PDF preview | ❌ Monolit, duplikacja numeracji |

---

## 5. Ryzyka i zaległości

### Ryzyka techniczne

1. **ipc.ts (~1810 linii)** – zmiana wymaga dużej ostrożności, brak podziału na moduły.
2. **Numeracja w wielu miejscach** – localStorage vs reserveNumber vs saveDraft – ryzyko niespójności numerów.
3. **Tabele legacy vs CRM** – `emails` vs `email_history`, `offers` vs `offers_crm`, `pdfs` – możliwa dezorientacja.

### Zaległości

1. Brak pakietu `mobile` (React Native) – workspaces wskazuje na niego, ale nie istnieje.
2. Planlux-hale-analiza – osobne .git wewnątrz repo – decyzja: czy scalamy docs do głównego repo?
3. Brak testów jednostkowych dla: format numeru, role guard, obliczenia dodatków, payload builder.
4. Brak definicji „Definition of Done” i checklisty smoke.

---

## 6. Diagramy przepływów

### 6.1 Tworzenie oferty i numeracja

```
Kalkulator (renderer)
    │
    ├── [Nowa oferta] → planlux:getNextOfferNumber(userId)
    │                       │
    │                       ├── online: api.reserveOfferNumber() → PLX-E0001/2026
    │                       └── offline: TEMP-{deviceId}-{ts}
    │
    └── saveOfferDraft (debounce)
            │
            └── planlux:saveOfferDraft(draft, userId)
                    │
                    ├── Jeśli TEMP i brak w offers_crm → INSERT z TEMP
                    ├── Jeśli oferta istnieje → UPDATE
                    └── syncTempOfferNumbers (periodic) → reserveNumber per TEMP
```

### 6.2 Generowanie PDF

```
Kalkulator → [Generuj PDF]
    │
    └── pdf:generate(payload, templateConfig, options)
            │
            ├── mapOfferDataToPayload(payload) → OfferPdfPayload
            ├── renderTemplate / Canva template
            ├── printToPDF (Electron)
            ├── INSERT pdfs, offers_crm (status GENERATED)
            ├── event_log (PDF_GENERATED)
            └── logPdf (API) lub outbox LOG_PDF
```

### 6.3 Wysyłka e-mail

```
OfferDetails → [Wyślij e-mail]
    │
    └── planlux:sendOfferEmail(offerId, userId, { to, subject, body, pdfPath })
            │
            ├── online: SMTP → INSERT email_history SENT, UPDATE offers_crm SENT
            └── offline: INSERT email_history QUEUED, outbox SEND_EMAIL
                    │
                    └── flushOutbox → createSendEmailForFlush → nodemailer
```

---

## 7. Rekomendacje refactoru (priorytet)

| Priorytet | Działanie |
|-----------|-----------|
| P1 | Ujednolicić numerację: tylko main, usunąć localStorage z Kalkulatora |
| P1 | Podzielić ipc.ts na moduły: ipc-auth, ipc-offers, ipc-pdf, ipc-admin, ipc-sync |
| P2 | Wynieść escapeHtml + formatCurrency do shared/utils |
| P2 | Rozbić Kalkulator.tsx na: ConfigPanel, AddonsPanel, PdfPreviewSection, OfferNumberField |
| P3 | Jeden Offer→PdfPayload builder w shared |
| P3 | Dodać Definition of Done + smoke checklist |

---

## 8. Definition of Done (DoD)

- [ ] Build przechodzi (`npm run build`)
- [ ] Aplikacja startuje (`npm run desktop`)
- [ ] Nowa oferta online → numer PLX-* (np. PLX-E0001/2026)
- [ ] Nowa oferta offline → TEMP-*, po sync → PLX-*
- [ ] Generowanie PDF → preview OK, plik zapisany
- [ ] Wysyłka e-mail (online) → SENT w email_history
- [ ] Panel admina: lista użytkowników, aktywność, historia PDF/e-mail
- [ ] Brak błędów w konsoli przy typowych operacjach

## 9. Smoke checklista (ręczna)

| Scenariusz | Kroki | Oczekiwany efekt |
|------------|-------|------------------|
| Create offer online | Login → Kalkulator → Nowa oferta → generuj numer | PLX-X0001/2026 |
| Create offer offline | Odłącz sieć → Nowa oferta | TEMP-{deviceId}-{ts} |
| Sync TEMP→PLX | Offline TEMP → połączenie → sync | Numer zmienia się na PLX-* |
| Generate PDF | Wypełnij ofertę → Generuj PDF | Plik w PlanluxOferty, preview OK |
| Send email | Oferta z PDF → Wyślij e-mail | email_history SENT |
| Admin users | Login admin → Panel admina → Użytkownicy | Lista, dodawanie/edycja |
| Admin activity | Panel admina → Aktywność | Tabela heartbeatów |
| Admin history | Panel admina → Historia PDF / e-mail | Tabele z danymi |

## 10. Roadmapa – kolejne kroki po refactorze

1. **P1:** Usunąć fallback localStorage numeracji z Kalkulatora – numer tylko z `planlux:getNextOfferNumber`
2. **P1:** Podzielić ipc.ts na moduły (ipc-auth, ipc-offers, ipc-pdf, ipc-admin)
3. **P2:** Rozbić Kalkulator.tsx na mniejsze komponenty (ConfigPanel, AddonsPanel, PdfPreviewSection)
4. **P2:** Jeden Offer→PdfPayload builder w shared
5. **P3:** UI kit – PageHeader, SectionCard, EmptyState, ConfirmDialog
6. **P3:** Dodać vitest/jest dla szerszych testów (pricing, outbox)

## 11. Dokumenty powiązane

- `Planlux-hale-analiza/docs/ARCHITECTURE-ULTRA.md` – docelowa architektura
- `Planlux-hale-analiza/docs/API_CONTRACT.md` – kontrakt backendu
- `Planlux-hale-analiza/docs/SCHEMA_SQLITE.md` – schemat DB
- `Planlux-hale-analiza/docs/TEST_CHECKLIST.md` – testy

---

## 12. Podsumowanie refactoru (Deliverables)

### Wykonane zmiany

| # | Commit / Zmiana | Opis |
|---|-----------------|------|
| 1 | README-ARCH.md | Pełny audyt: mapa repo, hotspots, duplikacje, diagramy przepływów, DoD, smoke checklista |
| 2 | .gitignore | Rozszerzony: .vite, .cache, win-unpacked, *.zip, .idea |
| 3 | npm run clean, clean:all | Skrypty czyszczenia dist/release/win-unpacked; scripts/clean-all.js |
| 4 | shared/constants.ts | OFFER_STATUSES, USER_ROLES, EMAIL_HISTORY_STATUSES, OUTBOX_OPERATION_TYPES |
| 5 | shared/utils/format.ts | escapeHtml, formatCurrency – jedno źródło prawdy |
| 6 | shared/pdf/template.ts | Użycie escapeHtml, formatCurrency z shared (usunięcie lokalnych kopii) |
| 7 | desktop/.../generatePdfFromTemplate.ts | Użycie escapeHtml, formatCurrency z @planlux/shared |
| 8 | desktop/.../renderTemplate.ts | Użycie escapeHtml z @planlux/shared |
| 9 | packages/shared/test/format.test.js | Testy escapeHtml, formatCurrency, formatOfferNumberForFile |
| 10 | shared/package.json | Skrypt "test": "node test/format.test.js" |

### Największe „wins”

1. **Mniej duplikacji** – escapeHtml i formatCurrency w jednym miejscu (shared/utils/format.ts); usunięte 3 lokalne kopie.
2. **Prostsze utrzymanie** – stałe domenowe (constants) dostępne dla walidacji i UI.
3. **Czyste repo** – .gitignore obejmuje cache, buildy; `npm run clean:all` usuwa artefakty.
4. **Definition of Done + smoke checklista** – jasne kryteria akceptacji.
5. **Testy jednostkowe** – format, escapeHtml, formatOfferNumberForFile; `npm run test -w packages/shared` przechodzi.
6. **Dokumentacja architektury** – README-ARCH.md z diagramami, ryzykami i roadmapą.

### Build i smoke

- `npm run build` – przechodzi ✅  
- `npm run desktop` – aplikacja startuje ✅  
- `npm run test -w packages/shared` – 3/3 testy przechodzą ✅
