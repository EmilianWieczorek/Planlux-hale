# Planlux Hale — Raport końcowy audytu (7 sekcji)

**Data:** 2025-03-09  
**Zakres:** Pełna diagnostyka aplikacji z naciskiem na PDF, auth, Supabase, SQLite, e-mail, build oraz lista zmian.

---

## 1. PDF — wszystkie wykryte problemy

### Co było nie tak

- **Diagnostyka w produkcji:** W trybie produkcyjnym (po buildzie) logowano tylko `[pdf] saved path` bez rozmiaru pliku oraz bez jednoznacznego potwierdzenia, który katalog szablonu został użyty. W razie błędu „szablon nie znaleziony” trudno było zweryfikować, która ścieżka z listy kandydatów jest używana w danym środowisku.
- **Ryzyko TEMPLATE_MISSING po buildzie:** Szablon jest szukany w kolejności: `app.getAppPath() + TEMPLATE_SUBDIR`, `resourcesPath/app.asar/...`, `resourcesPath + TEMPLATE_SUBDIR`, `cwd`, `__dirname`. W packaged app `extraResources` kopiuje `assets` do `resourcesPath/assets`, więc poprawna jest ścieżka `resourcesPath/assets/pdf-template/Planlux-PDF`. Jeśli `app.getAppPath()` w danym buildzie zwróciłby katalog bez `assets`, pierwszy kandydat mógłby nie znaleźć `index.html` — kolejni są próbowani, więc ryzyko jest ograniczone, ale bez logu „który kandydat zadziałał” diagnostyka była słaba.
- **Brak jawnego logu rozmiaru PDF:** Po zapisie pliku w produkcji nie było w logu rozmiaru (sizeBytes); utrudnia to odróżnienie „plik zapisany pusty” od „plik zapisany poprawnie”.
- **insertPdfFailed przy braku draftId:** Gdy generowanie PDF się nie uda (timeout, błąd szablonu, printToPDF), `insertPdfFailed` zapisuje wpis `PDF_FAILED` tylko gdy w payloadzie jest `draftId` i istnieje wiersz w `offers_crm` o tym `id`. Przy generowaniu „bez zapisanej oferty” (np. sam podgląd lub flow bez wcześniejszego zapisu draftu) nie ma `offerId` → wpis do `pdfs` z statusem PDF_FAILED nie powstaje. To zamierzone (brak FK), ale warto mieć na uwadze przy analizie historii błędów.
- **PERSISTENCE_FAILED:** Po poprawnym wygenerowaniu pliku PDF, przy błędzie zapisu do `offers_crm` lub `insertPdf`, użytkownik dostaje `ok: true` z `stage: "PERSISTENCE_FAILED"` i ścieżką do pliku — plik PDF istnieje, ale nie ma wpisu w CRM/historii. To akceptowalne (plik można użyć), ale UI powinno ewentualnie informować o niepełnej synchronizacji.

### Co poprawiłem

- **Stałe logowanie rozwiązanego katalogu szablonu:** W `generatePdfFromTemplate.ts` po sprawdzeniu `templateDir !== null` dodane jest zawsze:  
  `logger.info("[pdf] templateDir resolved", path.resolve(templateDir));`  
  Dzięki temu w każdym uruchomieniu (dev i prod) w logach widać faktycznie użyty katalog.
- **Logowanie rozmiaru zapisanego PDF:** Po `fs.writeFileSync(filePath, printResult.buffer)` i `fs.statSync(filePath)` w logu (dev i prod) zapisywane są:  
  `[pdf] final PDF` / `[pdf] saved path` z polem `sizeBytes: stat.size`.  
  Ułatwia to weryfikację, że plik nie jest pusty i że zapis się powiódł.

### Jakie ryzyka jeszcze zostały

- **Timeout 20 s (printToPDF):** Przy bardzo złożonym HTML lub wolnej maszynie możliwy timeout; użytkownik dostanie komunikat o przekroczeniu czasu. W razie powtarzających się problemów można rozważyć zwiększenie `PDF_TIMEOUT_MS` lub uproszczenie szablonu.
- **Hero/background w drugiej stronie:** Szablon i diagnostyka renderera (`.hero` backgroundImage, `.hero__bg`) są logowane; jeśli w drugiej stronie PDF layout lub tło są inne, trzeba to weryfikować ręcznie (np. test: oferta z wieloma dodatkami → kilka stron).
- **Ścieżki w app.asar:** Szablon nie jest w asarze (jest w `extraResources`), więc `path.join(resourcesPath, TEMPLATE_SUBDIR)` jest poprawny. Ryzyko: gdyby w przyszłości przeniesiono assets do asar bez unpack, ścieżki musiałyby być zweryfikowane.
- **Polskie znaki / znaki specjalne:** Mapowanie danych do HTML używa `escapeHtml` z shared; w razie problemów z kodowaniem w PDF warto sprawdzić, czy plik HTML jest zapisywany w UTF-8 (obecnie `fs.writeFileSync(..., "utf-8")`).
- **Test manualny po buildzie:** Zalecany test: zbudować instalator (`npm run dist` w repo), zainstalować, uruchomić, wygenerować pełną ofertę PDF i sprawdzić w logach (userData/logs) wpisy `[pdf] templateDir resolved` oraz `[pdf] saved path` z `sizeBytes` oraz czy plik w katalogu PDF ma rozmiar > 0 i poprawnie się otwiera.

---

## 2. Auth / role / panel admina

### Co było nie tak

- **W poprzednich sesjach:** Naprawiano błędy 401 przy Edge Function `create-user` (verify_jwt, nagłówki, mapowanie ról z JWT). Obecna analiza nie wykazała nowych błędów w samym flow logowania.
- **Fallback roli:** W kilku miejscach (np. odczyt `profiles.role`) przy braku profilu lub błędzie zapytania aplikacja może nie mieć roli; wtedy middleware `requireRole` może odrzucić żądanie lub zwrócić domyślną rolę — zależnie od implementacji. Warto mieć spójną politykę: np. „brak profilu → HANDLOWIEC” tylko tam, gdzie jest to jawnie obsłużone.
- **Sync SQLite ↔ Supabase (użytkownicy):** `planlux:syncUsers` i powiązane wywołania synchronizują użytkowników z backendu do lokalnej tabeli `users`. Jeśli RLS na `profiles` blokuje odczyt, sync może nie dodać użytkowników — wtedy panel admina pokaże niepełną listę.

### Co poprawiłem

- W tej sesji **nie wprowadzono zmian** w auth/role/panel admina (brak zidentyfikowanych nowych błędów wymagających natychmiastowej poprawki).

### Jakie ryzyka zostały

- **Offline login:** Logowanie offline (lokalne hasło) zależy od poprawnego zapisu/weryfikacji hash w SQLite i od tego, czy rola jest wcześniej zsynchronizowana. W pełnym offline pierwsze logowanie musi mieć wcześniej zsynchronizowanego użytkownika.
- **create-user (Edge Function):** Jeśli `verify_jwt` jest włączone, przekazywanie tokena i nagłówka `Authorization` musi być poprawne; w przeciwnym razie 401. Wcześniejsze poprawki to adresowały; ryzyko: zmiana konfiguracji Supabase (np. wyłączenie funkcji) może złamać dodawanie użytkownika.
- **Miejsca zwracające domyślną rolę:** Wszystkie miejsca, gdzie w razie błędu zwracana jest domyślna rola (np. HANDLOWIEC), powinny być udokumentowane i przetestowane (np. brak profilu po pierwszym logowaniu).

---

## 3. Supabase / RLS / Edge Functions

### Co było nie tak

- **sync_log / heartbeat:** W `apiAdapter` przy błędzie insertu do `sync_log` (np. RLS) logowane jest tylko `console.warn` (przy LOG_LEVEL=debug) i zwracane `ok: true`. Aplikacja nie traktuje tego jako błąd krytyczny, ale wpisy heartbeat mogą nie być zapisywane — utrudnia to audyt „ostatniej aktywności” po stronie Supabase.
- **pdf_history / logPdf:** Przy błędzie (offline lub RLS) `logPdf` nie rzuca — błąd jest łapany w IPC i wpis LOG_PDF trafia do outbox. To poprawne zachowanie; ryzyko: jeśli RLS na `pdf_history` blokuje insert, outbox będzie rosła i trzeba będzie obsłużyć retry.
- **base_pricing:** Odczyt cennika z `base_pricing`; jeśli RLS nie pozwala na odczyt anon/service, sync cennika się nie uda. Obecny raport nie zmienia tej logiki — wymaga konfiguracji RLS w Supabase.
- **create-user (Edge Function):** Jak wyżej — wcześniejsze poprawki (verify_jwt, błędy, nagłówki) są wdrożone; brak nowych zmian w tej sesji.

### Co poprawiłem

- W tej sesji **nie wprowadzono zmian** w Supabase/RLS/Edge Functions.

### Jakie ryzyka zostały

- **RLS na wszystkich tabelach używanych przez aplikację:** profiles, base_pricing, pdf_history, email_history, sync_log, offers — brak polityki lub zbyt restrykcyjna polityka może powodować ciche błędy (np. pusta lista wariantów, brak sync użytkowników, brak zapisu pdf_history). Rekomendacja: przegląd polityk RLS dla każdej tabeli i test z anon/authenticated kluczem.
- **Edge Functions:** create-user, send_offer_email i inne — dostęp, timeouty i format payloadu powinny być udokumentowane i testowane (np. test ręczny z tokenem handlowca/admin).

---

## 4. SQLite / migracje / lokalna baza

### Co było nie tak

- **Wstępny schemat pdfs w main.ts:** W `main.ts` tabela `pdfs` jest tworzona z `offer_id TEXT REFERENCES offers(id)`. Migracja w `crmMigrations.ts` (krok 16) przebudowuje `pdfs` tak, że `offer_id REFERENCES offers_crm(id)` i kopiuje tylko wiersze, gdzie `offer_id IN (SELECT id FROM offers_crm)`. Po migracji aplikacja konsekwentnie używa `offers_crm.id` jako `offerId` przy `insertPdf` — więc **brak niespójności** w obecnym kodzie.
- **Kolejność migracji:** CRM migrations (offers_crm, email_history, outbox, pdfs FK, client_address, itd.) są wywoływane z main po users_roles_3/4, pdfs, offer_counters, config_sync_meta, password_auth_v1. Kolejność jest istotna (np. pdfs FK do offers_crm wymaga istnienia offers_crm). Obecna kolejność jest poprawna.
- **Idempotentność ALTER TABLE:** Większość migracji używa `IF NOT EXISTS` lub sprawdza obecność kolumny/tabeli przed dodaniem; ryzyko podwójnego uruchomienia jest ograniczone. Wyjątki typu „ALTER TABLE ... ADD COLUMN” przy ponownym uruchomieniu zwrócą błąd — są owrapowane w try/catch i logowane jako „skipped”.

### Co poprawiłem

- W tej sesji **nie wprowadzono zmian** w migracjach ani schemacie SQLite.

### Jakie ryzyka zostały

- **email_history unified:** Skomplikowany krok (unified) w crmMigrations — przebudowa tabeli i wiele kolumn; przy bardzo starych bazach warto przetestować migrację na kopii.
- **FORCE_RESET_DB:** Usunięcie pliku bazy przy starcie (dev) — dokumentować, że to tylko do dev; w produkcji nie ustawiać tej zmiennej.
- **Foreign keys:** PRAGMA foreign_keys = ON jest ustawiane po migracjach; podczas migracji (np. przebudowa pdfs) foreign_keys bywają wyłączane — kod robi to poprawnie (PRAGMA foreign_keys = OFF ... finally ON).

---

## 5. E-mail / SMTP / outbox

### Co było nie tak

- **Outbox CHECK:** W crmMigrations i shared schema typy operacji (SEND_EMAIL, SEND_GENERIC_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT, OFFER_SYNC) są spójne z użyciem w kodzie (ipc, outboxStorage). Nie znaleziono rozjazdu w tej sesji.
- **email_history: to_email vs to_addr:** Migracja 0001 dodaje `to_email` i backfill z `to_addr`; w ipc i emailService są sprawdzenia kolumn (hasToEmail, hasRelatedOfferId itd.) i różne warianty INSERT w zależności od schematu. Ryzyko: przy bardzo starych bazach bez migracji 0001 mogą być tylko `to_addr` — kod to obsługuje warunkowo.
- **Załącznik PDF:** Wysyłka e-mail z załącznikiem PDF odczytuje plik z `pdfs.file_path`; jeśli ścieżka jest względna lub plik został usunięty, wysyłka może się nie udać. Warto upewnić się, że `file_path` jest bezwzględna lub poprawnie rozwiązywana względem userData.

### Co poprawiłem

- W tej sesji **nie wprowadzono zmian** w e-mail/SMTP/outbox.

### Jakie ryzyka zostały

- **SMTP błędy:** Błędy SMTP (auth, connection) są zwracane do UI; retry w outbox ma max_retries — po wyczerpaniu wpis pozostaje z statusem failed. Warto w UI pokazywać ostatni błąd i opcję „ponów”.
- **Logowanie e-mail do Supabase (LOG_EMAIL):** Analogicznie do LOG_PDF — przy RLS blokującym insert, outbox będzie miała nieprzetworzone wpisy; trzeba okresowo sprawdzać outbox i logi.

---

## 6. Build / release / desktop packaging

### Co było nie tak

- **W poprzednich sesjach:** Korygowano problemy z NSIS (allowElevation: false; useZip powodujący błąd rozpakowania — useZip usunięty przy wersji 1.0.11). Obecna konfiguracja electron-builder (packages/desktop/package.json) ma `extraResources: [{ from: "assets", to: "assets" }]`, co kopiuje cały katalog `assets` (w tym `assets/pdf-template/Planlux-PDF`) do katalogu zasobów aplikacji — **to jest poprawne** dla szablonu PDF.
- **Ścieżki po buildzie:** Renderer ładuje się z `loadFile` (produkcja) lub `loadURL` (dev). Szablon PDF jest w resourcesPath/assets/... i jest rozwiązywany przez `getPdfTemplateDir()`; nie zależy od ścieżki renderera. Ikony aplikacji: `win.icon: assets/icon.ico` — względem package.json desktop, poprawne.

### Co poprawiłem

- W tej sesji **nie wprowadzono zmian** w konfiguracji build/release (brak nowych błędów do naprawy).

### Jakie ryzyka zostały

- **Weryfikacja po każdym dużym bumpie Electron/electron-builder:** Zachowanie `app.getAppPath()` i `process.resourcesPath` może się różnić między wersjami; po aktualizacji warto przetestować generowanie PDF w packaged build.
- **Instalator NSIS:** allowElevation: false i brak useZip są ustawione; na innych systemach (np. inne wersje Windows) w razie problemów z instalacją sprawdzić logi instalatora.

---

## 7. Lista zmian

### Dokładnie które pliki zmieniłem

| Plik | Zmiana |
|------|--------|
| `packages/desktop/electron/pdf/generatePdfFromTemplate.ts` | 1) Po sprawdzeniu `templateDir !== null` dodane: `logger.info("[pdf] templateDir resolved", path.resolve(templateDir));` 2) W bloku po zapisie PDF: log `[pdf] final PDF` / `[pdf] saved path` rozszerzony o `sizeBytes: stat.size` (dev i prod). |

### Diff najważniejszych zmian

**generatePdfFromTemplate.ts**

- Po bloku `if (!templateDir) { ... return ... }` dodana jedna linia:
  - `logger.info("[pdf] templateDir resolved", path.resolve(templateDir));`
- W miejscu:
  - `if (isDev()) { logger.info("[pdf] final PDF", { filePath, fileName }); } else { logger.info("[pdf] saved path", filePath); }`
- Zastąpione przez:
  - `if (isDev()) { logger.info("[pdf] final PDF", { filePath, fileName, sizeBytes: stat.size }); } else { logger.info("[pdf] saved path", { filePath, sizeBytes: stat.size }); }`

### Co jeszcze rekomenduję zrobić później

1. **Testy ręczne PDF po buildzie:** Zbudować instalator, zainstalować, wygenerować ofertę PDF i sprawdzić logi (userData/logs): `[pdf] templateDir resolved`, `[pdf] saved path` z `sizeBytes`, oraz czy plik PDF jest kompletny (strony, tła, logo, polskie znaki).
2. **Przegląd RLS Supabase:** Dla tabel: profiles, base_pricing, pdf_history, email_history, sync_log — zweryfikować polityki i przetestować z rolami HANDLOWIEC / SZEF / ADMIN.
3. **Outbox UI:** W razie potrzeby dodać w panelu podgląd nieprzetworzonych wpisów outbox (LOG_PDF, LOG_EMAIL, SEND_EMAIL) z ostatnim błędem i opcją „ponów”.
4. **Stała lista kanałów IPC:** Rozważyć współdzieloną listę kanałów (np. w shared) z preload i ipc.ts, żeby nowe handlery nie były pomijane w ALLOWED_CHANNELS.
5. **Dokumentacja flow PDF:** Krótki doc (np. w docs/) z opisem: skąd UI wywołuje generowanie, jakie dane trafiają do IPC, kolejność (templateDir → render → copy assets → loadFile → printToPDF → zapis → offers_crm + pdfs + logPdf/outbox) — ułatwi to przyszły debugging i onboardowanie.

---

**Koniec raportu.**

Podsumowanie: W tej sesji wprowadzono **wyłącznie ulepszenia diagnostyki PDF** (log rozwiązanego katalogu szablonu oraz rozmiaru zapisanego pliku). Nie wykonano destrukcyjnego refaktoru; pozostałe obszary (auth, Supabase, SQLite, e-mail, build) zostały zweryfikowane pod kątem ryzyk i ewentualnych dalszych kroków — zaktualizowano raport w 7 sekcjach zgodnie z życzeniem.
