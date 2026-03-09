# Planlux-PDF – finalny szablon PDF (jedyne źródło prawdy)

## Entrypoint
- **index.html** – główny dokument (3 strony: Oferta, Specyfikacja, Przygotowanie terenu)
- **styles.css** – wstrzykiwany do HTML przez renderer (offline, bez zewnętrznych @import)
- **assets/** – logo (`logo-bez-tla.svg`), tło headera (`hero-bg-print-safe.png` – wymagane dla poprawnego tła hero na stronach), ikony SVG (ciezarowka, teren-budowy, droga-dojazdowa, media, wykrzyknik, blue-wykrzyknik). Opcjonalnie: `diagram-techniczny.png` (strona 3), **assets/fonts/** (Inter.woff2).

## Placeholdery dynamiczne (obsługiwane przez renderTemplate)
- `{{offerNumber}}`, `{{offerDate}}`, `{{sellerName}}`
- `{{clientName}}`, `{{clientNip}}`, `{{clientEmail}}`, `{{clientPhone}}`, `{{clientAddressOrInstall}}`
- `{{variantName}}`, `{{widthM}}`, `{{lengthM}}`, `{{heightM}}`, `{{areaM2}}`
- `{{constructionType}}`, `{{roofType}}`, `{{wallsType}}`
- `{{priceNet}}`, `{{priceGross}}`
- `{{addonsPillsHtml}}` (lista pills; fallback: „Brak dodatków”)
- `{{breakdownRowsHtml}}`, `{{addonsListHtml}}`, `{{standardListHtml}}` (jeśli użyte w szablonie)

## Assety
- Ścieżki względne (`assets/...`) – przy generowaniu PDF katalog template jest kopiowany do katalogu tymczasowego oferty, a HTML ładany przez `loadFile()`; przeglądarka rozwiąże `assets/` względem katalogu pliku.
- Font Inter: lokalny (`local('Inter')`) lub dodaj pliki do `assets/fonts/` i zdefiniuj `@font-face` z `url(assets/fonts/Inter.woff2)`.

## Pipeline
Renderer (`renderTemplate`) → generator (`generatePdfFromTemplate`) → `runPrintToPdfFromFile` → IPC `pdf:generate`.
