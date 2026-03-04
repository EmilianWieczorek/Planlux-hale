# Test: logowanie offline-first i synchronizacja użytkowników (Apps Script)

## Backend (Apps Script)

URL: `https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec`

Wymagane endpointy (POST, JSON):

- **login**  
  `{ action: "login", email, password }`  
  → `{ ok: true, user: { email, role, name } }` lub `{ ok: false, error }`

- **listUsers**  
  `{ action: "listUsers" }`  
  → `{ ok: true, users: [{ email, role, name, active }] }`

- **upsertUser** (tworzenie/edycja użytkownika z panelu admina)  
  `{ action: "upsertUser", email, name?, role?, tempPassword?, active? }`  
  → `{ ok: true }` lub `{ ok: false, error }`

Role w backendzie: `HANDLOWIEC`, `SZEF`, `ADMIN`.

---

## Kroki testu na nowej maszynie (świeża instalacja)

### 1) Fresh install – logowanie online

1. Zainstaluj aplikację na komputerze bez wcześniejszej bazy (lub usuń `userData/planlux-hale.db`).
2. Uruchom aplikację – pojawi się ekran logowania.
3. Po ok. 0,5 s w tle uruchomi się synchronizacja użytkowników (POST listUsers).
4. Zaloguj się danymi użytkownika z arkusza USERS (np. handlowiec@planlux.pl).
5. **Oczekiwanie:** logowanie przechodzi (backend login), użytkownik jest zapisany lokalnie z hasłem (hash), widać główny widok z rolą (HANDLOWIEC / SZEF / ADMIN).

### 2) Po jednym udanym logowaniu – tryb offline

1. Po pomyślnym logowaniu online wyloguj się.
2. Wyłącz internet (lub zablokuj dostęp do domeny Apps Script).
3. Zaloguj się ponownie tym samym emailem i hasłem.
4. **Oczekiwanie:** logowanie przechodzi na podstawie lokalnej bazy (weryfikacja hasła z cache).
5. Jeśli użytkownik nigdy nie logował się online na tej maszynie i pojawia się w listUsers: przy pierwszej próbie offline komunikat typu „Zaloguj się przy połączeniu z internetem, aby włączyć logowanie offline”.

### 3) Role – panel admina

1. Zaloguj jako **HANDLOWIEC**.
2. **Oczekiwanie:** brak przycisku „Panel admina” w nawigacji; brak dostępu do zarządzania użytkownikami.
3. Zaloguj jako **SZEF**.
4. **Oczekiwanie:** widać „Panel admina” (podgląd, aktywność, historia), ale **nie** ma przycisku „Dodaj użytkownika” (tylko ADMIN może tworzyć).
5. Zaloguj jako **ADMIN**.
6. **Oczekiwanie:** widać „Panel admina” i przycisk „Dodaj użytkownika” oraz „Synchronizuj użytkowników”.

### 4) Admin tworzy użytkownika

1. Zaloguj jako ADMIN.
2. Panel admina → Użytkownicy → „Dodaj użytkownika”.
3. Wpisz: email, imię i nazwisko, rola (HANDLOWIEC/SZEF/ADMIN), hasło tymczasowe.
4. Zapisz.
5. **Oczekiwanie:** aplikacja wysyła POST upsertUser do Apps Script, potem wywołuje synchronizację użytkowników i zapisuje hasło lokalnie; nowy użytkownik może się od razu zalogować (online lub po sync offline).
6. Wyloguj, zaloguj jako nowo utworzony użytkownik – **oczekiwanie:** logowanie działa.

### 5) Brak widocznych danych MVP na ekranie logowania

1. Na ekranie logowania **nie** powinno być żadnego tekstu w stylu „MVP: admin@planlux.pl / admin123”.
2. W buildzie produkcyjnym seed admina (jeśli w ogóle) tylko za flagą/env (np. NODE_ENV !== "production"); w produkcji nie pokazywać i nie zakładać domyślnych haseł w UI.

---

## Lista zmienionych plików

- **packages/desktop/src/config.ts** – stała `APPS_SCRIPT_BASE_URL`, `backend.url` z niej.
- **packages/desktop/electron/authBackend.ts** (nowy) – `loginViaBackend`, `listUsersFromBackend`, `upsertUserViaBackend`.
- **packages/desktop/electron/ipc.ts** – `syncUsersFromBackend`, handler `planlux:syncUsers`; nowy flow `planlux:login` (online → offline z cache); `planlux:createUser` przez backend upsertUser + sync + zapis hasła lokalnie; sentinel hasła dla użytkowników bez pierwszego logowania online.
- **packages/desktop/electron/main.ts** – migracja: `users.last_synced_at`; seed admina tylko w dev (bez zmian w logice).
- **packages/desktop/electron/preload.ts** – kanał `planlux:syncUsers`.
- **packages/desktop/renderer/src/features/auth/LoginScreen.tsx** – opcjonalne `api`, synchronizacja użytkowników przy mount (opóźnienie 0,5 s, timeout 5 s).
- **packages/desktop/renderer/src/app/App.tsx** – przekazanie `api` do `LoginScreen`.
- **packages/desktop/renderer/src/features/admin/AdminPanel.tsx** – przycisk „Synchronizuj użytkowników” (ADMIN), opis źródeł użytkowników.

---

## Checklista weryfikacji

- [ ] Świeża instalacja: użytkownik z arkusza USERS loguje się online.
- [ ] Po jednym udanym logowaniu online ten sam użytkownik loguje się offline (cache).
- [ ] HANDLOWIEC nie ma dostępu do panelu admina (nawigacja + brak możliwości wejścia).
- [ ] ADMIN może tworzyć użytkowników (zapis w Sheets + sync + hasło lokalnie).
- [ ] Nigdzie na ekranie logowania ani w produkcji nie widać danych MVP (admin@planlux.pl / admin123).
