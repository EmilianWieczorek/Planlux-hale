# Test manualny: sprawdzanie aktualizacji i historia (Apps Script)

## Wymagania
- Aplikacja Planlux Hale (desktop).
- Zmienna środowiskowa `PLANLUX_UPDATES_URL` = pełny URL do Apps Script Web App `/exec` (bez parametrów).
- Apps Script endpointy:
  - `GET ?action=version` → `{ ok, latest, minSupported, force, message, downloadUrl, checkIntervalMin, serverTime }`
  - `GET ?action=history` → `{ ok, items: [{ version, date, title, message, force, downloadUrl }] }`

## Kroki testu

### 1) Ustaw wyższą wersję (banner)
- W Apps Script ustaw odpowiedź `action=version` tak, aby `latest` była wyższa niż `app.getVersion()` (np. current 1.0.0 → latest 1.0.1).
- Uruchom aplikację, zaloguj się.
- Po ok. 5 s powinien pojawić się **banner** u góry: „Dostępna aktualizacja X.Y.Z” z przyciskami [Pobierz] [Później].

### 2) „Później” i suppressedUntil
- Kliknij **Później** w bannerze.
- Banner znika.
- Odśwież stronę / uruchom ponownie aplikację w tym samym oknie – banner **nie** powinien się pokazać przed upływem `checkIntervalMin` (domyślnie 360 min), bo zapisano `suppressedUntil` w `localStorage` pod kluczem `planlux-updates-suppressed`.
- (Opcjonalnie) Wyczyść `localStorage` dla tej aplikacji i odśwież – banner powinien wrócić przy następnym sprawdzeniu.

### 3) Modal blokujący (force)
- W Apps Script ustaw w odpowiedzi `action=version`: `force: true` (albo ustaw `minSupported` wyżej niż aktualna wersja).
- Uruchom aplikację (albo wyczyść `localStorage` i odśwież).
- Powinien pojawić się **modal** „Aktualizacja wymagana”, bez możliwości zamknięcia (tylko przycisk [Pobierz aktualizację]).
- Kliknięcie [Pobierz aktualizację] otwiera `downloadUrl` w domyślnej przeglądarce (IPC `planlux:app:openExternal`).

### 4) Zakładka „Aktualizacje”
- Panel admina → zakładka **Aktualizacje**.
- Sprawdź: wyświetla się „Aktualna wersja” (z `app.getVersion()`), opcjonalnie „Najnowsza wersja” po sprawdzeniu.
- Przycisk **Sprawdź aktualizacje** – wywołuje ten sam mechanizm co start (banner/modal w MainLayout).
- Przycisk **Pobierz najnowszą wersję** – otwiera `downloadUrl` z odpowiedzi version.
- **Historia aktualizacji** – lista z tabeli (min. 10 wpisów): Wersja, Data, Tytuł, Opis, przycisk Pobierz (dla każdego wpisu: `item.downloadUrl` lub fallback `downloadUrl` z version).

### 5) Offline / błąd
- Odłącz sieć lub ustaw błędny `PLANLUX_UPDATES_URL`.
- Uruchom aplikację – **nie** powinno być spamu błędów; sprawdzanie jest cicho pomijane (opcjonalny log debug).

## Lista zmian (commitów)

- **shared**: `compareSemver`, `isUpdateAvailable`, `isBelowMinSupported` w `utils/semver.ts`.
- **desktop config**: `updatesUrl` z `PLANLUX_UPDATES_URL`.
- **IPC (ipc.ts)**: `planlux:app:getVersion`, `planlux:app:openExternal`, `planlux:app:getUpdatesUrl`.
- **main.ts**: przekazanie `updatesUrl` do `registerIpcHandlers`.
- **preload**: kanały app + `planlux.app.getVersion()`, `openExternal(url)`, `getUpdatesUrl()`.
- **MainLayout**: sprawdzanie wersji 5 s po starcie, banner (Pobierz / Później), modal force (tylko Pobierz), event `planlux-run-update-check`.
- **AdminPanel**: zakładka „Aktualizacje”, `AdminUpdatesTab`.
- **AdminUpdatesTab**: aktualna/najnowsza wersja, przycisk Sprawdź (dispatch event), Pobierz, tabela historii z `action=history`.
