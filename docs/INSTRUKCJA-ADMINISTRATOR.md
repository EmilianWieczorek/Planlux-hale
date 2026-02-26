# Instrukcja dla administratora – Planlux Hale

## Wymagania

- Node.js 20 LTS
- npm 10+
- Windows 10/11 (dla lokalnego builda .exe)

## Konfiguracja repozytorium

1. Sklonuj repozytorium.
2. Zaktualizuj `packages/desktop/package.json` – pole `repository` musi wskazywać na właściwy adres GitHub (np. `https://github.com/TWOJA-ORG/planlux-hale.git`).
3. Zainstaluj zależności: `npm install`
3. Zainicjuj Husky (jeśli nie zrobione): `npx husky init`
4. Upewnij się, że główna gałąź to `main`.

## Tworzenie release

### Automatycznie (zalecane)

1. Merge commitów do `main`:
   ```
   feat: dodana eksport PDF ofert
   fix: poprawka licznika numerów
   ```
2. Push: `git push origin main`
3. GitHub Actions uruchomi semantic-release i build.
4. Po ok. 5–10 minut: nowy release z instalatorem na GitHub.

### Ręcznie

```bash
npm run release
```

Uwaga: semantic-release wypchnie tag. Workflow na tagi zbuduje instalator.

## Konwencja commitów ( Conventional Commits)

| Typ       | Opis                               |
|----------|-------------------------------------|
| `feat:`  | Nowa funkcja (bump MINOR)          |
| `fix:`   | Poprawka błędu (bump PATCH)        |
| `refactor:` | Refaktorowanie                   |
| `perf:`  | Optymalizacje                      |
| `docs:`  | Dokumentacja                       |
| `build:` | Zmiany w buildzie                  |
| `chore:` | Różne                              |

Przykład: `feat(kalkulator): eksport do Excel`

## Podpis cyfrowy

Zobacz: [PODPIS-CYFROWY.md](./PODPIS-CYFROWY.md)

## Sekrety GitHub

- `GITHUB_TOKEN` – domyślny, wystarczający do release.
- Opcjonalnie: `CSC_LINK`, `CSC_KEY_PASSWORD` – dla podpisu .exe.
