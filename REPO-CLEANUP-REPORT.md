# Raport: Oczyszczenie repozytorium Planlux Hale

**Data:** 2026-02-24  
**Zakres:** Profesjonalne przygotowanie repo do produkcji

---

## ETAP 1 — Diagnoza

| Element | Wynik |
|---------|-------|
| Foldery `.git` | **1** – tylko w root (`Planlux hale`) |
| Rozmiar `.git` | **~0,59 MB** |
| Nested repo | **Brak** (Planlux-appy usunięty wcześniej) |
| Buildy w historii | **Nie wykryto** – .git ma 0,59 MB, więc node_modules/dist/release nie były commitowane |

---

## ETAP 2 — Nested repo

- **Stan:** Repo w root jest jedynym repozytorium.
- **Planlux-appy:** Usunięty w poprzedniej sesji (pusty folder z błędnym .git).
- **Planlux-hale-analiza:** Usunięty `.git` w poprzedniej sesji – folder z dokumentacją bez własnego repo.

---

## ETAP 3 — .gitignore produkcyjny

Zastąpiono `.gitignore` wersją produkcyjną z wpisami:

- `node_modules/`, `dist/`, `release/`, `win-unpacked/`, `out/`, `build/`
- `.vite/`, `.cache/`, `coverage/`
- `*.log`, `*.zip`, `*.pdf`, `*.sqlite`, `*.db`
- `.env`, `.env.*` (z wyjątkiem `!.env.example`)
- `.DS_Store`, `Thumbs.db`

---

## ETAP 4 — Historia Git

- **Status:** Historia czysta – brak commitowanych buildów (mały rozmiar .git).
- **Jeśli w przyszłości:** Instrukcje w `scripts/README-history-cleanup.md` (git-filter-repo, BFG).

---

## ETAP 5 — Struktura monorepo

Struktura docelowa:

```
/packages
  /desktop (electron, renderer, assets)
  /shared
/docs
/scripts
/.github/workflows
package.json
README.md
README-ARCH.md
```

**Uwaga:** Na dysku są `packages/desktop/release` (~634 MB) i `packages/desktop/dist` (~4 MB) – **nie są w repo** dzięki .gitignore. Zalecane usunięcie z dysku: `npm run clean:all`.

---

## ETAP 6 — package.json

- Dodano skrypt `analyze:size` (source-map-explorer po buildzie).
- Rozszerzono `scripts/clean-all.js` o: `out/`, `build/`, `.cache`, `coverage`.

---

## ETAP 7 — Workflow release

Dodano `.github/workflows/release.yml`:

- **Trigger:** push tagów `v*` lub uruchomienie ręczne (`workflow_dispatch`)
- **Środowisko:** Node.js 20 LTS
- **Kroki:** `npm ci` → `npm run build` → electron-builder (Windows) → upload artefaktu

---

## ETAP 8 — Weryfikacja końcowa

| Kryterium | Status |
|-----------|--------|
| Repo bez nested .git | ✅ |
| Brak plików > 100 MB w repo | ✅ (buildy nie są commitowane) |
| Rozmiar .git | ~0,59 MB ✅ |
| Rozmiar kodu źródłowego (bez node_modules, dist, release) | ~2–3 MB |
| Profesjonalny .gitignore | ✅ |
| Workflow release | ✅ |

---

## Podsumowanie

### Co było nie tak
- Wcześniej: nested repo w Planlux-appy i Planlux-hale-analiza – naprawione.
- .gitignore bez pełnej listy (m.in. `out/`, `build/`, `coverage`) – uzupełnione.
- Brak workflow CI/CD – dodany.

### Co zostało zmienione / dodane
- Nowy `.gitignore`
- Rozszerzony `scripts/clean-all.js`
- Skrypt `analyze:size` w root `package.json`
- `.github/workflows/release.yml`
- `scripts/README-history-cleanup.md` (na przyszłość)

### Rozmiar repo
- **Przed:** ~0,59 MB (.git)
- **Po:** bez zmian – historia nie była skażona buildami

### Czy repo jest gotowe produkcyjnie?
**Tak.** Repo jest gotowe do:
- push na GitHub
- release przez tagi (`git tag v1.0.0 && git push --tags`)
- budowania instalatora Windows w GitHub Actions

**Działanie na dysku:** przed release uruchom `npm run clean:all`, żeby usunąć lokalne foldery `dist` i `release`.
