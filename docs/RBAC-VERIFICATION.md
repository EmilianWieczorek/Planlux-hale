# RBAC – weryfikacja (Planlux Hale)

Checklist do ręcznego i automatycznego sprawdzenia, że role i wymuszenie zmiany hasła działają poprawnie.

## Role

- **HANDLOWIEC** – kalkulator, oferty, PDF, e-mail. Brak panelu admina i zarządzania użytkownikami.
- **SZEF** – jak handlowiec + Panel admina (aktywność, historia PDF, historia e-mail, E-mail). **Nie** może tworzyć/usuwać użytkowników ani zmieniać ról.
- **ADMIN** – pełny dostęp: panel admina + zakładka Użytkownicy, tworzenie/edycja/usuwanie użytkowników, ustawienia krytyczne.

---

## Checklist

### HANDLOWIEC

- [ ] Po zalogowaniu **nie** widzi zakładki „Panel admina” w nawigacji.
- [ ] Nawigacja zawiera tylko: Kalkulator, Oferty itd. (bez Panelu admina).
- [ ] Próba wejścia ręcznie w route/ekran Panelu admina pokazuje „Brak uprawnień” (403) lub przekierowanie.
- [ ] Brak dostępu do sekcji „Użytkownicy” (nie ma takiej zakładki).

### SZEF

- [ ] Po zalogowaniu **widzi** zakładkę „Panel admina”.
- [ ] W Panelu admina widzi: Aktywność, Historia PDF, Historia e-mail, E-mail.
- [ ] **Nie** widzi zakładki/sekcji „Użytkownicy” (lista użytkowników, Dodaj/Edytuj/Usuń).
- [ ] Próba wywołania IPC `planlux:getUsers` / `planlux:createUser` / `planlux:updateUser` / `planlux:disableUser` jako SZEF zwraca **FORBIDDEN** (lub odpowiednik) – backend blokuje.

### ADMIN

- [ ] Widzi Panel admina i **wszystkie** zakładki, w tym „Użytkownicy”.
- [ ] Może dodawać, edytować, wyłączać użytkowników i zmieniać role.
- [ ] Endpointy user-management (getUsers, createUser, updateUser, disableUser) działają bez błędu.

### Nowy użytkownik (utworzony przez ADMIN)

- [ ] Konto utworzone przez ADMIN ma ustawione `must_change_password = 1`.
- [ ] Po pierwszym logowaniu użytkownik jest **natychmiast** przekierowany na ekran „Zmień hasło”.
- [ ] Wejście do aplikacji (MainLayout) jest zablokowane dopóki hasło nie zostanie zmienione.
- [ ] Po poprawnej zmianie hasła użytkownik wchodzi do aplikacji (bez ponownego logowania, jeśli tak zaimplementowano).

### IPC – blokady

- [ ] Wywołanie `planlux:createUser` jako HANDLOWIEC lub SZEF → odpowiedź z błędem **FORBIDDEN** (lub `error: "Forbidden"`).
- [ ] Wywołanie `planlux:updateUser` / `planlux:disableUser` jako HANDLOWIEC lub SZEF → FORBIDDEN.
- [ ] `currentUser` w main process jest brany z sesji (ustawiony przy loginie), **nie** z danych z renderera.

### Dodatkowo

- [ ] Tekst „MVP: admin@planlux.pl / admin123” **nie** występuje na ekranie logowania (usunięty z kodu).
- [ ] Po utworzeniu użytkownika przez ADMIN w UI pokazywane jest hasło tymczasowe **tylko raz** (np. w modalu z przyciskiem Kopiuj), nie na stałe w liście.

---

## Pliki kluczowe

- **Uprawnienia:** `packages/shared/src/rbac.ts`, `packages/shared/src/auth/permissions.ts`
- **UI – nawigacja:** `packages/desktop/renderer/src/features/layout/MainLayout.tsx`
- **UI – Panel admina / Użytkownicy:** `packages/desktop/renderer/src/features/admin/AdminPanel.tsx`
- **IPC – auth i user-management:** `packages/desktop/electron/ipc.ts`
- **Migracje (users, must_change_password):** `packages/desktop/electron/main.ts`
- **Ekran zmiany hasła:** `packages/desktop/renderer/src/features/auth/ChangePasswordScreen.tsx`
- **Logowanie i flow mustChangePassword:** `packages/desktop/renderer/src/app/App.tsx`
