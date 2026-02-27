# Fix: FOREIGN KEY constraint failed przy wysyłce e-mail

## Który FK powodował błąd

Tabela **email_outbox** ma ograniczenia:

- `account_id TEXT REFERENCES smtp_accounts(id)`
- `account_user_id TEXT REFERENCES users(id)` (dodane w migracji 11)

Przy zapisie po wysłaniu oferty e-mailem:

1. **INSERT INTO email_outbox** – używane było tylko `account_user_id` (np. `senderUserId`). Jeśli użytkownik nie istniał w `users` (np. nieaktywny lub usunięty), SQLite zgłaszał **FOREIGN KEY constraint failed**.
2. **account_id** nie było wstawiane do outbox, więc w razie dalszych zapytań/joinów mogła być niespójność.
3. Brak **transakcji** – przy błędzie w drugim INSERT (email_history) w bazie zostawał wpis w outbox bez wpisu w historii.

## Wprowadzone zmiany

### 1. Walidacja przed zapisem (ipc.ts – planlux:email:sendOfferEmail)

- Przed wysłaniem: `SELECT id FROM users WHERE id = ? AND active = 1` dla `senderUserId`.
- Jeśli brak wiersza → zwracany błąd: *"Użytkownik nadawcy nie istnieje lub jest nieaktywny (FK)"*, bez INSERT do outbox/history.

### 2. Transakcja przy zapisie (outbox + email_history)

- **planlux:email:sendOfferEmail** (sukces): w jednej transakcji:
  - UPDATE `offers_crm`
  - INSERT `email_outbox` (z **account_id** i **account_user_id**)
  - sprawdzenie diagnostyczne: `SELECT id FROM email_outbox WHERE id = ?`
  - INSERT `email_history`
  - opcjonalnie INSERT `offer_audit`
- **planlux:email:send** (sukces): w jednej transakcji:
  - INSERT `email_outbox` (z `account_id`, `account_user_id`)
  - sprawdzenie: outbox row istnieje
  - INSERT `email_history`
- **emailService.processOutbox**: UPDATE outbox + INSERT email_history (sukces lub failure po MAX_RETRIES) w transakcji.

### 3. Uzupełnienie account_id w outbox

- W obu ścieżkach IPC do `INSERT INTO email_outbox` dodane jest **account_id** (np. `account.id`), żeby każdy wiersz outbox miał poprawną referencję do `smtp_accounts(id)`.

### 4. Diagnostyka

- Przed INSERT do `email_history` wykonywane jest:  
  `SELECT id FROM email_outbox WHERE id = ?`  
  Jeśli brak wiersza → rzucany błąd: *"[email] FK diagnostic: email_outbox row missing after INSERT"* (w IPC) lub *"[emailService] FK diagnostic: email_outbox row missing before history INSERT"* (w processOutbox).

## Zmienione pliki

- `packages/desktop/electron/ipc.ts` – walidacja użytkownika, transakcje, account_id w outbox, diagnostyka (planlux:email:sendOfferEmail, planlux:email:send).
- `packages/desktop/electron/emailService.ts` – transakcje w processOutbox (sent + failed po MAX_RETRIES), diagnostyka przed INSERT email_history.

## Kolejność zapisu (nie zmieniać)

1. Najpierw **email_outbox** (parent: id, account_id, account_user_id muszą spełniać FK).
2. Potem **email_history** (outbox_id wskazuje na istniejący wiersz outbox).

Załączniki są przechowywane w `attachments_json` w outbox (bez osobnej tabeli email_attachments), więc brak dodatkowych FK do obsługi przy tym fixie.
