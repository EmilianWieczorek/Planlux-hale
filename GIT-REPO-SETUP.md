# Naprawa struktury Git – Planlux Hale

## Co zostało wykonane

### ETAP 1 – Diagnoza
- **Root** (`Planlux hale`): ma `.git` ✅
- **Planlux-appy** (podfolder): miał własne `.git` (repo w repo) ❌
- **Planlux-hale-analiza**: miał własne `.git` (repo w repo) ❌

### ETAP 2 – Usunięcie złego repo
- Usunięto folder `Planlux-appy/.git`
- Usunięto `Planlux-appy/.gitattributes`
- Usunięto pusty folder `Planlux-appy` (po usunięciu .git był pusty)

### ETAP 3 – Nested repo
- Usunięto `Planlux-hale-analiza/.git` – folder analizy pozostaje, ale bez własnego repo

### ETAP 4 – .gitignore
Zaktualizowano `.gitignore` o:
- `node_modules/`, `dist/`, `release/`, `win-unpacked/`
- `.vite/`, `.cache/`, `coverage/`
- `*.log`, `*.zip`, `*.pdf`
- `.env`, `*.sqlite`, `*.db`
- `.DS_Store`, `Thumbs.db`

---

## Co musisz zrobić (Git w środowisku)

W terminalu, w folderze projektu:

```powershell
cd "c:\Users\emilw\Desktop\Planlux hale"

# Sprawdź status
git status

# Dodaj pliki (gitignore wykluczy node_modules, dist, release)
git add .

# Zweryfikuj – node_modules, dist, release NIE powinny być na liście
git status

# Commit
git commit -m "Initial commit – Planlux Hale clean root repo"

# Przygotowanie do push na GitHub
git remote add origin https://github.com/TWOJ_USER/Planlux-Hale.git
git branch -M main
git push -u origin main
```

Możesz też uruchomić skrypt: `.\scripts\git-initial-commit.ps1`

---

## Struktura docelowa

```
Planlux hale/
├── .git/                 # jedno repo w root
├── .gitignore
├── package.json
├── package-lock.json
├── README.md
├── README-ARCH.md
├── packages/
│   ├── desktop/
│   └── shared/
├── Planlux-hale-analiza/  # docs (bez .git)
│   └── docs/
├── scripts/
└── docs/                 # opcjonalnie
```

---

## Gotowe do push na GitHub?

Tak, po wykonaniu `git add .`, `git commit` i dodaniu remote. Upewnij się, że:
1. `node_modules` NIE jest w repo
2. `dist` i `release` NIE są w repo
3. Repo ma rozmiar kilku MB (tylko kod źródłowy)
