# Fix: pdfs.offer_id FK i handlePdfGenerate

## Przyczyna błędu

W `handlePdfGenerate()` (ipc.ts) przy generowaniu PDF z kalkulatora:

1. Tworzony był nowy wpis w **offers_crm** z `offerId = uuid()`.
2. Do **insertPdf** przekazywano `offerId: null`, co łamało FK `pdfs.offer_id REFERENCES offers(id)` (lub offers_crm) i powodowało błędy przy e-mailu/załącznikach.

## Wprowadzone zmiany

### 1. handlePdfGenerate (ipc.ts)

- **Usunięto** przekazywanie `offerId: null` do insertPdf.
- Używany jest ten sam **offerId**, który został wstawiony do `offers_crm` (zmienna `offerId` z linii ~623).
- Wywołanie: `insertPdf(getDb(), { ..., offerId, ... })`.

### 2. insertPdf (packages/desktop/src/infra/db.ts)

- **offerId** jest wymagane: typ `string` (nie `string | null`).
- Na początku funkcji: jeśli `!params.offerId || !params.offerId.trim()` → `throw new Error("insertPdf: offerId is required (must reference offers_crm.id)")`.
- Komentarz w kodzie: `pdfs.offer_id must reference an existing offers_crm.id (FK). Never pass null or a fake id.`

### 3. insertPdfFailed (ipc.ts)

- Wstawianie rekordu PDF_FAILED tylko gdy istnieje **prawidłowy offerId** (np. z `offerData.draftId` i weryfikacja w `offers_crm`).
- Gdy brak offerId: log `[pdf] insertPdfFailed skipped (no valid offerId for FK)` i brak INSERT (unikanie null w pdfs).

### 4. Cleanup przy starcie (main.ts getDb)

- Po włączeniu `PRAGMA foreign_keys = ON` wykonywane jest:  
  `DELETE FROM pdfs WHERE offer_id IS NULL OR offer_id = ''`.
- Liczba usuniętych wierszy jest logowana.
- Dzięki temu po starcie nie ma w bazie wierszy pdfs z pustym offer_id.

### 5. getOfferIdByNumber (db.ts)

- Funkcja `getOfferIdByNumber(db, offerNumber): string | null` – zwraca **offers_crm.id** dla danego numeru oferty (do użycia przy rozwiązywaniu id po numerze).

### 6. Komunikat dla użytkownika (ipc planlux:email:sendOfferEmail)

- Przy złapaniu błędu zawierającego `"FOREIGN KEY constraint failed"` zwracany jest komunikat:  
  *"Błąd zapisu powiązań (oferta lub użytkownik). Odśwież ofertę i spróbuj ponownie."*  
  Zamiast surowego komunikatu SQLite.

## Zmienione pliki

- `packages/desktop/electron/ipc.ts` – handlePdfGenerate (offerId do insertPdf), insertPdfFailed (warunek + offerId), friendly FK error w sendOfferEmail.
- `packages/desktop/src/infra/db.ts` – insertPdf(offerId wymagane + walidacja), getOfferIdByNumber.
- `packages/desktop/electron/main.ts` – cleanup pdfs WHERE offer_id IS NULL w getDb().
- `docs/EMAIL-FK-CONSTRAINT-FIX.md` – sekcja Schema/FK mapping.
- `docs/PDF-OFFER-ID-FK-FIX.md` – ten plik.

## Akceptacja

- Brak wywołań insertPdf z `offerId: null`.
- Brak generowania „sztucznego” offerId tylko po to, żeby wstawić PDF bez oferty.
- Po starcie aplikacji nie ma w tabeli pdfs wierszy z offer_id NULL.
- „Wyślij e-mail” nie kończy się surowym „FOREIGN KEY constraint failed” (komunikat przyjazny użytkownikowi).
