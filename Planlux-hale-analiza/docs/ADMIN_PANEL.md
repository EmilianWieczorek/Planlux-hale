# Panel admina – Planlux Hale

## Zakres funkcji (minimalny)

1. **Użytkownicy**  
   - Lista użytkowników (email, rola, data utworzenia).  
   - Tworzenie użytkownika (email, hasło tymczasowe, rola USER/ADMIN).  
   - Reset hasła do aplikacji (generowanie linku/OTP – minimalny flow).

2. **Aktywność**  
   - Kto jest online (ostatni heartbeat < 3 min).  
   - Czas spędzony w aplikacji (suma heartbeatów lub różnica first/last w sesji).  
   - Urządzenie: telefon vs komputer.  
   - Wersja aplikacji.

3. **Historia globalna**  
   - PDF: wszystkie oferty (filtr: użytkownik, klient, data, wariant).  
   - E-mail: wszystkie wysyłki (filtr: użytkownik, status, data).

## Skąd dane

- **Lokalnie (SQLite):**  
  Admin w tej samej aplikacji może czytać wszystkie tabele (`users`, `pdfs`, `emails`, `activity`) – z zapytaniami filtrowanymi po `user_id` tylko gdy rola = USER; dla ADMIN bez filtra.

- **Z backendu (Sheets):**  
  Jeśli historia i aktywność są appendowane do Google Sheets, panel admina może pobierać agregaty przez API:  
  - `GET ?action=historyPdf&token={adminToken}`  
  - `GET ?action=historyEmail&token={adminToken}`  
  - `GET ?action=activity&token={adminToken}`  

  Backend zwraca dane z arkuszy HISTORIA_PDF, HISTORIA_EMAIL, ACTIVITY (tylko dla zalogowanego ADMIN, weryfikacja tokenu).

## Przepływ w aplikacji

1. Logowanie: wybór konta; jeśli rola = ADMIN, menu zawiera „Panel admina”.  
2. Route `/admin`:  
   - Zakładki: Użytkownicy | Aktywność | Historia PDF | Historia e-mail.  
   - Użytkownicy: tabela + przycisk „Dodaj użytkownika”; przycisk „Reset hasła” (otwiera flow OTP/link).  
   - Aktywność: tabela (user, ostatni heartbeat, device, wersja, szacowany czas).  
   - Historia: tabele z filtrami (data od–do, użytkownik, klient, status).  
3. Dane: przy starcie ekranu – wywołanie API (jeśli online) lub odczyt z lokalnego SQLite (cache ostatnich danych). Preferowane: jeden źródłowy backend (Sheets), aplikacja synchronizuje i czyta lokalnie lub bezpośrednio API.

## Bezpieczeństwo

- Tylko użytkownik z rolą ADMIN widzi panel i endpointy historii/aktywności.  
- Token admina (jeśli używany w API) przechowywany lokalnie, nie w Sheets.  
- Reset hasła: token jednorazowy (wysłany mailem) lub OTP; po użyciu unieważnienie.
