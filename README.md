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

### Zmienne środowiskowe (dev)

W trybie deweloperskim aplikacja ładuje `.env` z katalogu głównego lub `packages/desktop/`. Skopiuj `.env.example` do `.env` i uzupełnij w razie potrzeby:

| Zmienna | Opis | Domyślnie (dev) |
|--------|------|------------------|
| `SUPABASE_URL` | URL projektu Supabase (health / auth) | – |
| `SUPABASE_ANON_KEY` | Klucz anon Supabase | – |
| `PLANLUX_BACKEND_URL` | Opcjonalnie: inny URL (np. updates) | – |
| `SESSION_TTL_HOURS` | Czas życia sesji (godz.) | 12 |
| `ONLINE_TIMEOUT_MS` | Limit czasu health check (ms) | 2000 |
| `ADMIN_INITIAL_EMAIL` | E-mail pierwszego admina (seed) | admin@planlux.pl |
| `ADMIN_INITIAL_PASSWORD` | Hasło seed (min. 8 znaków, litera + cyfra) | losowe w dev |
| `LOG_LEVEL` | Poziom logów: debug, info, warn, error | debug (dev), info (prod) |

**Uwaga:** W produkcji (zbudowana aplikacja) konfiguracja pochodzi ze zmiennych środowiskowych systemu/instalatora; plik `.env` jest używany tylko w dev.

## Build produkcyjny

```bash
# Budowa instalatora Windows (.exe) – bez wine/signing
npm run dist:win

# Wynik: packages/desktop/release/Planlux Hale Setup {version}.exe
# Rozpakowana aplikacja: packages/desktop/release/win-unpacked/
```

**Podpisywanie (opcjonalne):** Domyślnie build nie wymaga certyfikatu ani Wine. Aby podpisać instalator w CI, ustaw zmienne środowiskowe przed wywołaniem `electron-builder`:

- `WIN_CSC_LINK` – ścieżka lub base64 do certyfikatu (.pfx/.p12)
- `WIN_CSC_KEY_PASSWORD` – hasło do certyfikatu

Skrypt `dist:win` ustawia `CSC_IDENTITY_AUTO_DISCOVERY=false`, dzięki czemu przy braku certyfikatu podpisywanie jest pomijane.

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
