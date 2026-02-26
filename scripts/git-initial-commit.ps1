# Skrypt do wykonania initial commit – uruchom w terminalu z zainstalowanym Git
# Uruchom: .\scripts\git-initial-commit.ps1
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Git status przed add..."
git status

Write-Host "`nDodawanie plikow (git add .)..."
git add .

Write-Host "`nStatus po add – sprawdz czy node_modules/dist/release NIE sa staged:"
git status

$staged = git diff --cached --name-only
if ($staged -match "node_modules|\\dist\\|release\\|win-unpacked") {
    Write-Host "UWAGA: node_modules, dist lub release sa w staged! Popraw .gitignore." -ForegroundColor Red
    exit 1
}

Write-Host "`nCommituje..."
git commit -m "Initial commit – Planlux Hale clean root repo"

Write-Host "`nGotowe. git status:"
git status
