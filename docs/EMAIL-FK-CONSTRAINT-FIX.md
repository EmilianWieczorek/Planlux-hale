# Fix: FOREIGN KEY constraint failed przy wysyłce e-mail

## Schema / FK mapping (skrót)

- **offers_crm** – id (PK), offer_number, user_id REFERENCES users(id). Główna tabela ofert.
- **pdfs** – id (PK), offer_id REFERENCES offers(id) lub offers_crm(id) (zależnie od migracji). Zawsze ustawiać **offers_crm.id**, nigdy null ani numer oferty.
- **email_history** – id (PK), offer_id REFERENCES offers_crm(id) (legacy), outbox_id, account_id. Historia maili.
- **email_outbox** – id (PK), account_id REFERENCES smtp_accounts(id), account_user_id REFERENCES users(id), related_offer_id (bez FK). Załączniki w **attachments_json** (brak tabeli email_attachments).
- Kolejność zapisu: najpierw email_outbox (lub oferta), potem email_history; pdfs tylko z prawidłowym offer_id.

## Mapowanie tabel (ten projekt)

W tym projekcie **nie ma** tabel `email_logs` ani `email_attachments`. Używane są:

- **email_outbox** – kolejka / rekord wysyłki (nadrzędny dla wpisu w historii); załączniki w kolumnie `attachments_json`.
- **email_history** – historia wysłanych/błędów (odpowiednik „logu”); powiązanie przez `outbox_id` → `email_outbox(id)`.

Załączniki (PDF oferty + pliki użytkownika) są zapisywane jako JSON w `email_outbox.attachments_json`, bez osobnej tabeli z FK.

## Mapowanie offer_id (identyfikator vs numer oferty)

Kolumny **email_history.offer_id** i **email_outbox.related_offer_id** muszą zawierać **offers_crm.id** (klucz główny), a nie numer oferty (np. `offer_number` typu "PLX-X0020/2026"). W przeciwnym razie FK `email_history.offer_id REFERENCES offers_crm(id)` powoduje błąd.

**Rozwiązanie:** Na początku obsługi wysyłki (planlux:sendOfferEmail, planlux:email:sendOfferEmail) używana jest funkcja **resolveOfferId(db, offerIdOrNumber)**:

1. `SELECT id FROM offers_crm WHERE id = ?` – jeśli przekazano już id.
2. Jeśli brak wiersza: `SELECT id FROM offers_crm WHERE offer_number = ?`.
3. Zwraca `offers_crm.id` lub `null`; przy `null` zwracany jest błąd: *"Oferta nie znaleziona (nieprawidłowy identyfikator lub numer oferty)"*.

Do wszystkich zapisów (email_history.offer_id, email_outbox.related_offer_id, UPDATE offers_crm, offer_audit.offer_id) używana jest wyłącznie ta rozpoznana wartość **id**.

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

## PRAGMA foreign_keys = ON

W `main.ts` przy pierwszym otwarciu bazy (w `getDb()` po `runMigrations`) ustawiane jest:

- `db.exec("PRAGMA foreign_keys = ON");`

Dzięki temu SQLite wymusza wszystkie FOREIGN KEY dla tego połączenia (po migracjach).

## Walidacja przed INSERT

- **Użytkownik nadawcy:** `SELECT id FROM users WHERE id = ? AND active = 1` – bez wiersza zwracany błąd, brak zapisu.
- **Oferta:** wewnątrz transakcji `SELECT id FROM offers_crm WHERE id = ?` – brak wiersza → rzucany błąd (konsystencja `related_offer_id`).
- **Outbox po INSERT:** `SELECT id FROM email_outbox WHERE id = ?` – brak wiersza → błąd diagnostyczny przed INSERT email_history.

## Zmienione pliki

- `packages/desktop/electron/main.ts` – `PRAGMA foreign_keys = ON` po otwarciu bazy.
- `packages/desktop/electron/ipc.ts` – **resolveOfferId(db, offerIdOrNumber)** (id lub offer_number → offers_crm.id); użycie rozpoznanego id w planlux:sendOfferEmail i planlux:email:sendOfferEmail; walidacja użytkownika, transakcje, account_id w outbox, sprawdzenie oferty w transakcji, diagnostyka.
- `packages/desktop/electron/emailService.ts` – transakcje w processOutbox (sent + failed po MAX_RETRIES), diagnostyka przed INSERT email_history.

## Kolejność zapisu (nie zmieniać)

1. Najpierw **email_outbox** (parent: id, account_id, account_user_id muszą spełniać FK).
2. Potem **email_history** (outbox_id wskazuje na istniejący wiersz outbox).

Załączniki są przechowywane w `attachments_json` w outbox (bez osobnej tabeli email_attachments), więc brak dodatkowych FK do obsługi przy tym fixie.
