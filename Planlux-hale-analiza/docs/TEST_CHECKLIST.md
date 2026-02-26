# Checklist testów – Planlux Hale

## Szybki test manualny

1. `npm run build` → `npm run desktop`
2. Login: admin@planlux.pl / admin123
3. **Online:** Kalkulator → Synchronizuj bazę → wprowadź wymiary (np. 12×20 m) → Generuj PDF → sprawdź Documents/PlanluxOferty
4. **Offline:** wyłącz internet → Kalkulator działa (jeśli baza była zsynchronizowana); banner OFFLINE
5. Historia → zakładki PDF / E-mail
6. Panel admina (gdy zalogowany jako admin)

## Offline / Online

- [ ] Aplikacja startuje bez internetu; wyświetla ostatni zapisany cennik (lub komunikat „Brak bazy – połącz się z internetem”).
- [ ] Wycena działa w 100% offline (wariant, wymiary, dodatki, standard w cenie).
- [ ] Generowanie PDF działa offline; plik zapisuje się lokalnie; wpis w historii PDF.
- [ ] Wysyłka e-mail offline: trafia do kolejki „Do wysłania”; status DO_WYSŁANIA.
- [ ] Po odzyskaniu internetu: sync bazy (META.version) pobiera nową wersję i nadpisuje cache.
- [ ] Po odzyskaniu internetu: kolejka outbox jest wysyłana (LOG_PDF, LOG_EMAIL, SEND_EMAIL, HEARTBEAT); statusy aktualizowane.

## Synchronizacja

- [ ] GET meta zwraca version; przy version > lokalna wykonywany jest GET base i zapis do pricing_cache.
- [ ] Flush outbox w kolejności (np. HEARTBEAT → LOG_PDF → SEND_EMAIL → LOG_EMAIL); retry przy błędzie z backoff.
- [ ] Idempotency: ponowne wysłanie tego samego LOG_PDF / LOG_EMAIL (ten sam id) nie duplikuje wpisów w Sheets (backend lub klient ignoruje duplikat).
- [ ] Przerwanie internetu w trakcie flush: pozostałe operacje pozostają w outbox i są wysyłane przy następnym połączeniu.

## Wycena (pricingEngine)

- [ ] Dopasowanie cennika: wariant + area w [area_min_m2, area_max_m2] (bez max_width).
- [ ] Brak dopasowania: komunikat „Brak ceny – brak wariantu w cenniku” gdy zero wierszy dla wariantu.
- [ ] Fallback powyżej max: stawka z najwyższego progu; poniżej min: z najniższego; komunikat w UI.
- [ ] Dodatki: m2 / mb / szt; warunki HEIGHT_RANGE / RANGE (wysokość w [min, max]) poprawnie włączają dopłatę.
- [ ] Standard w cenie: dla wariantu wyświetlane w podsumowaniu i w PDF (element + wartość referencyjna).
- [ ] Wartości liczbowe z bazy jako string (np. „4 000”) są poprawnie parsowane do liczby.

## PDF

- [ ] Generowanie offline z szablonu „Oferta Planlux Hale”; czytelna nazwa pliku i folder.
- [ ] Po wygenerowaniu: wpis w tabeli pdfs (user, klient, wariant, w/l/h/area, ceny, ścieżka, status PDF_CREATED).
- [ ] Operacja LOG_PDF w outbox; po udanym flush status → LOGGED, logged_at ustawione.

### PDF – pipeline i szablon (manual)

1. [ ] Generowanie PDF z kalkulatora działa w **DEV** (`npm run dev:desktop`).
2. [ ] Generowanie PDF działa po **buildzie** (`npm run build` → `npm run desktop`).
3. [ ] PDF zapisuje się do właściwego folderu (Documents/Planlux Hale/output lub userData/output).
4. [ ] Historia PDF zapisuje rekord (status PDF_CREATED, file_path, file_name).
5. [ ] Brak template/index.html → czytelny błąd (np. „Szablon Planlux-PDF nie został znaleziony…”).
6. [ ] Polskie znaki w PDF renderują się poprawnie (np. ą, ę, ó, ł).
7. [ ] Wielostronicowy template (2–3 strony) nie ucina zawartości; `page-break-after` działa.

## E-mail

- [ ] Online + dane SMTP w sejfie: wysyłka od razu; załącznik PDF; log do Sheets (LOG_EMAIL) lub outbox.
- [ ] Offline lub brak SMTP: zapis do outbox (SEND_EMAIL + LOG_EMAIL); status DO_WYSŁANIA.
- [ ] Hasła SMTP tylko w systemowym magazynie (Windows Credential Vault / Keychain / Keystore); nigdy w Sheets/backend.
- [ ] Po wysłaniu z kolejki: status SENT lub FAILED z error_message; LOG_EMAIL z odpowiednim statusem.

## Admin

- [ ] Tylko rola ADMIN widzi panel (użytkownicy, aktywność, historia).
- [ ] Lista użytkowników; tworzenie użytkownika; reset hasła (minimalny flow).
- [ ] Aktywność: kto online, czas w aplikacji, urządzenie (telefon/komputer), wersja.
- [ ] Historia PDF i e-mail: filtry (użytkownik, klient, data, status); dane z API lub lokalnego SQLite.

## Ogólne

- [ ] USER widzi tylko swoje historie (PDF, e-mail).
- [ ] Heartbeat co 60–120 s gdy online; offline zapis lokalnie, wysłanie przy flush.
- [ ] Aplikacja instalowana (Electron desktop; React Native mobile), nie w przeglądarce.
