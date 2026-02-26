# Planlux Hale – CRM-lite Roadmap

## Zaimplementowane

### 1. SQLite – nowe tabele i migracje
- **offers_crm** – pełna tabela ofert (offer_number, status, clientFirstName/LastName, companyName, nip, phone, email, variantHali, wymiary, ceny, standardSnapshot, addonsSnapshot, noteHtml, version)
- **email_history** – historia wysyłek e-mail (offerId, fromEmail, toEmail, subject, body, attachmentsJson, status QUEUED/SENT/FAILED)
- **event_log** – log zdarzeń (offerId, userId, eventType, detailsJson)
- **outbox** – rozszerzony o typ `OFFER_SYNC`

### 2. Typy shared
- `packages/shared/src/crm/types.ts` – OfferCrm, OfferStatus, EmailHistoryRecord, EventLogEntry, UserRole
- `packages/shared/src/pricing/types.ts` – rozszerzony PricingInput: rainGuttersAuto, gates[], heightSurchargeAuto, manualSurcharges[], standardSnapshot[]

### 3. Zakładka „Oferty”
- `OfertyView.tsx` – filtry (W trakcie, Wygenerowane, Wysłane, Zrealizowane, Wszystkie), wyszukiwarka, tabela, akcja „Zrealizowana”
- IPC: `planlux:getOffersCrm`, `planlux:markOfferRealized`

### 4. Integracja Kalkulator → offers_crm
- Przy generowaniu PDF: zapis oferty do `offers_crm` (status GENERATED), wpis do `event_log`
- Przy `saveOfferDraft` (gdy klient + wymiary): upsert do `offers_crm` (status IN_PROGRESS, numer TEMP-xxx)

### 5. Auto-save i przed zamknięciem
- Debounce 10 s, zapis przy blur i zmianie zakładki
- Przed zamknięciem okna: zapis draftu, zakończenie sesji
- Modal po logowaniu: informacja o niedokończonych ofertach

---

## Do zrobienia (priorytet)

### A) Auto-numeracja
- Online: endpoint `POST reserveNumber` w Apps Script
- Offline: `TEMP-<deviceId>-<timestamp>`, po sync zamiana na finalny numer

### C) E-mail
- Komponent `EmailComposer` (Do, Temat, Treść, Załączniki)
- `sendEmail()` w main (SMTP / Gmail API), dane z sejfu
- Zapis do `email_history`, outbox dla offline

### D) Duplikaty
- Sprawdzenie przy zapisie: imię/nazwisko, firma, NIP, telefon (normalizacja)
- Modal z listą dopasowań

### E) Pricing – computeAdditions()
- System rynnowy: mb = 2*(widthM+lengthM) × stawka
- Bramy segmentowe: stawka_m2 × width × height × quantity
- Dopłata za wysokość (auto)
- Manualne dopłaty → addonsSnapshot
- StandardSnapshot: INCLUDED_FREE / CHARGE_EXTRA, odznaczenie → dolicz do ceny

### F) PDF template
- Sekcja dodatków: „w cenie” vs „dolicz”
- Strona 2: Typ_Konstrukcji, Typ_Dachu, Boki, Dach z cennika

### G) Role i panele
- users.role: SALESPERSON, MANAGER, ADMIN (migracja)
- Panel Admina: użytkownicy, aktywność, historia
- Dashboard: Chart.js, miesiąc/rok, oferty per handlowiec

### H) Bezpieczeństwo
- SQLCipher + Keytar (klucz w sejfie)
- Tokeny OAuth/SMTP w sejfie

### I) Backend Apps Script
- Arkusze: Offers, EmailHistory, EventLog
- Endpointy: reserveNumber, post offer, get offers (lastSync), post emailHistory, get dashboard, get duplicates, get counters
- Idempotency: id oferty / id maila

---

## Pliki zmienione/dodane

| Plik | Opis |
|------|------|
| `packages/shared/src/crm/types.ts` | **Nowy** – typy CRM |
| `packages/shared/src/pricing/types.ts` | Rozszerzony PricingInput |
| `packages/shared/src/index.ts` | Eksport typów CRM |
| `packages/desktop/electron/migrations/crmMigrations.ts` | **Nowy** – migracje |
| `packages/desktop/electron/main.ts` | Wywołanie runCrmMigrations |
| `packages/desktop/electron/ipc.ts` | Handlery getOffersCrm, markOfferRealized |
| `packages/desktop/renderer/.../OfertyView.tsx` | **Nowy** – zakładka Oferty |
| `packages/desktop/renderer/.../MainLayout.tsx` | Zakładka „Oferty” |
