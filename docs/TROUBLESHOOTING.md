# Planlux Hale – Rozwiązywanie problemów

## Build i uruchomienie

### „Nie znaleziono index.html”
**Objaw:** Błąd przy starcie aplikacji.

**Rozwiązanie:**
1. Uruchom `npm run build`
2. Upewnij się, że `packages/desktop/dist/renderer/index.html` istnieje

### „Module not found” / błędy importów
**Rozwiązanie:**
```bash
npm run clean
npm install
npm run build
```

### Build Electron kończy się błędem
- Sprawdź Node.js 20 LTS
- Usuń `packages/desktop/node_modules` i `npm install`
- Dla `better-sqlite3`: `npx electron-rebuild` w `packages/desktop`

---

## PDF

### PDF nie generuje się / crash
**Diagnostyka:**
- Otwórz konsolę (F12) → zakładka Console
- Szukaj wpisów `[pdf] DIAGNOSTYKA`
- Logi zawierają: clientName, widthM, lengthM, offerNumber, stack trace

**Częste przyczyny:**
1. Brak szablonu: `packages/desktop/assets/pdf-template/Planlux-PDF/index.html`
2. Brak assetów (logo, ikony) w `Planlux-PDF/assets/`
3. Timeout 20s – za duży dokument lub wolny dysk

### Podgląd PDF pusty / biały
- Sprawdź, czy dane oferty są kompletne (wymiary, klient)
- W dev: `planlux:generatePdfPreview` zwraca base64 – sprawdź odpowiedź w Network
- Fonty: szablon używa local (Inter, Segoe UI, Arial) – bez Google CDN

---

## Numeracja ofert

### „TEMP” zamiast PLX-...
- **Online:** backend (Google Apps Script) musi zwracać numer przy `reserveOfferNumber`
- **Offline:** TEMP-{deviceId}-{timestamp} jest oczekiwane
- Po powrocie online: `syncTempOfferNumbers` zamienia TEMP na PLX

### Duplikaty numerów
- Każda nowa oferta powinna używać `createOffer` lub `getNextOfferNumber`
- `saveOfferDraft` nie generuje już numerów TEMP – wymaga wcześniejszego `createOffer`

---

## Panel admina

### Błąd przy tworzeniu użytkownika
- Sprawdź rolę: USER, SALESPERSON, BOSS, MANAGER, ADMIN
- Stary CHECK constraint: uruchom migrację (restart aplikacji) – tabela `_migrations` dodaje BOSS

### Snackbar pokazuje błąd
- Błędy z IPC są przekazywane w `error` – pełna treść w konsoli (F12)

---

## Auto-update

### Nie wykrywa aktualizacji
- Wymaga GitHub Release z tagiem `v*` (np. v1.0.0)
- `latest.yml` musi być w Release (electron-builder to publikuje)
- Działa tylko w buildzie produkcyjnym (nie w `npm run dev:desktop`)

### „Pobierz” / „Uruchom ponownie” nie działa
- Sprawdź uprawnienia do zapisu w katalogu aplikacji
- Antywirus może blokować pobieranie – dodaj wyjątek

---

## Baza danych

### Plik .db uszkodzony
- Backup: `%APPDATA%/planlux-hale/planlux-hale.db` (Windows)
- Usunięcie pliku: nowa baza, utrata danych

### Migracje
- Migracje uruchamiane przy pierwszym `getDb()`
- Tabela `_migrations` – rejestr wykonanych migracji
