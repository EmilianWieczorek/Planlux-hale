# Architektura produkcyjna – Planlux Hale

## Struktura katalogów (docelowa)

```
planlux-hale/
├── packages/
│   ├── desktop/           # Aplikacja Electron
│   │   ├── electron/      # Main process (Node.js)
│   │   │   ├── main.ts
│   │   │   ├── preload.ts
│   │   │   ├── ipc.ts
│   │   │   └── ...
│   │   ├── renderer/      # Frontend (React + Vite)
│   │   │   └── src/
│   │   ├── src/           # Shared desktop logic
│   │   ├── assets/
│   │   ├── electron-builder.yml
│   │   └── package.json
│   ├── shared/            # Współdzielona logika
│   │   └── ...
│   └── mobile/            # (opcjonalnie)
├── assets/                # Zasoby globalne
├── scripts/               # Skrypty build/clean
├── docs/                  # Dokumentacja
├── .github/
│   └── workflows/
│       └── release.yml
├── .husky/
│   └── commit-msg
├── .releaserc.json
├── commitlint.config.js
├── CHANGELOG.md
└── package.json
```

## Wersjonowanie (SemVer)

- **MAJOR**: Zmiany niekompatybilne wstecz
- **MINOR**: Nowe funkcje, kompatybilne
- **PATCH**: Poprawki błędów

Źródło wersji: `packages/desktop/package.json` (bumpowane przez semantic-release).

## Flow release

1. Commit na `main` (np. `feat: nowa funkcja`)
2. **Semantic-release** (na push do main):
   - analiza Conventional Commits
   - bump wersji
   - generacja CHANGELOG
   - commit + tag (np. `v1.1.0`)
3. **Tag push** uruchamia build Electron:
   - `npm ci`, `npm run build`
   - `electron-builder --win --publish always`
   - publikacja do GitHub Release (instalator + `latest.yml`)
4. **Auto-update** w aplikacji:
   - przy starcie: `checkForUpdatesAndNotify()`
   - dostępność → modal „Nowa wersja”
   - pobranie w tle → restart do aktualizacji

## Komponenty bezpieczeństwa

| Aspekt          | Implementacja                                   |
|-----------------|--------------------------------------------------|
| contextIsolation | `true` w webPreferences                         |
| nodeIntegration | `false`                                         |
| IPC             | contextBridge + walidacja w handlerach          |
| Role            | USER, SALESPERSON, MANAGER, ADMIN               |
| Baza            | SQLite lokalna (opcja: SQLCipher)              |

## Deployment

- **Dystrybucja**: GitHub Releases
- **Aktualizacje**: electron-updater (GitHub)
- **Instalator**: NSIS, `.exe` dla Windows x64
