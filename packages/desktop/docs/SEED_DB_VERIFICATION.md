# Weryfikacja modelu Seed DB (Replace-on-invalid)

## Założenie

- **Baza nie istnieje** → aplikacja kopiuje seed DB do userData.
- **Baza istnieje i jest poprawna** → aplikacja jej używa.
- **Baza istnieje, ale jest pusta / uszkodzona / bez pricingu** → backup starej bazy, usunięcie, skopiowanie aktualnej seed DB. Jedna próba replace na start; po replace uruchamiane są migracje.

## Replace flow (kolejność w `getDb()`)

1. **Ścieżka seed**  
   Przed pierwszym `getDb()` ustawiana jest `seedPathForRecovery` (przez `getSeedDbPath`). W trybie E2E = `null` (brak replace).

2. **Brak pliku bazy**  
   Jeśli `!fs.existsSync(dbPath)` i jest `seedPathForRecovery`:
   - `copySeedToPath(seedPath, dbPath)`
   - Log: `[seed-db] local db missing, copied seed database`

3. **Otwarcie bazy**  
   Otwarcie pliku; przy wyjątku i przy istniejącym seedzie: backup + replace lub copy seed, ponowne otwarcie.

4. **Schema i migracje**  
   `SCHEMA_SQL`, `runMigrations(db)`.

5. **Walidacja**  
   Log: `[seed-db] validating local database`  
   Wywołanie `validateLocalDatabase(db)`.

6. **Baza niepoprawna, pierwsza próba**  
   Jeśli `!result.ok` i jest seed i `!replaceAttempted`:
   - Log: `[seed-db] validation failed: <reason>`
   - `backupAndReplaceWithSeed(dbPath, seedPath, logger)` (backup → usunięcie → copy seed)
   - `replaceAttempted = true`
   - Log: `[seed-db] running migrations after replacement`
   - `return getDb()` (jedna retry).

7. **Baza niepoprawna po replace**  
   Jeśli invalid i `replaceAttempted` już true: zamknięcie bazy, **throw** (twardy błąd, koniec bootstrapu).

8. **Baza poprawna**  
   Log: `[seed-db] local database valid`  
   Dalsze kroki (cleanup pdfs itd.) i zwrócenie `db`.

## Warunki uznania bazy za invalid

Funkcja `validateLocalDatabase(db)` zwraca `{ ok: false, reason, details? }` gdy:

- Brak tabeli `pricing_cache` lub `pricing_surface`
- `pricing_cache` jest puste (0 wierszy)
- `pricing_surface` ma 0 wierszy
- W `pricing_cache.cennik_json`: JSON się nie parsuje / nie jest tablicą / brak wariantów (`wariant_hali`)

## Backup starej bazy

- Nazwa pliku: `planlux-hale.db.broken-YYYYMMDD-HHMMSS.bak`
- Lokalizacja: ten sam katalog co `planlux-hale.db` (userData).
- Wykonywany tylko przy replace (gdy baza istnieje, ale walidacja zwraca invalid).

## Gdzie pakowana jest seed DB

- **Źródło:** `packages/desktop/assets/db/planlux_seed.db`
- **Build:** `copy:assets` kopiuje `assets/` do `dist/assets/`, więc w buildie: `dist/assets/db/planlux_seed.db`
- **Ścieżka w runtime:**  
  - Packaged: `path.join(process.resourcesPath, "app.asar.unpacked", "assets", "db", "planlux_seed.db")` lub `path.join(process.resourcesPath, "assets", "db", "planlux_seed.db")` (zależnie od konfiguracji electron-builder/extraResources).  
  - Dev: `path.join(app.getAppPath(), "assets", "db", "planlux_seed.db")` lub fallback `path.join(__dirname, "..", "assets", "db", "planlux_seed.db")`.  
  Dokładna logika w `getSeedDbPath()` w `src/infra/seedDb.ts`.

## Logi [seed-db]

- `[seed-db] validating local database`
- `[seed-db] validation failed: <reason>`
- `[seed-db] backup created: <path>`
- `[seed-db] replaced with fresh seed database`
- `[seed-db] running migrations after replacement`
- `[seed-db] local database valid`
- `[seed-db] local db missing, copied seed database`

## Scenariusze testowe

### 1. Świeża instalacja → seed copied → warianty działają

- Usuń plik bazy w userData (lub uruchom na czystym userData).
- Uruchom aplikację.
- **Oczekiwanie:** Log `[seed-db] local db missing, copied seed database`, potem `[seed-db] local database valid`. Kalkulator ma warianty, `calculatePrice` działa.

### 2. Stara pusta baza → backup + replace → warianty działają

- Zostaw `planlux-hale.db`, ale wyczyść tabele pricingu (np. usuń wiersze z `pricing_cache`, `pricing_surface`) lub usuń te tabele.
- Uruchom aplikację.
- **Oczekiwanie:** `[seed-db] validation failed: ...`, backup `planlux-hale.db.broken-*.bak`, log `[seed-db] replaced with fresh seed database`, migracje, `[seed-db] local database valid`. Warianty działają.

### 3. Uszkodzony pricing_cache → backup + replace → warianty działają

- W tabeli `pricing_cache` ustaw `cennik_json` na `'invalid'` lub `'[]'` (brak wariantów).
- Uruchom aplikację.
- **Oczekiwanie:** Jak w scenariuszu 2 – backup, replace, migracje, warianty działają.

### 4. Poprawna baza → brak replace

- Uruchom aplikację z poprawną bazą (warianty, pełny pricing).
- **Oczekiwanie:** Tylko `[seed-db] validating local database` i `[seed-db] local database valid`. Brak backupu, brak replace.

### 5. Po replace aplikacja przechodzi migracje i startuje normalnie

- Wymuś replace (np. pusty pricing jak w 2).
- **Oczekiwanie:** Po replace w logach widać migracje (np. `[migration] ...`). Aplikacja startuje, bootstrap kończy się sukcesem, sync (jeśli jest sieć) i kalkulator działają.

## Jak przetestować lokalnie

1. **Wygenerowanie seed DB**  
   `npm run build:seed -w packages/desktop`  
   Tworzy/aktualizuje `packages/desktop/assets/db/planlux_seed.db` (pełna baza: SCHEMA_SQL + dane z `default-pricing.json`).

2. **Świeża instalacja (brak bazy)**  
   - Zamknij aplikację.  
   - Usuń plik `planlux-hale.db` z userData (np. `%APPDATA%/planlux-hale` lub katalog podany przez `app.getPath("userData")`).  
   - Uruchom `npm run start` w `packages/desktop`.  
   - Sprawdź logi: `[seed-db] local db missing, copied seed database`, potem `[seed-db] local database valid`. W aplikacji: warianty w kalkulatorze, ceny się liczą.

3. **Pusta/uszkodzona baza (replace)**  
   - Otwórz bazę w userData w SQLite (np. DB Browser), wyczyść `pricing_cache` i `pricing_surface` lub ustaw `cennik_json` na `'[]'`.  
   - Uruchom aplikację.  
   - Sprawdź: w katalogu userData plik `planlux-hale.db.broken-*.bak`; w logach: `[seed-db] validation failed`, `[seed-db] backup created`, `[seed-db] replaced with fresh seed database`, `[seed-db] running migrations after replacement`, `[seed-db] local database valid`. Warianty działają.

4. **Poprawna baza (brak replace)**  
   - Upewnij się, że baza ma poprawne dane (np. po normalnym uruchomieniu).  
   - Uruchom ponownie.  
   - W logach tylko: `[seed-db] validating local database`, `[seed-db] local database valid`. Brak pliku `.bak`.

5. **Ochrona przed pętlą**  
   - Jeśli seed DB byłby uszkodzony (np. ręcznie podmieniony na pusty plik), po replace walidacja znowu by nie przeszła; przy drugiej próbie (replaceAttempted już true) aplikacja rzuca wyjątkiem i nie wchodzi w nieskończoną pętlę replace.
