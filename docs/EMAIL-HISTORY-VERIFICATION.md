# Weryfikacja Historii E-maili (Planlux Hale)

Po wdrożeniu zmian z naprawy „Historia e-maili” zweryfikuj poniższe punkty.

## Checklista (krótka)

- [ ] **Wysyłka** – e-mail z oferty wysyła się, w historii pojawia się jeden wpis (status `sent`).
- [ ] **Historia** – brak duplikatów (outbox + history); outbox tylko QUEUED/FAILED, bez wpisów już w history (po `outbox_id`).
- [ ] **Stare DB** – migracja na kopii bazy ze starym CHECK (`QUEUED`/`SENT`/`FAILED`) przebiega bez błędu; statusy mapowane na `queued`/`sent`/`failed`.
- [ ] **Testy** – `npm run test:electron` w `packages/desktop`: `emailHistoryMigration.test.ts` i `getEmailHistoryForOffer.test.ts` przechodzą.

---

## 1. Wysyłka działa

- Z poziomu oferty wyślij e-mail (z załącznikiem PDF lub bez).
- Oczekiwanie: w UI widać potwierdzenie wysłania, w „Historii e-maili” pojawia się wpis ze statusem `sent` (lub odpowiednio w UI).
- W DevTools (logi main process) nie powinno być błędów typu `email_history insert failed` blokujących działanie.

## 2. Historia nie dubluje

- Dla jednej oferty otwórz „Historię e-maili”.
- Oczekiwanie: każdy wysłany/nieudany e-mail widoczny **raz** (brak duplikatów z `email_outbox` i `email_history`).
- W kolejności: najpierw wpisy z `email_history` (related_offer_id / offer_id), potem z outbox tylko statusy QUEUED/FAILED **i** tylko te, które nie mają jeszcze wpisu w historii (po `outbox_id`).

## 3. Stare bazy migrują bez crasha

- Na kopii bazy użytkownika ze **starą** tabelą `email_history` (CHECK z wartościami `QUEUED`/`SENT`/`FAILED`):
  - Uruchom aplikację (albo wywołaj migracje na tej bazie).
- Oczekiwanie: migracja krok 20 przebudowuje tabelę, mapuje statusy na `queued`/`sent`/`failed`, dodaje kolumny (`idempotency_key`, `related_offer_id`, `to_addr` itd.) i **nie** rzuca constraint (CHECK/FK).
- Test jednostkowy: `packages/desktop/electron/migrations/emailHistoryMigration.test.ts` (uruchom: `npm run test:electron` w `packages/desktop`).

## 4. Sheets zapisują e-maile

- Jeśli w aplikacji jest włączone logowanie e-maili do Google Sheets (LOG_EMAIL / HISTORIA_EMAIL):
  - Wyślij e-mail z oferty.
- Oczekiwanie: w payloadzie do Sheets są: `from`, `to` (toEmail), `subject`, `offerId`, `status`, `sentAt`, `error` (dla FAILED: `errorMessage`).
- Przy błędzie zapisu do Sheets w logach main process powinien pojawić się wpis:  
  `[email] Sheets logEmail failed (diagnostic)` z `payloadId`, `offerId`, `error`.

## 5. Diagnostyka (Email Debug Panel)

- Z renderera (gdy udostępnione w UI) lub z kodu wywołaj IPC: `planlux:debugEmailTables`.
- Oczekiwanie: zwracany jest obiekt z:
  - `email_history`: `table_info`, ostatnie 20 wierszy, `createSql`,
  - `email_outbox`: `table_info`, ostatnie 20 wierszy, `createSql`,
  - `schemaFlags`: np. `email_history_status_lowercase`, `email_outbox_status_uppercase`.
- Dzięki temu można u użytkowników zdalnie sprawdzić schemat i dane bez dostępu do pliku bazy.

---

**Lista zmienionych plików** (główna naprawa):  
`crmMigrations.ts`, `emailService.ts`, `ipc.ts`, `preload.ts`, `packages/shared/src/api/types.ts` (LogEmailPayload: fromEmail, offerId), test migracji `migrations/emailHistoryMigration.test.ts`, oraz (opcjonalnie) testy w `emailService.test.ts` / `sendEmailQueue.test.ts` jeśli dodane.
