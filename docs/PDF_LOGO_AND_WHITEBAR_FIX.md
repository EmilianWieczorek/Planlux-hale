# Naprawa: logo Planlux i biały pasek w PDF

**Data:** 2025-03-09  
**Zakres:** tylko warstwa PDF/template/rendering (bez auth, Supabase, ofert, kalkulatora, admina, maili, release).

---

## 1. Root cause – logo nie renderuje

- **Objaw:** W PDF widać tylko napis „Planlux” (tekst z `alt`) zamiast grafiki logo.
- **Przyczyny:** (1) Szablon na stałe używał `src="assets/logo-bez-tla.svg"`. W niektórych wersjach Chromium/Electron SVG w `printToPDF` bywa niestabilny. (2) Brak fallbacku na PNG. (3) Brak diagnostyki – nie było wiadomo, który plik jest używany i czy istnieje po skopiowaniu.
- **Naprawa:**
  - Po skopiowaniu `assets` do `offerDir` wybierany jest plik logo: jeśli istnieje `logo-bez-tla.png` → używany PNG (stabilniejszy przy druku), w przeciwnym razie `logo-bez-tla.svg`.
  - Wszystkie `<img class="brand__logoImg" src="assets/logo-bez-tla.(svg|png)" ...>` w HTML są zamieniane na wybrany plik.
  - Jeśli w `offerDir` nie ma ani PNG, ani SVG, zamiast przerywać generowanie wstawiany jest fallback tekstowy: `<span class="brand__logoFallback">Planlux</span>` (bez rzucania błędu).
  - Dodane logowanie: `[pdf] logo diagnostics` z polami: templateDir, offerDir, logoPngInTemplate, logoSvgInTemplate, logoPngCopied, logoSvgCopied, chosenLogoFile, finalPathInHtml.
  - Z listy wymaganych assetów usunięto logo (REQUIRED_PDF_ASSETS = []), żeby brak logo nie blokował PDF przy użyciu fallbacku.

---

## 2. Root cause – biały pasek po prawej stronie

- **Objaw:** Na pierwszej stronie PDF po prawej stronie hero/headera widać biały pionowy pasek.
- **Przyczyna:** `.wrap` ma `padding: 24px`. Okno BrowserWindow ma szerokość 794 px (jak .page). Z paddingiem całkowita szerokość treści to 794 + 48 = 842 px, co daje overflow lub widoczny biały margines po prawej przy renderze / druku.
- **Naprawa:**
  - Przy generowaniu PDF do `<body>` dodawana jest klasa `pdf-export` (inject w generatePdfFromTemplate).
  - W CSS dodane reguły dla `.pdf-export`: `.wrap` bez paddingu, stała szerokość 794 px, wycentrowany; `.page` i `.hero` z `overflow-x: hidden` i `box-sizing: border-box`, `width: 100%` / `max-width: 100%`, żeby hero się nie wylewał i nie było poziomego overflowu.
  - W `@media print` wzmocnione: `html, body` i `.page` z `overflow-x: hidden`, `.wrap` z `width: 100%`, `.hero` z `width: 100%` / `max-width: 100%`, żeby w druku też nie było białego paska.

---

## 3. Diagnostyka w generatorze PDF

- W `generatePdf.ts` (runPrintToPdfFromFile) po załadowaniu strony zbierane są: `wrapScrollWidth`, `wrapClientWidth`, `pageScrollWidth`, `pageClientWidth`, `bodyScrollWidth`, `docElClientWidth`, `overflowX` (body.scrollWidth > body.clientWidth).
- Log: `[pdf] diagnostyka: wymiary wrappera i overflow` z tymi wartościami.
- Gdy `overflowX === true`: log ostrzegawczy o możliwym białym pasku.

---

## 4. Zmienione pliki

| Plik | Zmiany |
|------|--------|
| **packages/desktop/electron/pdf/generatePdfFromTemplate.ts** | Wybór logo PNG vs SVG po skopiowaniu assetów; zamiana `src` we wszystkich logo w HTML na wybrany plik; fallback tekstowy przy braku pliku; log `[pdf] logo diagnostics`; inject `class="pdf-export"` na `<body>`; REQUIRED_PDF_ASSETS = []; brak blokowania PDF przy braku logo. |
| **packages/desktop/assets/pdf-template/Planlux-PDF/styles.css** | Klasa `.brand__logoFallback` (styl tekstu „Planlux”); reguły `.pdf-export .wrap` (padding 0, width 794px, margin 0 auto); `.pdf-export .page` i `.pdf-export .hero` (overflow-x, box-sizing, width/max-width); `body.pdf-export { overflow-x: hidden }`; w `@media print` – overflow-x i width dla html/body, .wrap, .page, .hero. |
| **packages/desktop/electron/pdf/generatePdf.ts** | Rozszerzona diagnostyka w executeJavaScript: wrap/page/body scrollWidth i clientWidth, overflowX; log „wymiary wrappera i overflow”; warning przy overflowX. |
| **docs/PDF_LOGO_AND_WHITEBAR_FIX.md** | Ten raport. |

---

## 5. Efekt końcowy

- **Logo:** Używane jest logo z pliku (PNG, jeśli jest w assets, w przeciwnym razie SVG). W logach widać, który plik wybrano i czy jest w templateDir i offerDir. Gdy brak pliku – w PDF widać czytelny tekst „Planlux” zamiast pustego miejsca.
- **Biały pasek:** Przy eksporcie PDF body ma klasę `pdf-export`, więc .wrap nie dodaje paddingu, szerokość jest stała (794 px), hero i strona nie powodują overflowu; w druku (@media print) te same zabezpieczenia. Biały pasek po prawej nie powinien się pojawiać.
- **Weryfikacja:** Po wygenerowaniu PDF w logach: `[pdf] logo diagnostics`, `[pdf] diagnostyka: wymiary wrappera i overflow`; w razie overflowu – warning.

Nie zmieniano: auth, Supabase, ofert, kalkulatora, panelu admina, maili, release, ani innych modułów poza PDF/template/rendering.
