# Planlux Hale – Raport wykonania refaktoryzacji Enterprise

## Wykonane zmiany

### 1) Project cleanup
- Usunięto folder `Planlux-hale-analiza`
- Usunięto zbędne pliki: `GIT-REPO-SETUP.md`, `REPO-CLEANUP-REPORT.md`
- Zaktualizowano `.gitignore` (win-unpacked, release)

### 2) Code structure
- `packages/shared`: rozszerzono `USER_ROLES` o USER, BOSS
- `packages/shared/src/crm/types.ts`: `UserRole` z BOSS
- `packages/shared/src/constants.ts`: `USER_ROLES` = ["USER", "SALESPERSON", "BOSS", "MANAGER", "ADMIN"]
- `packages/shared/src/db/schema.ts`: CHECK role + BOSS

### 3) Fix offer numbering
- **createOffer** (IPC): rezerwuje numer (PLX online / TEMP offline), wstawia do `offers_crm`
- **saveOfferDraft**: nie generuje TEMP; używa istniejącego `offer_number` z draftu lub DB
- ** syncTempOfferNumbers**: bez zmian – nadal zamienia TEMP→PLX przy powrocie online
- **Kalkulator**: efekt `createOffer` przy pierwszym wypełnieniu clientName + width + length
- **offerDraftStore**: dodano `setDraftId`

### 4) Fix PDF preview
- CSP: `frame-src` + `planlux-pdf:`, `font-src` + `local`
- Szablon PDF: lokalne fonty (Inter, Segoe UI, Arial) – już było
- Diagnostyka: logi `[pdf] DIAGNOSTYKA` przy błędzie (clientName, widthM, lengthM, offerNumber, stack)

### 5) Admin panel
- IPC: `createUser`/`updateUser` – walidacja ról USER, BOSS, MANAGER, ADMIN, SALESPERSON
- AdminPanel: dodano opcje roli USER, BOSS w Select
- Snackbar: już było

### 6) DB migration
- Migracja `users_boss_role`: rozszerzenie CHECK o BOSS (tabela `_migrations`)
- `main.ts`: migracja users z BOSS w CHECK
- `crmMigrations.ts`: bez zmian (audit trail w `offer_audit` już jest)

### 7) CI/CD
- `.github/workflows/release.yml` bez zmian – flow:
  - push main → semantic-release → tag v*
  - tag v* → build-electron → GitHub Release

### 8) Auto-update
- `autoUpdater.autoDownload = true` – ciche pobieranie
- Modal „Nowa wersja dostępna” w App.tsx – było
- Preload i IPC – bez zmian

### 9) Security
- `contextIsolation: true`, `nodeIntegration: false` – było
- Walidacja ról w IPC – dodana
- Plik `.d.ts` dla electron-updater (compat)

### 10) Documentation
- `README.md`: instrukcje setup/build, strategia gałęzi, konwencje, troubleshooting
- `docs/TROUBLESHOOTING.md`: nowy plik – typowe problemy i rozwiązania
- `docs/REFACTOR-PLAN.md`: plan refaktoryzacji
- `docs/REFACTOR-EXECUTION-REPORT.md`: ten raport

---

## Sugerowane commity

```text
chore: remove Planlux-hale-analiza and redundant markdown

build: add createOffer IPC, fix saveOfferDraft (no TEMP generation)

fix: add BOSS role to users, migration + IPC validation

fix: PDF diagnostics, CSP for planlux-pdf protocol

feat: enable autoDownload for electron-updater

docs: README, TROUBLESHOOTING, refactor plan
```

---

## Definicja „zrobione”

- Monorepo uporządkowane
- Numeracja ofert przez `createOffer` → `reserveOfferNumber` → DB
- `saveOfferDraft` nie tworzy TEMP
- Panel admina z rolą BOSS
- Migracja BOSS w DB
- CI/CD (semantic-release + electron-builder)
- Auto-update z cichym pobieraniem
- CSP i logowanie błędów PDF
- Dokumentacja zaktualizowana

---

## Weryfikacja builda

```bash
npm install
npm run build
npm run dist:win
```

W razie błędu `spawn EPERM` (esbuild) uruchom build poza sandboxem lub w zwykłym terminalu.
