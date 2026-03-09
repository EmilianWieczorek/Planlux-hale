# Raport: naprawa flow „Generuj PDF” (Planlux Hale)

**Data:** 2025-03-09  
**Zakres:** frontend runtime errors, zapis oferty do Supabase, flow + UI + komunikaty + logi.

---

## 1a. Root cause – runtime error `process is not defined`

- **Objaw:** ReferenceError: process is not defined w Kalkulator.tsx podczas generatePdf.
- **Przyczyna:** W rendererze (Vite / kontekst przeglądarki Electron) nie ma globalnego obiektu `process`. Kod używał `process.env.LOG_LEVEL === "debug"` do warunkowego logowania.
- **Rozwiązanie:** W rendererze zastąpiono `process.env.LOG_LEVEL === "debug"` stałą `isDebugLog = !!import.meta.env?.DEV`. Logi diagnostyczne w Kalkulatorze włączają się w trybie deweloperskim (Vite DEV), bez odwołania do `process`.

---

## 1b. Root cause – runtime error `normalizeErrorMessage is not a function`

- **Objaw:** W Kalkulatorze przy wywołaniu `normalizeErrorMessage(...)` w trakcie generowania PDF (save error / PDF error) pojawiał się błąd „normalizeErrorMessage is not a function”, co wywalało frontend.
- **Przyczyna:** W rendererze (Vite) import z `@planlux/shared` mógł w pewnych konfiguracjach / cache’ach zwracać inny kształt modułu (np. default zamiast named export), przez co `normalizeErrorMessage` nie było funkcją w runtime.
- **Rozwiązanie:** W `Kalkulator.tsx` dodano lokalny helper `safeNormalizeError(error)`, który:
  - jeśli `normalizeErrorMessageFromShared` jest funkcją – wywołuje go,
  - w przeciwnym razie wykonuje tę samą logikę co w shared (string, Error, object.message/error/details/code, unikanie "[object Object]").
  Wszystkie wywołania w Kalkulatorze używają `safeNormalizeError`, więc brak crashu niezależnie od działania importu.

---

## 2. Root cause – zapis do `public.offers` (PGRST204)

- **Objawy:** Kolejno PGRST204 dla: `area_m2`, `created_by`, `offer_number_status`, **totals**. W **wdrożonej** bazie Supabase tabela `offers` w schema cache PostgREST **nie ma** tych kolumn (migracja w repo definiuje szerszy schemat; stan chmury jest inny).
- **Przyczyna:** Insert wysyłał kolumny nieistniejące we wdrożonym schemacie. Kolejne fallbacki (bez created_by, bez offer_number_status, potem payload+totals) nadal używały `totals`, którego też nie ma.
- **Rozwiązanie:** **Jeden finalny insert** dopasowany do realnego schematu. Wysyłamy **wyłącznie** kolumnę **payload** (jsonb). Wszystkie dane biznesowe (w tym total_pln, area_m2) są wewnątrz payload. Nie wysyłamy: totals, created_by, offer_number_status, status, offer_number, client_id, pricing. Select tylko `id` (unikamy PGRST204 przy select created_at/updated_at, jeśli ich nie ma).

---

## 3. Finalna lista kolumn i finalny insert

**Potwierdzone brakujące we wdrożeniu (PGRST204):** area_m2, created_by, offer_number_status, totals.

**Używany przez aplikację insert (finalny):**
- **Tabela:** `public.offers`
- **Kolumny w insertcie:** tylko **payload** (jsonb).
- **Zawartość payload:** user_id, client_name, client_email, client_phone, client_company, client_address, variant_hali, width_m, length_m, height_m, area_m2, total_pln.
- **Select po insertcie:** `id` (tylko; created_at/updated_at mogą nie istnieć we wdrożeniu).

---

## 4. Zmienione pliki

| Plik | Zmiany |
|------|--------|
| **packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx** | Usunięto użycie `process` w rendererze: `isDebugLog = !!import.meta.env?.DEV`, warunki logów na `isDebugLog`. Import `normalizeErrorMessage as normalizeErrorMessageFromShared`; funkcja `safeNormalizeError` z fallbackiem; wszystkie komunikaty błędów przez `safeNormalizeError`. Logi (w dev): generatePdf start/end, saveOffer start/success/fail, pdf:generate start/success/fail, generating true/false. |
| **packages/core/src/offers/saveOffer.ts** | Insert **tylko** `{ payload }` (bez totals, created_by, offer_number_status, status). Select tylko `id`. Zawsze log: targetTable, insertRowKeys, payloadKeys, status; przy błędzie: errorMessage, code, details, hint. |
| **packages/desktop/electron/ipc.ts** | Przy błędzie log: targetTable, insertRowKeys `["payload"]`, payloadKeys, message, code, details, hint, errorMessage. |
| **docs/SUPABASE_OFFERS_SAVE_FIX_REPORT.md** | Ten raport. |

---

## 5. Najważniejsze diffy

**Kalkulator.tsx**
- `isDebugLog = !!import.meta.env?.DEV` – brak odwołań do `process` w rendererze (naprawa "process is not defined").
- `safeNormalizeError(error)` – jeśli import jest funkcją, używa go; inaczej lokalna logika (string/Error/object.message/error/details/code, bez "[object Object]").
- Wszystkie komunikaty błędów przez `safeNormalizeError`.
- Logi (gdy isDebugLog): `[Kalkulator] generatePdf start, generating=true`; `saveOffer start`; `saveOffer success` / `saveOffer fail`; `pdf:generate start`; `pdf:generate success` / `pdf:generate fail`; `generatePdf end, generating=false`.

**saveOffer.ts**
- Jeden insert: `row = { payload }` (tylko payload; bez totals, created_by, offer_number_status, status).
- `.select("id").single()` (tylko id; unikamy select created_at/updated_at jeśli kolumny nie istnieją).
- Zawsze: `console.info` z targetTable, insertRowKeys, payloadKeys, status. Przy błędzie: `console.error` z errorMessage, code, details, hint.
- `SavedOffer.user_id` = `payload.user_id`; `created_at`/`updated_at` ustawione na undefined.

**ipc.ts**
- Przy błędzie: targetTable, insertRowKeys `["payload"]`, payloadKeys (lista kluczy payloadu), message, code, details, hint, errorMessage.

---

## 6. Flow po poprawce

1. **Klik „Generuj PDF”**  
   - Walidacja klienta i wyceny.  
   - `setGenerating(true)`, `setPdfStatusMessage("Generowanie...")`.  
   - (Opcjonalnie) sprawdzenie duplikatów; jeśli są – modal, `return`, w `finally`: `setGenerating(false)`.  
   - Wywołanie `doGeneratePdf()`.

2. **W doGeneratePdf()**  
   - Wycena (calculatePrice), numer oferty.  
   - **Zapis oferty:** `planlux:saveOfferToSupabase`.  
   - Jeśli `!saveRes?.ok || !saveRes.offer?.id`: ustawienie komunikatu „Zapis oferty nie powiódł się: …”, toast, **return** (bez throw). W `generatePdf` finally i tak wykona `setGenerating(false)`.  
   - Jeśli zapis OK: `pdf:generate` z payloadem.  
   - Jeśli PDF ok: toast „PDF zapisany: …”, ewentualnie „… Uwaga: …” przy PERSISTENCE_FAILED; czyszczenie statusu.  
   - Jeśli PDF nie ok: komunikat „Błąd PDF: …”, toast.

3. **Zakończenie**  
   - W `generatePdf` w **finally** zawsze: `setGenerating(false)` – stan „Generowanie...” jest zawsze zamykany.

---

## 7. Komunikaty użytkownika

- **Zapis oferty nie powiódł się:** „Zapis oferty nie powiódł się: &lt;msg&gt;” (status + toast). „Generowanie...” znika.
- **PDF zapisany:** „PDF zapisany: &lt;fileName&gt;”.
- **PDF zapisany, ale problem z persystencją:** „PDF zapisany: … Uwaga: &lt;persistMsg&gt;”.
- **Błąd PDF:** „Błąd PDF: &lt;msg&gt;”.
- **Błąd ogólny (catch w generatePdf):** komunikat z `safeNormalizeError(e)`; bez "[object Object]" i bez „normalizeErrorMessage is not a function”.

---

## 8. Potwierdzenie

- **Frontend** – nie wywala się na błędzie (safeNormalizeError + brak wywołania nie-funkcji).
- **„Generowanie...”** – zawsze jest wyłączane w `finally` w `generatePdf`, także przy błędzie save (return z doGeneratePdf) i przy duplikatach (return przed doGeneratePdf).
- **Zapis oferty** – jeden insert `{ payload }` do `public.offers`; tylko kolumna payload (potwierdzone brak: totals, created_by, offer_number_status, area_m2 jako kolumna). saveOfferToSupabase nie powinien już zwracać PGRST204 przy poprawnym schemacie z kolumną payload.
- **Flow** – zapis oferty → przy sukcesie generacja PDF; przy błędzie zapisu osobny komunikat; błędy PDF osobno; preview PDF niezależny od zapisu.

Nie ruszano: auth, admina, maili, installera, release, samego template’u PDF.
