# Raport: naprawa „Błąd PDF: [object Object]”

**Data:** 2025-03-09  
**Zakres:** flow „Generuj PDF”, rozdzielenie błędów zapisu oferty i PDF, normalizacja komunikatów w UI.

---

## 1. Prawdziwy root cause komunikatu [object Object]

- **Źródło:** Błąd **nie** pochodził z pipeline’u PDF (PDF generował się poprawnie).
- **Kolejność w flow:** Najpierw wywoływane jest `planlux:saveOfferToSupabase` (zapis oferty w Supabase). Dopiero po sukcesie wywoływane jest `pdf:generate`.
- **Co się działo:** Gdy `saveOfferToSupabase` rzucał wyjątek (np. błąd Supabase, brak sieci, RLS), w handlerze IPC w `catch` zwracane było:
  - `error: e instanceof Error ? e.message : String(e)`.
  - Gdy `e` było **zwykłym obiektem** (np. `{}` lub obiekt błędu z Supabase bez dziedziczenia po `Error`), `String(e)` daje **`"[object Object]"`**.
- W UI po nieudanym zapisie oferty kod **rzucał** `throw new Error(msg)` z tym tekstem, a w zewnętrznym `catch` ustawiał **„Błąd PDF: ” + msg**, więc użytkownik widział **„Błąd PDF: [object Object]”** mimo że PDF w ogóle nie był generowany.

**Podsumowanie:** Root cause to **połączenie dwóch rzeczy**: (1) zwracanie/rzucanie obiektu błędu bez zamiany na czytelny string (brak normalizacji), (2) traktowanie **wszystkiego** w `catch` jako „błąd PDF”, także gdy błąd dotyczył **zapisu oferty w Supabase**.

---

## 2. Czy problem był w PDF czy w saveOfferToSupabase

- **Problem był po stronie zapisu oferty (saveOfferToSupabase)** i po stronie **obsługi błędów w UI**.
- Sam pipeline PDF (generowanie, zapis pliku, assety) działał poprawnie; logi potwierdzały „printToPDF ok”, „generatePdfPreview success”, „assets check missingCount: 0”.
- Błąd pojawiał się **przed** wywołaniem `pdf:generate`, w kroku „Save offer to Supabase”. Nieudany zapis oferty był błędnie komunikowany jako błąd PDF.

---

## 3. Które pliki zmieniłeś

| Plik | Zmiany |
|------|--------|
| `packages/shared/src/utils/errorMessage.ts` | **Nowy** – funkcja `normalizeErrorMessage(error: unknown): string` (zawsze zwraca czytelny tekst, nigdy `[object Object]`). |
| `packages/shared/src/index.ts` | Eksport `normalizeErrorMessage`. |
| `packages/desktop/electron/ipc.ts` | Import `normalizeErrorMessage`; w `planlux:saveOfferToSupabase`: zwracanie `error: normalizeErrorMessage(e)` w catch, rozbudowane logowanie (payload summary, success, błąd z message/code/details/hint); w zwrocie `PERSISTENCE_FAILED` używane `normalizeErrorMessage(persistErr)` dla `persistenceError`. |
| `packages/desktop/renderer/src/features/kalkulator/Kalkulator.tsx` | Import `normalizeErrorMessage`; przy nieudanym zapisie oferty **brak throw** – zamiast tego `setPdfStatusMessage(„Zapis oferty nie powiódł się: …”)`, `showToast`, `return`; przy błędzie PDF używane `normalizeErrorMessage(pdfRes.error)`; obsługa `pdfRes.stage === "PERSISTENCE_FAILED"` (sukces PDF + toast z informacją o problemie z historią); w zewnętrznym `catch` używane `normalizeErrorMessage(e)` i ustawianie statusu bez prefiksu „Błąd PDF”. |

---

## 4. Diff najważniejszych zmian

**shared: nowy plik `utils/errorMessage.ts`**

- `normalizeErrorMessage(error)` – dla `string` zwraca trim; dla `Error` zwraca `message`; dla obiektu szuka `message`, `error`, `error.message`, `details`, `msg`, `code`; w pozostałych przypadkach `String(error)`, a gdy wynik to `"[object Object]"` zwraca `"Nieznany błąd"`.

**Kalkulator – zapis oferty (zamiast throw):**

```diff
-    if (!saveRes?.ok || !saveRes.offer?.id) {
-      const msg = saveRes?.error ? String(saveRes.error) : "Nie udało się zapisać oferty w Supabase.";
-      throw new Error(msg.length > 160 ? msg.slice(0, 157) + "…" : msg);
-    }
+    if (!saveRes?.ok || !saveRes.offer?.id) {
+      const msg = normalizeErrorMessage(saveRes?.error) || "Nie udało się zapisać oferty w Supabase.";
+      const short = msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
+      setPdfStatusMessage(`Zapis oferty nie powiódł się: ${short}`);
+      showToast(short);
+      return;
+    }
```

**Kalkulator – błąd PDF i PERSISTENCE_FAILED:**

- Dla `pdfRes.ok === false`: `msg = normalizeErrorMessage(pdfRes.error)`, `setPdfStatusMessage(\`Błąd PDF: ${short}\`)`, `showToast(short)`.
- Dla `pdfRes.ok === true` i `pdfRes.stage === "PERSISTENCE_FAILED"`: `setPdfStatusMessage(null)`, toast: „PDF zapisany: … . Uwaga: …” (tekst z `normalizeErrorMessage(pdfRes.persistenceError)`).
- W `catch`: `msg = normalizeErrorMessage(e)`, `setPdfStatusMessage(short)` **bez** prefiksu „Błąd PDF”, `showToast(short)`.

**IPC – saveOfferToSupabase:**

- W catch: `const msg = normalizeErrorMessage(e); logger.error(..., { message: msg, code, details, hint }); return { ok: false, error: msg };`
- Dodane logi: przed wywołaniem `saveOffer` (payload summary), po sukcesie (offerId).

---

## 5. Jak teraz UI rozróżnia błędy

| Sytuacja | Komunikat statusu (pod przyciskiem) | Toast |
|----------|-------------------------------------|--------|
| Nie udał się **zapis oferty** w Supabase (przed PDF) | „Zapis oferty nie powiódł się: &lt;normalized message&gt;” | Ten sam tekst (skrócony) |
| **PDF** wygenerowany poprawnie | (czyści status) | „PDF zapisany: &lt;fileName&gt;” |
| PDF OK, ale **persistence** (historia) nie zapisana | (czyści status) | „PDF zapisany: … . Uwaga: &lt;normalized persistenceError&gt;” |
| **Błąd generowania PDF** (template, print, zapis pliku) | „Błąd PDF: &lt;normalized error&gt;” | Ten sam tekst (skrócony) |
| Inny błąd w flow (wycena, numer oferty, brak logowania) w `catch` | &lt;normalized message&gt; (bez prefiksu „Błąd PDF”) | Ten sam tekst |

- Wszystkie komunikaty budowane są z **normalizeErrorMessage(...)**, więc obiekty błędów (Supabase, IPC) nie trafiają do UI jako `[object Object]`.

---

## 6. Przykłady finalnych komunikatów użytkownika

- **Zapis oferty nie powiódł się (np. brak sieci / błąd Supabase):**  
  Status: „Zapis oferty nie powiódł się: [offers] Supabase insert failed: … (code) – details”.  
  Toast: ten sam tekst (do 160 znaków).

- **PDF wygenerowany OK:**  
  Toast: „PDF zapisany: PLANLUX-Oferta-…”.

- **PDF OK, ale zapis do historii się nie udał:**  
  Toast: „PDF zapisany: … . Uwaga: Nie udało się zapisać wpisu w historii PDF.” (lub konkretny błąd po normalizacji).

- **Błąd generowania PDF (np. brak szablonu):**  
  Status: „Błąd PDF: Nie znaleziono szablonu PDF …”.  
  Toast: ten sam tekst.

- **Gdy backend zwrócił obiekt zamiast Error:**  
  Zamiast „Błąd PDF: [object Object]” użytkownik zobaczy np. „Zapis oferty nie powiódł się: Nieznany błąd” lub wyciągnięty z obiektu `message` / `error` / `details` (w zależności od tego, co zwraca Supabase).

---

## 7. Czy po poprawce PDF i zapis oferty są rozdzielone logicznie

- **Tak.**
  - **Zapis oferty** – osobny krok przed PDF; przy błędzie nie wywołujemy PDF, tylko pokazujemy komunikat „Zapis oferty nie powiódł się” i kończymy (return).
  - **Generowanie PDF** – wywoływane tylko po udanym zapisie oferty; błędy z tego etapu są pokazywane jako „Błąd PDF: …”.
  - **Persystencja (historia PDF)** – przy sukcesie PDF, ale błędzie zapisu do bazy/historii zwracane jest `ok: true` + `stage: "PERSISTENCE_FAILED"`; UI traktuje to jako sukces PDF z dodatkową uwagą w toaście, a nie jako „Błąd PDF”.

Dzięki temu użytkownik nie zobaczy już „Błąd PDF” w sytuacji, gdy problem dotyczy wyłącznie zapisu oferty w Supabase.
