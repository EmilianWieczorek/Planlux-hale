# Podpis cyfrowy (Windows) – Planlux Hale

## Cel

Podpisany instalator `.exe` zmniejsza ostrzeżenia SmartScreen i buduje zaufanie użytkowników.

## Wymagania

- Certyfikat EV Code Signing (np. DigiCert, Sectigo) – ok. 300–500 EUR/rok
- lub certyfikat Standard Code Signing – niższa cena, ale większe ostrzeżenia na nowych instalacjach

## Krok 1: Zakup certyfikatu .pfx

1. Złóż zamówienie u CA (np. DigiCert, Sectigo, Certum).
2. Przejdź weryfikację firmy.
3. Odbierz plik `.pfx` i hasło do klucza.

## Krok 2: Konfiguracja CI/CD (GitHub Actions)

### Sekrety w repozytorium

W **Settings → Secrets and variables → Actions** dodaj:

| Secret           | Wartość                         | Uwagi                          |
|-----------------|----------------------------------|--------------------------------|
| `CSC_LINK`      | Base64 certyfikatu .pfx         | `base64 -w0 certificate.pfx`  |
| `CSC_KEY_PASSWORD` | Hasło do pliku .pfx         | -                              |

### Konwersja pliku .pfx do Base64 (PowerShell)

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ścieżka\do\certyfikatu.pfx"))
```

Skopiuj wynik i wklej jako wartość `CSC_LINK`.

### Alternatywa: plik w repozytorium

Nie zalecane – klucz prywatny byłby w repo.

## Krok 3: Włączanie podpisu w workflow

W pliku `.github/workflows/release.yml` odkomentuj:

```yaml
env:
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
```

## Krok 4: Build lokalny

```powershell
$env:CSC_LINK = "base64_certyfikatu"
$env:CSC_KEY_PASSWORD = "haslo"
npm run dist:win
```

Lub użyj pliku .pfx bezpośrednio:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "haslo"
npm run build -w packages/desktop
npx electron-builder --win --publish never --projectDir packages/desktop
```

## Weryfikacja podpisu

Po zbudowaniu:

```powershell
signtool verify /pa "packages\desktop\release\Planlux-Hale-1.0.0.exe"
```

Lub sprawdź właściwości pliku .exe → „Podpis cyfrowy”.
