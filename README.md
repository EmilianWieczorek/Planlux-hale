# Planlux Hale

Kalkulator i CRM ofert hal stalowych – aplikacja Electron (enterprise-grade).

## Struktura projektu

```
.
├── .github/workflows/    # CI/CD (semantic-release, build Electron)
├── docs/                 # Dokumentacja
├── packages/
│   ├── desktop/          # Aplikacja Electron
│   │   ├── electron/     # Main process, IPC, PDF
│   │   ├── renderer/     # React UI (Vite)
│   │   ├── assets/       # Ikony, szablony PDF
│   │   └── src/          # Infrastruktura (DB, sync)
│   └── shared/           # Biblioteka współdzielona (API, cennik, typy)
├── scripts/              # Skrypty pomocnicze
└── package.json          # Monorepo (workspaces)
```

## Wymagania

- **Node.js** 20 LTS (zalecane)
- **npm** 9+

## Uruchomienie

```bash
# Instalacja zależności
npm install

# Tryb deweloperski (Vite + Electron)
npm run dev:desktop

# Uruchomienie zbudowanej aplikacji
npm run build
npm run desktop
```

## Build produkcyjny

```bash
# Budowa instalatora Windows (.exe)
npm run dist:win

# Wynik: packages/desktop/release/Planlux-Hale-{version}.exe
```

## Strategia gałęzi

- **main** – gałąź produkcyjna
  - Push do `main` → semantic-release analizuje commity → bump wersji, changelog, tag (v1.0.0)
  - Tag `v*` → GitHub Actions buduje Electron → publikuje do GitHub Release
- **feature/** – nowe funkcje
- **fix/** – poprawki błędów

## Konwencja commitów (Conventional Commits)

Wymagana przez semantic-release:

```
feat: nowa funkcja
fix: poprawka błędu
refactor: refaktoryzacja
perf: optymalizacja
docs: dokumentacja
build: zmiany builda
chore: inne
```

## Wersjonowanie

- **SemVer** (MAJOR.MINOR.PATCH)
- Bump automatyczny przez semantic-release na podstawie commitów
- `feat:` → MINOR, `fix:` → PATCH, `BREAKING CHANGE` → MAJOR

## Auto-update

- Aplikacja sprawdza aktualizacje przy starcie (produkcja)
- Pobieranie w tle (autoDownload)
- Modal „Nowa wersja dostępna” → restart do instalacji

## Bezpieczeństwo

- `contextIsolation: true`, `nodeIntegration: false`
- Walidacja ról (USER, BOSS, ADMIN)
- CSP w rendererze

## Rozwiązywanie problemów

### Build nie działa
- Uruchom `npm run clean` i `npm install`
- Sprawdź wersję Node: `node -v` (wymagane 18+)

### PDF się nie generuje
- Sprawdź logi w konsoli (F12) lub w katalogu logów
- Upewnij się, że istnieje `packages/desktop/assets/pdf-template/Planlux-PDF/`
- Przy błędzie zobacz logi `[pdf] DIAGNOSTYKA`

### Auto-update nie działa
- Wymaga opublikowanego release w GitHub (tag v*)
- Działa tylko w wersji produkcyjnej (nie w dev)

## Kontakt

Planlux – system CRM dla handlowców hal stalowych.
