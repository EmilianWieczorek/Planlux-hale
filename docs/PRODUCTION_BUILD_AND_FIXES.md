# Planlux Hale – naprawy pod działanie na innych komputerach (produkcja .exe)

## 1. ROOT CAUSE ANALYSIS

### Dlaczego u handlowców nie wczytują się warianty / standardy / dodatki

- **Pusta `pricing_cache` po pierwszym uruchomieniu**  
  Na nowym komputerze baza SQLite jest tworzona, migracje tworzą tabele `pricing_surface`, `addons_surcharges`, `standard_included` oraz `pricing_cache`. Dane do UI pochodzą z **`pricing_cache`** (odczyt przez `getCachedBase` / IPC `planlux:getPricingCache`).  
  Cache był uzupełniany dopiero po udanym `syncConfig` (Supabase). Jeśli:
  - sync się nie udał (sieć, timeout, RLS w starym projekcie),
  - lub renderer odpytywał `getPricingCache` zanim main zakończył `syncConfig`,
  to `pricing_cache` mógł zostać pusty, a UI pokazywał puste dropdowny bez jasnego komunikatu.

- **Brak gwarancji wypełnienia cache z seedu**  
  `seedBaseIfEmpty` wypełnia tylko tabele `pricing_surface`, `addons_surcharges`, `standard_included`. Nie zapisywał danych do `pricing_cache`. Fallback w `configSync` (loadBaseFromLocalTables → saveBase) działał tylko wewnątrz jednego wywołania syncu; nie było jednej, defensywnej ścieżki „jeśli cache pusty → zawsze wypełnij z lokalnych tabel lub seedu”.

- **Brak fallbacku w `planlux:getPricingCache`**  
  Gdy cache był pusty, handler mógł zwrócić `data: null` bez wcześniejszej próby uzupełnienia z lokalnych tabel ani wywołania seedu. UI dostawał null i pokazywał pusty stan bez „Ładowanie…” ani komunikatu błędu syncu.

- **Słaba diagnostyka**  
  Przy pustej bazie, błędzie Supabase lub braku szablonu PDF nie było wystarczających logów (szczególnie w production), co utrudniało diagnozę na PC handlowców.

### Dlaczego nie działał podgląd PDF

- **Ścieżki w packaged app**  
  Szablon PDF (`assets/pdf-template/Planlux-PDF/`) jest kopiowany przez `extraResources` do `resources/assets/`. `getPdfTemplateDir()` w packaged app sprawdza `path.join(resourcesPath, TEMPLATE_SUBDIR)`. Konfiguracja była poprawna; brakowało natomiast **logowania przy starcie**, czy szablon w ogóle został znaleziony – przy błędzie nie było śladu w logach.

### Co nie było przyczyną

- **RLS w Supabase** – migracje już zawierają polityki „Allow anon read” dla `base_pricing`, `pricing_surface`, `addons_surcharges`, `standard_included`. Anon może odczytywać te tabele.
- **Konfiguracja Supabase w buildzie** – `config.ts` w production używa domyślnych `defaultSupabaseUrl` i `defaultSupabaseAnonKey` przy braku zmiennych środowiskowych, więc URL i klucz są takie same na każdym PC.

---

## 2. FILES TO CHANGE (lista zmienionych plików)

| Plik | Zmiany |
|------|--------|
| `packages/desktop/electron/main.ts` | Po `syncConfig`: jeśli `pricing_cache` nadal pusta → `loadBaseFromLocalTables` → w razie braku danych ponownie `seedBaseIfEmpty` → `saveBase`. Logowanie liczby rekordów po bootstrapie. W packaged app: po starcie sprawdzenie `getPdfTemplateDir()` i log error gdy szablon brak. |
| `packages/desktop/src/services/configSync.ts` | Przy pustej odpowiedzi z `getRelationalPricing` – log (RLS/puste tabele). W catch – log z `message`, `code`, `name`. Przy braku bazy cennika – komunikat błędu po polsku. |
| `packages/desktop/electron/ipc.ts` | W handlerze `planlux:getPricingCache`: gdy cache pusta, wywołanie `seedBaseIfEmpty` i ponownie `loadBaseFromLocalTables` → `saveBase` przed zwróceniem danych. Logi przy seedzie i przy braku danych. |
| `packages/desktop/src/infra/seedBase.ts` | W catch `seedBaseIfEmpty`: logowanie błędu (dev/debug), żeby wykryć np. brak tabel lub błąd INSERT. |
| `packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx` | Stan `syncError` do przechowania błędu syncu. W `autoSync` i `syncPricing`: ustawianie `syncError`. Gdy `!pricingData`: wyświetlanie „Ładowanie bazy cennika…” przy `syncing`, w razie `syncStatus === "error"` – komunikat z `syncError`. Osobny blok dla błędu syncu przy braku danych. |

---

## 3. CODE CHANGES (skrót)

- **main.ts**  
  - Po `syncConfig`: odczyt `getCachedBase(db)`; jeśli brak lub brak `cennik.length` → `loadBaseFromLocalTables`; jeśli dalej pusto → `seedBaseIfEmpty` i ponownie load → `saveBase` z logowaniem.  
  - W packaged app: po bootstrapie wywołanie `getPdfTemplateDir()`; jeśli `null` – `logger.error` z `resourcesPath` i listą kandydatów.

- **configSync.ts**  
  - Gdy `getRelationalPricing` zwróci puste – log z `hasRel`, `cennikLength`.  
  - W catch – log z `message`, `code`, `name`.  
  - Tekst błędu przy „No pricing base available” po polsku (Brak bazy cennika + wskazówka o synchronizacji/support).

- **ipc.ts (getPricingCache)**  
  - Jeśli `!base || !base.cennik?.length`: `loadBaseFromLocalTables`; jeśli wynik pusty – `seedBaseIfEmpty` i ponownie load; jeśli mamy dane – `saveBase` i ustawienie `base`.  
  - Logi: po uruchomieniu seedu oraz gdy ostatecznie brak danych.

- **seedBase.ts**  
  - W bloku catch: `console.warn` z treścią błędu (w dev lub przy `LOG_LEVEL=debug`).

- **Kalkulator.tsx**  
  - `syncError` state; ustawianie w `autoSync` i `syncPricing` przy `status === "error"` lub catch.  
  - Gdy `!pricingData`: tekst zależny od `syncing` / `syncStatus === "error"` / domyślny.  
  - Sekcja „syncStatus === "error" && !pricingData” z komunikatem z `syncError`.

---

## 4. SUPABASE SQL / POLICIES

Obecne migracje już udostępniają odczyt anon dla tabel konfiguracyjnych:

- `supabase/migrations/20260227000000_base_pricing_anon_read.sql` – SELECT dla `anon` na `base_pricing`
- `supabase/migrations/20260306000000_relational_pricing_tables.sql` – polityki „Allow anon read” dla `pricing_surface`, `addons_surcharges`, `standard_included`

**Nie trzeba nic dodatkowo wklejać w Supabase** – pod warunkiem że te migracje są zastosowane w projekcie.  
Jeśli w innym projekcie Supabase nie ma tych migracji, można uruchomić w SQL Editorze:

```sql
-- Odczyt anon dla tabel konfiguracyjnych (desktop ładuje cennik przed logowaniem)
-- pricing_surface
DROP POLICY IF EXISTS "Allow anon read pricing_surface" ON public.pricing_surface;
CREATE POLICY "Allow anon read pricing_surface" ON public.pricing_surface FOR SELECT TO anon USING (true);

-- addons_surcharges
DROP POLICY IF EXISTS "Allow anon read addons_surcharges" ON public.addons_surcharges;
CREATE POLICY "Allow anon read addons_surcharges" ON public.addons_surcharges FOR SELECT TO anon USING (true);

-- standard_included
DROP POLICY IF EXISTS "Allow anon read standard_included" ON public.standard_included;
CREATE POLICY "Allow anon read standard_included" ON public.standard_included FOR SELECT TO anon USING (true);

-- base_pricing (opcjonalnie, jeśli aplikacja jeszcze z niego korzysta)
DROP POLICY IF EXISTS "Allow anon read base_pricing" ON public.base_pricing;
CREATE POLICY "Allow anon read base_pricing" ON public.base_pricing FOR SELECT TO anon USING (true);
```

---

## 5. BUILD / PACKAGING

- **extraResources** w `packages/desktop/electron-builder.yml` jest ustawione poprawnie: `from: assets`, `to: assets`, więc katalog `assets/pdf-template/Planlux-PDF/` trafia do `resources/assets/pdf-template/Planlux-PDF/` w buildzie.
- Nie zmieniano konfiguracji electron-builder w tej paczce poprawek.

---

## 6. TEST PLAN

Po zbudowaniu i instalacji **na innym komputerze** (czysta instalacja):

1. **Pierwsze uruchomienie**  
   - Uruchom aplikację.  
   - Oczekiwane: warianty hal, standardy i dodatki pojawiają się (z seedu lub z Supabase).  
   - W razie braku internetu: nadal warianty/standardy/dodatki z seedu.  
   - Sprawdź logi w `%AppData%/Planlux Hale/logs/app.log` (lub odpowiednik userData): wpisy `[bootstrap]`, `[configSync]`, ewentualnie `[getPricingCache]`, `[pdf]`.

2. **UI**  
   - Przy ładowaniu: komunikat w stylu „Ładowanie bazy cennika…”.  
   - Gdy sync się nie uda i nie ma danych: czytelny błąd (np. z `syncError`) zamiast pustych pól.  
   - Po udanym syncu lub użyciu cache/seedu: dropdowny wypełnione, możliwość wyboru wariantu i wygenerowania oferty.

3. **PDF**  
   - Wygeneruj ofertę z podglądem PDF.  
   - Oczekiwane: podgląd PDF się otwiera.  
   - W logach: brak `[pdf] TEMPLATE_MISSING`; w razie problemu – wpis z listą kandydatów ścieżek.

4. **Synchronizacja**  
   - Z internetem: klik „Synchronizuj bazę” – komunikat o aktualizacji/aktualności/offline.  
   - Bez internetu: komunikat offline, aplikacja działa na lokalnej bazie (cache/seed).

---

## 7. FINAL BUILD COMMAND

Z katalogu **głównego repozytorium** (root):

```bash
npm run dist:win
```

Wymagane wcześniej:

- `npm install` (w root)
- Opcjonalnie: `npm run build` (zbuduje wszystkie workspace’y)

Po zakończeniu buildu:

- **Instalator Windows (NSIS):**  
  `packages/desktop/release/Planlux Hale Setup 1.0.14.exe`  
  (wersja z `package.json` / `packages/desktop/package.json`).

- **Katalog unpacked (do testów):**  
  `packages/desktop/release/win-unpacked/`  
  – uruchamiany plik: `Planlux Hale.exe`.

Weryfikacja na czystym PC: zainstaluj z `Planlux Hale Setup 1.0.14.exe`, uruchom, sprawdź punkty z sekcji „Test plan” i w razie problemów prześlij fragment logów z `userData/logs/app.log`.
