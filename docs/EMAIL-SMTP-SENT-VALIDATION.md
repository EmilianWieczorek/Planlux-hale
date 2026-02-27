# Walidacja wysyłki SMTP i statusu "sent"

## Zmiany

- **Status "sent"** ustawiany jest tylko gdy serwer SMTP przyjął wiadomość (`accepted.length > 0` i `rejected.length === 0`). W przeciwnym razie zapisywany jest status **"failed"** oraz szczegóły w `error` / `rejected` / `smtp_response`.
- **Pole "Do"** jest parsowane (przecinek, średnik, spacja, nowa linia) i zapisywane w historii jako jedna linia z przecinkami (np. `a@b.com, b@c.com`).
- W **historii e-mail** zapisywane są: `provider_message_id`, `accepted_json`, `rejected_json`, `smtp_response`.
- W **main process** logowane są (bez haseł): host, port, secure, auth_user, to, subject oraz wynik sendMail: messageId, accepted, rejected, response.

## Test manualny – pole "Do" (parseRecipients)

1. Otwórz ofertę → "Wyślij e-mail".
2. W polu **Do** wpisz dwa adresy rozdzielone spacją, np. `test1@gmail.com test2@gmail.com`.
3. Wyślij (lub zapisz wersję roboczą).
4. W historii e-mail wpis powinien mieć w polu "Do" wartość: `test1@gmail.com, test2@gmail.com` (oba adresy w jednej linii, oddzielone przecinkiem).

Test jednostkowy: `packages/desktop/electron/emailService.test.ts` – `parseRecipients` (2 adresy po spacji, po przecinku, po średniku, trim, puste).

## Test manualny – dowód SMTP i status "sent"

1. Wyślij ofertę e-mailem na **prawidłowy** adres (np. swoją skrzynkę).
2. W historii e-mail dla tego wpisu sprawdź:
   - `status` = `sent`,
   - `provider_message_id` ustawiony (np. z Gmaila),
   - `accepted_json` zawiera przyjęte adresy,
   - `rejected_json` pusty lub null.
3. (Opcjonalnie) Wyślij na **nieprawidłowy** adres (np. `invalid@nonexistent-domain-xyz123.com`) – w zależności od serwera SMTP:
   - albo błąd przy `sendMail` → status `failed`, `error` w historii,
   - albo `rejected` niepusty → status `failed`, w historii zapisane `rejected_json` i ewentualnie `smtp_response`.

## Gdzie szukać logów

- Main process (DevTools konsola main / terminal przy `npm run dev`):
  - `[emailService] sendOfferEmailNow` / `sendNow` – host, port, secure, auth_user, to, subject,
  - `[emailService] sendOfferEmailNow result` / `sendNow result` – messageId, accepted, rejected, response,
  - `[email] sendMail result` – dla legacy `planlux:sendOfferEmail`.

## Zmienione pliki (skrót)

- `packages/desktop/electron/emailService.ts` – `parseRecipients`, `SendMailResult`, logi, accepted/rejected w `sendOfferEmailNow` i `sendNow`, zapis `accepted_json`/`rejected_json`/`smtp_response` w `processOutbox`.
- `packages/desktop/electron/smtpSend.ts` – `sendMail` zwraca `SentMailResult`; `createSendEmailForFlush` ustawia SENT tylko gdy accepted i brak rejected.
- `packages/desktop/electron/ipc.ts` – parsowanie "to" przez `parseRecipients` w `planlux:sendOfferEmail` i `planlux:email:sendOfferEmail`, `planlux:email:send`; zapis pełnego wyniku SMTP w historii; status "sent" tylko przy `result.ok`.
- `packages/desktop/electron/migrations/crmMigrations.ts` – migracja 14: kolumny `accepted_json`, `rejected_json`, `smtp_response` w `email_history`.
- `packages/desktop/electron/emailService.test.ts` – testy `parseRecipients`.
