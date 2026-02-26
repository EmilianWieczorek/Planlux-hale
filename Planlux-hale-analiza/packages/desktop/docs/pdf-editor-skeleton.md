# Edytor PDF – szkielet (architektura)

## Wejście do Edytora PDF

1. Uruchom aplikację (np. `npm run dev:desktop` z roota lub `npm run start` w `packages/desktop`).
2. Zaloguj się (dowolny użytkownik).
3. W **nawigacji głównej** (header, obok „Kalkulator” i „Historia”) kliknij **„Edytor PDF”**.
4. Wyświetli się strona z dwiema kolumnami: po lewej cena + zakładki Strona 1/2 (pola edycji), po prawej podgląd PDF (canvas, bez toolbar).

Na małych ekranach kolumny układają się w stos.

## Zmienione fragmenty

- **Nawigacja:** `renderer/src/features/layout/MainLayout.tsx`
  - Typ `Tab`: dodano `"pdfEditor"`.
  - W `<nav>` dodano przycisk „Edytor PDF” (widoczny dla wszystkich zalogowanych).
  - W `<main>` dodano render `{tab === "pdfEditor" && <PdfEditorPage />}`.
- **Zależności:** `packages/desktop/package.json`
  - Dodano: `@emotion/react`, `@emotion/styled`, `@mui/material` (MUI v7).

## Pliki

| Plik | Opis |
|------|------|
| `renderer/src/pages/pdf-editor/PdfEditorPage.tsx` | Strona: editorContent, layout 2-kolumnowy, przyciski. |
| `renderer/src/pages/pdf-editor/PdfEditorContentTabs.tsx` | Zakładki Strona 1 / Strona 2 + pola edycji. |
| `renderer/src/pages/pdf-editor/PdfPreviewPanel.tsx` | Podgląd PDF (pdfjs-dist, canvas, bez toolbar). |
| `shared/src/pdf/editorContent.ts` | `PdfEditorContent`, `mergePdfEditorContent`. |

## Jak przetestować (DEV i PROD)

### DEV
1. `npm run dev:desktop` z roota monorepo.
2. Zaloguj się, kliknij **„Edytor PDF”** w nawigacji.
3. Lewa kolumna: karta ceny, zakładki „Strona 1” / „Strona 2”, chip „Strona 3 – zablokowana”.
4. Kliknij **„Odśwież podgląd”** – PDF generuje się i wyświetla po prawej (3 strony jako canvasy, bez toolbara).
5. Edytuj pola – kliknij „Odśwież podgląd” – zmiany widoczne na stronach 1–2.
6. Kliknij **„Zapisz treść (str. 1–2)”** – dane zapisują się w `userData/pdf-editor-content.json`.
7. Restart – treść wczytuje się z pliku.

### PROD
1. `npm run build` z roota, uruchom aplikację.
2. Nawigacja → **Edytor PDF**.
3. Ten sam flow: Odśwież podgląd, Zapisz treść, Generuj PDF.

### Jak sprawdzić, że strona 3 jest zablokowana
Edytuj pola w Strona 1/2, odśwież podgląd. Strona 3 („Przygotowanie terenu”) pozostaje **identyczna** – brak pól edycji, treść stała.

### Logi diagnostyczne (DEV)
W konsoli main procesu: `[pdf] planlux:generatePdfPreview templateDir`, ścieżki assetów. W debug box: „Preview renderer: pdfjs (canvas)”.
