# Czyszczenie historii Git (jeśli były commitowane buildy)

Jeśli w historii Git są pliki `node_modules`, `dist`, `release` lub duże pliki (>50MB):

## Opcja 1: git-filter-repo

```bash
# Instalacja: pip install git-filter-repo

git filter-repo --path node_modules --invert-paths --force
git filter-repo --path dist --invert-paths --force
git filter-repo --path release --invert-paths --force
git filter-repo --path win-unpacked --invert-paths --force

git gc --prune=now --aggressive
```

## Opcja 2: BFG Repo Cleaner

```bash
# Pobierz BFG z https://rtyley.github.io/bfg-repo-cleaner/

# Usuń foldery
java -jar bfg.jar --delete-folders '{node_modules,dist,release,win-unpacked}' --no-blob-protection .

# Usuń pliki > 50MB
java -jar bfg.jar --strip-blobs-bigger-than 50M --no-blob-protection .

git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

## Po czyszczeniu

- Wymuś push (historia się zmieni): `git push --force`
- Upewnij się, że nikt inny nie pracuje na repo (force push przepisuje historię)
