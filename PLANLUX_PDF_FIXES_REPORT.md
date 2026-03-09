# Planlux Hale — Raport napraw systemu PDF

**Data:** 2025-03-09  
**Zakres:** wyłącznie pipeline generowania ofert PDF (preview + final).

---

## 1. Wykryte błędy PDF (realne vs potencjalne)

### Błędy realne (naprawione)

| # | Błąd | Skutek | Poprawka |
|---|------|--------|----------|
| 1 | **Logo: zła rozszerzenie w szablonie** | W `index.html` było `src="assets/logo-bez-tla.png"`, a w katalogu `assets` jest tylko `logo-bez-tla.svg`. Logo nigdy się nie ładowało. | Zmiana we wszystkich 3 wystąpieniach w `index.html` na `logo-bez-tla.svg`. |
| 2 | **Zbieranie ścieżek assetów z CSS** | Regex w `collectAssetPaths` nie łapał `url('./assets/hero-bg-print-safe.png')` (z `./`), więc hero-bg nie był dodawany do listy sprawdzanych assetów i diagnostyka była niepełna. | Rozszerzenie regexów o `(?:\.\/)?` przed `assets/` (dla `src` i `url()`). |
| 3 | **Template po buildzie (packaged)** | W trybie packaged pierwszy kandydat mógł być z `app.getAppPath()` bez poprawnego katalogu assets (extraResources trafia do `resourcesPath`). | W `getPdfTemplateDir()` przy `app.isPackaged` pierwszy kandydat to `resourcesPath + TEMPLATE_SUBDIR`; pozostałe bez ścieżek repo. |
| 4 | **Brak wymaganych assetów** | Gdy w szablonie brakowało logo (np. po błędnym deployu), PDF i tak się generował z pustym logo. | Lista `REQUIRED_PDF_ASSETS` (logo); po skopiowaniu assetów sprawdzana jest obecność; przy braku zwracany `ASSET_COPY_FAILED`. |
| 5 | **Jeden etap błędu „RENDER_FAILED”** | Błąd przy kopiowaniu assetów i przy zapisie HTML zwracał ten sam komunikat, co utrudniało debug. | Rozdzielenie: `ASSET_COPY_FAILED` (mkdir/copy) i `HTML_WRITE_FAILED` (writeFileSync). |
| 6 | **Brak tła hero przy braku pliku** | Plik `hero-bg-print-safe.png` nie istnieje w repo; tło headera było puste. | Gdy po skopiowaniu brak `hero-bg-print-safe.png`, wstrzykiwany jest fallback CSS: kolor tła `#c8102e`. |
| 7 | **Diagnostyka TEMPLATE_MISSING** | Przy braku szablonu logowane były tylko ścieżki bez informacji, które katalogi istnieją. | Użycie `getPdfTemplateDirCandidatesWithExists()` i logowanie `candidates: [{ dir, indexExists }]` w ipc i w `generatePdfFromTemplate`. |
| 8 | **Błąd loadFile bez jasnego etapu** | Przy `did-fail-load` komunikat nie wskazywał etapu. | Prefiks błędu: `LOADFILE_FAILED: Błąd ładowania dokumentu (kod …): …`. |

### Błędy potencjalne / ryzyka (złagodzone lub udokumentowane)

- **hero-bg-print-safe.png** – nadal nie ma w repozytorium; po poprawkach: albo dodajesz plik do `assets/`, albo używany jest fallback gradientem (patrz sekcja „Domknięcie do testów handlowca”).
- **diagram-techniczny.png** – używany na stronie 3; brak pliku obsłużony placeholderem tekstowym i `onerror` w przeglądarce.
- **Druga strona (spec)** – CSS (`.page--spec`, `page-break-after`) jest ustawiony; przy bardzo długiej treści warto ręcznie sprawdzić łamanie stron.

---

## Domknięcie PDF do testów handlowca (dopracowanie)

### Co jeszcze było zepsute / dopracowane

| Obszar | Problem | Poprawka |
|--------|--------|----------|
| **Hero bez pliku** | Fallback był jednolitym kolorem (#c8102e) – działał, ale wyglądał płasko. | Fallback zmieniony na **gradient** (165deg, #6b0d14 → #8b0f1b → #c8102e → #a80f0f) – wizualnie spójny z marką. |
| **Diagram bez pliku** | Brak `diagram-techniczny.png` dawał pustą/broken ramkę na stronie 3. | W szablonie: **placeholder** „Rysunek techniczny w przygotowaniu” + `onerror` na `<img>` (ukrycie img, pokazanie span). W backendzie: gdy plik brak, cały blok diagramPanel zamieniany na wersję z placeholderem. Dodane style `.diagramPanel`, `.diagram-placeholder`, `.diagram-panel-no-image`. |
| **Długie dane** | `white-space: nowrap` na `.kv__v` i brak zawijania w chipach/stopce mogły rozjechać layout. | **word-wrap / overflow-wrap** na `.kv__v`, `.chip`, `.hero__title`, `.hero__sub`, `.metaBox__v`, `.stat__value`, `.stat__note`, `.pill`, stopce; **min-width: 0** i **overflow: hidden** gdzie potrzeba; **flex-wrap** w stopce. |
| **Pills/dodatki** | Wysokość sztywna 29px przy długich nazwach. | **min-height: 29px**, **max-width: 100%**, **word-wrap** na `.pill`; **min-width: 0** na `.pills`. |
| **Diagram w druku** | Brak zabezpieczenia łamania strony. | **page-break-inside: avoid** na `.diagramPanel` w `@media print`. |

### Assety dodane / fallbacki

- **hero-bg-print-safe.png** – nie dodany (binarny); **fallback:** gradient CSS wstrzykiwany gdy plik brak (wygląd zbliżony do czerwonego headera).
- **diagram-techniczny.png** – nie dodany; **fallback:** (1) w HTML: `<span class="diagram-placeholder">` + `onerror` na img; (2) w backendzie: zamiana bloku na wersję z placeholderem gdy plik nie istnieje w tmp.

### Pliki zmienione (ta runda)

| Plik | Zmiany |
|------|--------|
| `packages/desktop/electron/pdf/generatePdfFromTemplate.ts` | Hero fallback: gradient zamiast koloru; obsługa braku diagramu (zamiana bloku HTML + log). |
| `packages/desktop/assets/pdf-template/Planlux-PDF/index.html` | W bloku diagram: `onerror` na img + span `.diagram-placeholder` z tekstem. |
| `packages/desktop/assets/pdf-template/Planlux-PDF/styles.css` | Style diagramu (`.diagramPanel`, `.diagramImg`, `.diagram-placeholder`, `.diagram-panel-no-image`); zawijanie i overflow (`.kv__v`, `.chip`, `.hero__title`/`__sub`, `.metaBox__v`, `.stat__value`/`__note`, `.pill`, `.pills`, `.card__body`, stopka); `page-break-inside: avoid` dla `.diagramPanel`. |
| `docs/PDF_TEST_CHECKLIST_HANDLOWIEC.md` | **Nowy plik** – checklista testowa PDF dla handlowca (10 scenariuszy). |

### Najważniejsze diffy (ta runda)

**generatePdfFromTemplate.ts (hero + diagram):**

- Hero fallback: `background-image: linear-gradient(165deg, #6b0d14 0%, #8b0f1b 25%, #c8102e 60%, #a80f0f 100%)` zamiast `background-color: #c8102e`.
- Po sprawdzeniu `!fs.existsSync(diagramPath)`: replace bloku `diagramPanel` (img + span) na wersję tylko z placeholderem; log `[pdf] diagram-techniczny.png missing – wyświetlono placeholder`.

**index.html (diagram):**

- W `.diagramPanel`: img z `onerror="this.style.display='none'; ... classList.add('diagram-placeholder-visible');"` + `<span class="diagram-placeholder">Rysunek techniczny w przygotowaniu</span>`.

**styles.css (layout):**

- `.kv__v`: usunięte `white-space: nowrap`; dodane `word-wrap`, `overflow-wrap`, `min-width: 0`, `max-width: 100%`.
- `.chip`, `.hero__title`/`__sub`, `.metaBox__v`, `.stat__value`/`__note`, `.pill`: zawijanie i ewentualnie `min-width: 0`.
- Nowe: `.diagramPanel`, `.diagramImg`, `.diagram-placeholder`, `.diagram-panel-no-image`, `.diagram-placeholder-visible`; w print: `.diagramPanel` w `page-break-inside: avoid`.

### Preview vs final (1:1)

- **Preview** i **finalny PDF** używają tego samego pipeline’u: `generatePdfFromTemplate(..., { previewMode: true | false })`. Ten sam templateDir, ten sam HTML (renderTemplate), te same assety (copy do tmp), ten sam printToPDF. Różnica: katalog wyjścia (preview vs pdf) i nazwa pliku. **Brak rozjazdów.**

### Czy PDF jest gotowy do testów handlowca

- **Tak.** Wprowadzone zmiany domykają: brakujące assety (hero gradient, diagram placeholder), layout przy długich danych, spójność preview/final. Build nie gubi assetów (template z `extraResources`). Checklista testowa jest w `docs/PDF_TEST_CHECKLIST_HANDLOWIEC.md`.

### Checklista testowa dla handlowca

- Pełna ścieżka: **`docs/PDF_TEST_CHECKLIST_HANDLOWIEC.md`**.  
- Zawiera 10 punktów: pełna oferta, bez firmy, długa nazwa, długi adres, wiele dodatków, kilka bram, wielostronicowa, preview w dev, final w dev, final po buildzie; plus sekcja „Błędy do zgłoszenia”.

---

## 2. Zmienione pliki

| Plik | Opis zmian |
|------|------------|
| `packages/desktop/assets/pdf-template/Planlux-PDF/index.html` | `logo-bez-tla.png` → `logo-bez-tla.svg` (3×). |
| `packages/desktop/assets/pdf-template/Planlux-PDF/README.md` | Opis assetów: hero-bg wymagane dla tła, diagram opcjonalny. |
| `packages/desktop/electron/pdf/pdfPaths.ts` | Priorytet `resourcesPath` przy packaged; `getPdfTemplateDirCandidatesWithExists()`; spójna kolejność kandydatów. |
| `packages/desktop/electron/pdf/generatePdfFromTemplate.ts` | Typ `PdfFailureStage`; `ASSET_COPY_FAILED` / `HTML_WRITE_FAILED`; wymagane assety; rozdzielone try/catch (copy vs write HTML); diagnostyka payload + candidates; fallback tła hero; `diagnoseAssets` zwraca `missingRequired`. |
| `packages/desktop/electron/pdf/generatePdf.ts` | Prefiks `LOADFILE_FAILED` w błędzie `did-fail-load`. |
| `packages/desktop/electron/ipc.ts` | Import `getPdfTemplateDirCandidatesWithExists`; przy TEMPLATE_MISSING logowanie `candidates` z `indexExists`. |

---

## 3. Najważniejsze diffy

### index.html (logo)

```diff
- src="assets/logo-bez-tla.png"
+ src="assets/logo-bez-tla.svg"
```
(w 3 miejscach)

### pdfPaths.ts (kandydaci przy packaged)

- Przy `app.isPackaged` lista kandydatów zaczyna się od `path.join(resourcesPath, TEMPLATE_SUBDIR)`.
- Nowa funkcja `getPdfTemplateDirCandidatesWithExists(): Array<{ dir: string; indexExists: boolean }>`.
- `getPdfTemplateDirCandidates()` budowana z tej samej listy (ta sama kolejność co w `getPdfTemplateDir`).

### generatePdfFromTemplate.ts (etapy i assety)

- Nowe stage: `ASSET_COPY_FAILED`, `HTML_WRITE_FAILED`.
- Po skopiowaniu assetów: `diagnoseAssets()` → jeśli `missingRequired.length > 0` → return `ASSET_COPY_FAILED`.
- Osobny `catch` dla mkdir/copy (ASSET_COPY_FAILED) i dla `writeFileSync` (HTML_WRITE_FAILED).
- Brak `hero-bg-print-safe.png` → wstrzyknięcie `<style>.hero{...background-color:#c8102e!important}</style>` przed `</head>`.
- Log: `[pdf] payload summary` (offerNumber, clientName, previewMode); przy TEMPLATE_MISSING: `candidates: getPdfTemplateDirCandidatesWithExists()`.

### generatePdf.ts (loadFile)

```diff
- reject(new Error(`Błąd ładowania dokumentu (kod ${code}): ${msg}`))
+ reject(new Error(`LOADFILE_FAILED: Błąd ładowania dokumentu (kod ${code}): ${msg}`))
```

---

## 4. Pełny flow generowania PDF (krok po kroku)

1. **UI** – Użytkownik klika „Generuj PDF” lub otwiera podgląd; renderer wywołuje `api("pdf:generate", payload, ...)` lub `api("planlux:generatePdfPreview", payload, pdfOverrides)`.
2. **IPC** – `handlePdfGenerate` / handler preview: walidacja payload (offer, pricing, offerNumber), ewentualnie E2E placeholder.
3. **Template dir** – `getPdfTemplateDir()`: E2E env → albo lista kandydatów (packaged: najpierw `resourcesPath/assets/pdf-template/Planlux-PDF`), szukanie `index.html`; przy braku log `TEMPLATE_MISSING` z `candidates` (dir + indexExists).
4. **Payload** – `mapOfferDataToPayload(offerData, offerDate, pdfOverrides?.page1)` → dane do szablonu (klient, ceny, dodatki, tabela itd.).
5. **Render HTML** – `renderPdfTemplateHtml(templateDir, payload, templateConfig, editorContent, …)` → odczyt `index.html` i `styles.css`, podstawienie placeholderów, inlinowanie CSS (link → `<style>`).
6. **Katalog tymczasowy** – `userData/tmp/offer_<id>/`, `mkdir` + kopiowanie `templateDir/assets` → `offerDir/assets`.
7. **Diagnostyka assetów** – `collectAssetPaths(html)` (w tym `./assets/` z CSS), sprawdzenie plików w `offerDir`; wymagane: `logo-bez-tla.svg`; przy braku wymaganych → return `ASSET_COPY_FAILED`.
8. **Logo i hero** – Zamiana `{{logoUrl}}` na file:// lub `assets/logo-bez-tla.svg`. Gdy brak `hero-bg-print-safe.png` → wstrzyknięcie fallbacku koloru tła.
9. **Zapis HTML** – `fs.writeFileSync(offerDir/index.html, html)`; przy błędzie → return `HTML_WRITE_FAILED`.
10. **printToPDF** – `runPrintToPdfFromFile(offerDir/index.html)`: ukryte okno, `loadFile(tempHtmlPath)`, czekanie na load + fonty + obrazy, `printToPDF({ printBackground: true, … })`; przy błędzie load → błąd z prefiksem `LOADFILE_FAILED`; przy błędzie print → return `PRINT_FAILED`.
11. **Usunięcie tmp** – `rmSync(offerDir)` (best effort).
12. **Zapis PDF** – `outputDir` = preview ? `userData/preview` : `userData/pdf`; `buildPdfFileName(...)` lub `getPreviewPdfFileName()`; `writeFileSync(filePath, buffer)`; przy błędzie → return `WRITE_FAILED`.
13. **Historia (tylko final)** – W IPC po sukcesie: insert do `offers_crm`, `insertPdf`, event_log, offer_audit; `apiClient.logPdf(...)` lub outbox LOG_PDF; przy błędzie któregoś z tych kroków → zwrot z `stage: "PERSISTENCE_FAILED"` (plik PDF i tak zapisany). Przy błędzie generowania (timeout, TEMPLATE_MISSING, …) → `insertPdfFailed(offerData, error)` gdy jest `draftId`.

Preview i final używają tego samego pipeline’u (`generatePdfFromTemplate`); różnica: `previewMode: true` → katalog wyjścia `preview` i stała nazwa pliku preview.

---

## 5. Co naprawiono w poszczególnych obszarach

- **templateDir** – W packaged pierwszy kandydat to `resourcesPath + TEMPLATE_SUBDIR`. Przy TEMPLATE_MISSING logowane są wszyscy kandydaci z `indexExists`. `getPdfTemplateDirCandidates()` w tej samej kolejności co rozwiązywanie.
- **Assets** – Logo w HTML poprawione na .svg. Zbieranie ścieżek z CSS obejmuje `./assets/`. Wymagane assety (logo) sprawdzane po copy; brak → ASSET_COPY_FAILED. Brak hero-bg → fallback koloru. Diagnostyka: lista referencji, brakujące (pełne ścieżki), brak wymaganych.
- **HTML/CSS** – Bez zmian w layout (strona 2/3, page-break) – były poprawne. Tło hero działa: albo plik PNG, albo wstrzyknięty kolor.
- **Preview vs final** – Jeden pipeline: `generatePdfFromTemplate(..., { previewMode: true/false })`; ten sam templateDir, assety, HTML, dane, CSS, printToPDF. Preview zapis w `userData/preview`, final w `userData/pdf` + historia.
- **Historia PDF** – Bez zmian w insertPdf/insertPdfFailed/PERSISTENCE_FAILED. Stage’y z generatora (TEMPLATE_MISSING, ASSET_COPY_FAILED, HTML_WRITE_FAILED, PRINT_FAILED, WRITE_FAILED) przekazywane do odpowiedzi IPC; przy błędzie generowania nadal wywoływane `insertPdfFailed` gdy jest `draftId`.

---

## 6. Ryzyka, które zostały

- **hero-bg-print-safe.png** – Trzeba dodać plik do `assets/` (lub zostawić fallback kolorem).
- **diagram-techniczny.png** – Strona 3 odwołuje się do tego pliku; brak w repo → pusta ramka; można dodać plik lub zmienić szablon.
- **Timeout 20 s** – Przy bardzo ciężkim HTML/słabej maszynie możliwy timeout; komunikat po polsku; ewentualne zwiększenie stałej lub uproszczenie szablonu.
- **Długa treść na stronie 2** – `page-break-inside: avoid` na blokach; przy ekstremalnie długim tekście warto przetestować ręcznie.
- **Liczba stron PDF** – Nie jest logowana (wymagałoby parsowania PDF); w logach jest `sizeBytes` zapisanego pliku.

---

## 7. Jak ręcznie przetestować PDF po poprawkach

1. **Dev**
   - `npm run dev:desktop`, Kalkulator → uzupełnij dane (wariant, wymiary, klient, dodatki).
   - Podgląd: przycisk podglądu PDF → sprawdź, czy w podglądzie widać logo i tło headera (kolor lub PNG, jeśli dodany).
   - Generuj PDF: „Generuj PDF” → sprawdź, czy plik w `userData/pdf` (lub wskazanym katalogu) ma logo i tło; otwórz PDF, przejrzyj strony 1–3 (layout, łamanie).
   - Logi (userData/logs): szukaj `[pdf] templateDir resolved`, `[pdf] payload summary`, `[pdf] assets check`, `[pdf] temp HTML written`, `[pdf] saved path` z `sizeBytes`.

2. **Brak logo (test wymaganych assetów)**
   - Tymczasowo zmień w szablonie nazwę `logo-bez-tla.svg` na inną (albo usuń z assets) → uruchom generowanie → oczekiwany błąd „Brak wymaganych assetów” i stage ASSET_COPY_FAILED.

3. **Brak hero-bg**
   - Upewnij się, że w `assets/` nie ma `hero-bg-print-safe.png` → wygeneruj PDF → w logach: „hero background missing – zastosowano fallback”; w PDF header w kolorze #c8102e.

4. **Pełne dane / długie teksty**
   - Oferta z długą nazwą firmy, długim adresem, wieloma dodatkami → generuj PDF i sprawdź, czy nic nie wylewa się poza bloki i czy druga strona się nie rozjeżdża.

5. **Packaged (build)**
   - `npm run build` (w repo), potem `electron-builder` / dist → zainstaluj i uruchom.
   - Wygeneruj PDF z poziomu aplikacji → sprawdź logi (w katalogu userData aplikacji): `templateDir resolved` powinien wskazywać na katalog w `resources/assets/pdf-template/Planlux-PDF`; plik PDF z logo i tłem (lub fallback).

6. **Błędy**
   - Przy celowym braku szablonu (np. zła ścieżka) → TEMPLATE_MISSING i w logach `candidates` z `indexExists: false` dla wszystkich.
   - W logach przy innych błędach szukaj stage: ASSET_COPY_FAILED, HTML_WRITE_FAILED, LOADFILE_FAILED (w treści błędu), PRINT_FAILED, WRITE_FAILED.

---

**Koniec raportu.**
