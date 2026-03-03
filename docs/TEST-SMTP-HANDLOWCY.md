# Test manualny: SMTP per handlowiec (CyberFolks)

## Wymagania
- Aplikacja Planlux Hale (desktop) z panelem admina.
- Dwa konta handlowców (np. Damian, Mateusz) z rolą Handlowiec.
- Dane do poczty CyberFolks (host `poczta.cyberfolks.pl`, port 465, SSL/TLS, pełny e-mail i hasło).

## Kroki

1. **Zaloguj się jako admin** (lub użytkownik z dostępem do panelu Admin → E-mail).

2. **Zakładka „SMTP per handlowiec”**
   - Powinna pokazać listę handlowców (Damian, Mateusz).
   - Dla każdego: przycisk konfiguracji (ołówek), opcjonalnie test połączenia.

3. **Konfiguracja pierwszego handlowca (np. Damian)**
   - Kliknij „Konfiguruj SMTP” przy Damianie.
   - Sprawdź domyślne wartości: **Host** `poczta.cyberfolks.pl`, **Port** `465`, **Secure (SSL/TLS)** zaznaczone.
   - Uzupełnij: nazwa nadawcy, **Login** (pełny e-mail), **Hasło**.
   - Opcjonalnie: wpisz `smtp.cyberfolks.pl` w Host – powinien pojawić się komunikat: „Dla CyberFolks użyj poczta.cyberfolks.pl” (bez blokady zapisu).
   - **Zapisz** → komunikat „SMTP zapisane”.
   - **Test połączenia** → „Połączenie OK”. W razie błędu: komunikat z „Identyfikator debug: …” (bez hasła w logach).

4. **Konfiguracja drugiego handlowca (np. Mateusz)**
   - Analogicznie skonfiguruj drugie konto (inne dane logowania).
   - Zapisz, wykonaj test.

5. **Wysłanie maila z oferty**
   - Zaloguj się jako handlowiec (np. Damian).
   - Otwórz ofertę, wyślij e-mail (z załącznikiem PDF).
   - Sprawdź, że wiadomość wychodzi z konta Damiana i trafia do odbiorcy.
   - Powtórz dla Mateusza – wiadomość powinna iść z jego konta.

6. **Diagnostyka błędów**
   - Przy błędzie logowania: komunikat typu „Błąd logowania SMTP: sprawdź login/hasło oraz czy konto pocztowe istnieje na serwerze” + Identyfikator debug.
   - W logach main process: tylko host, port, secure, user_id, auth_user, from_email, error/response – **nigdy hasło**.

## Lista zmian (SMTP per handlowiec – CyberFolks)

- **Renderer (AdminEmailTab.tsx)**  
  Domyślne: host `poczta.cyberfolks.pl`, port 465, secure true. Walidacja hosta (smtp.cyberfolks.pl → ostrzeżenie). Wysyłanie `secure` jako 0/1. Port pusty → 465. Test z opcjonalnym `smtpPass`. Lepsze komunikaty błędów i wyświetlanie debugId w snackbar. Helper: „Dla CyberFolks: host poczta.cyberfolks.pl, port 465, SSL/TLS”.

- **Main/IPC (ipc.ts)**  
  `listAccounts`: normalizacja `secure` do 0/1. `upsertForUser`: akceptacja `secure` boolean lub 0/1, port domyślnie 465. `testForUser`: mapowanie błędów (EAUTH → błąd logowania, ESOCKET/ETIMEDOUT → brak połączenia, TLS → problem TLS), zwrot debugId, logi bez hasła. Ostrzeżenie w logach przy `smtp.cyberfolks.pl`. `getForCurrentUser`: zwrot `secure` 0/1.

- **emailService.ts**  
  `secureToBool()` dla kompatybilności z legacy 0/1/boolean/string. Timeouty: connectionTimeout 10s, greetingTimeout 10s, socketTimeout 15s. Logi bez hasła (tylko host, port, secure, auth_user, from_email, keytarAccountKeyUsed).

- **Kompatybilność**  
  Stare rekordy z `secure` jako boolean lub NULL traktowane jako 0/1 przy odczycie. Hasło: zapisywane do keytar/AES przy podaniu; przy braku `smtpPass` istniejące hasło nie jest nadpisywane.
