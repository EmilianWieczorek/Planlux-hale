# Planlux Hale

Kalkulator i CRM ofert hal stalowych – aplikacja Electron.

## Struktura

- `packages/desktop` – aplikacja Electron (kalkulator, CRM, PDF)
- `packages/shared` – biblioteka współdzielona (API, cennik, PDF)

## Skrypty

```bash
npm run build          # Buduje wszystkie pakiety
npm run desktop        # Uruchamia aplikację Electron
npm run dev:desktop    # Tryb deweloperski (Vite + Electron)
npm run dist:win       # Buduje instalator Windows
```

## Wymagania

- Node.js 18+
- npm 9+
