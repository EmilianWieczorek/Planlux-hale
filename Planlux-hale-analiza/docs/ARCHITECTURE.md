# Planlux Hale – Architektura projektu

## 1. Przegląd

Aplikacja **offline-first** dla przedstawicieli handlowych PLANLUX: wycena hal, generowanie PDF, wysyłka e-mail z kolejkowaniem. Działa na **Electron (desktop)** oraz **React Native (mobile)** z współdzieloną logiką w pakiecie `shared`.

### Wybór technologii

| Platforma | Technologia | Uzasadnienie |
|-----------|-------------|--------------|
| **Desktop** | Electron | Jedna codebase z mobile (JS/TS), natywny SQLite, dostęp do Credential Vault, dojrzały ekosystem. |
| **Mobile** | React Native | Współdzielony TypeScript z Electron, darmowy start, natywne moduły (SQLite, Keychain/Keystore), jedna logika biznesowa. |
| **Shared** | TypeScript (Node-compatible) | Pricing, sync, outbox, parsowanie bazy – bez zależności od UI. |

**Dlaczego nie PWA:** Wymagana instalacja, pełny offline, dostęp do systemowego magazynu haseł (SMTP) i SQLite – PWA ma ograniczenia w tych obszarach.

---

## 2. Struktura projektu (monorepo)

```
planlux-hale/
├── package.json                 # workspace root (npm workspaces)
├── docs/
│   ├── ARCHITECTURE.md          # ten plik
│   ├── API_CONTRACT.md          # kontrakt backendu
│   └── TEST_CHECKLIST.md        # checklist testów
├── packages/
│   ├── shared/                  # logika współdzielona (desktop + mobile)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── db/
│   │   │   │   ├── schema.ts    # definicja tabel (runtime)
│   │   │   │   ├── migrations/  # SQL migracje
│   │   │   │   └── index.ts     # factory DB (inject driver)
│   │   │   ├── api/
│   │   │   │   ├── client.ts     # wywołania do Apps Script
│   │   │   │   └── types.ts     # request/response
│   │   │   ├── sync/
│   │   │   │   ├── pricingSync.ts   # pobieranie META + bazy
│   │   │   │   └── outbox.ts        # kolejka + flush
│   │   │   ├── pricing/
│   │   │   │   ├── pricingEngine.ts  # wycena (base + dodatki + standard)
│   │   │   │   ├── normalize.ts     # parsowanie liczb z bazy
│   │   │   │   └── types.ts
│   │   │   ├── pdf/
│   │   │   │   ├── generator.ts     # HTML → PDF (offline)
│   │   │   │   └── template.ts      # szablon oferty
│   │   │   ├── email/
│   │   │   │   ├── smtpSender.ts    # wysyłka SMTP
│   │   │   │   └── credentials.ts   # abstrakcja sejfu (Vault/Keychain)
│   │   │   └── auth/
│   │   │       └── types.ts         # role, sesja
│   │   └── sql/
│   │       └── schema.sql       # pełna definicja SQLite
│   │
│   ├── desktop/                # Electron
│   │   ├── package.json
│   │   ├── electron/
│   │   │   ├── main.ts          # proces główny, okno, menu
│   │   │   ├── preload.ts       # bridge do renderera
│   │   │   └── dbBridge.ts      # SQLite w main process
│   │   ├── src/                 # React UI (renderer)
│   │   │   ├── App.tsx
│   │   │   ├── flows/           # Klient → Konfiguracja → Dodatki → Podsumowanie → PDF → Email
│   │   │   ├── admin/           # panel admina
│   │   │   └── hooks/           # useSync, usePricing, useOutbox
│   │   └── resources/           # ikony, szablony
│   │
│   └── mobile/                 # React Native (opcjonalnie w MVP drugi etap)
│       ├── package.json
│       ├── src/
│       │   ├── App.tsx
│       │   ├── flows/           # te same ekrany co desktop (adaptowane)
│       │   └── native/          # Keychain, SQLite driver
│       └── android/ + ios/
│
└── scripts/
    └── seed.sql                 # opcjonalne dane testowe
```

---

## 3. Moduły i zależności

- **shared** – zero zależności od Electron/React Native; przyjmuje przez dependency injection: `fetch`, ścieżka do pliku SQLite, funkcja „zapisz/odczytaj credentials” (platform-specific).
- **desktop** – zależy od `shared`; Electron używa `better-sqlite3` w main process; credentials przez `keytar` (Windows Credential Manager / macOS Keychain).
- **mobile** – zależy od `shared`; React Native używa `react-native-sqlite-storage` lub `expo-sqlite`; credentials przez `react-native-keychain`.

---

## 4. Przepływ danych (offline-first)

1. **Start aplikacji**  
   - Inicjalizacja SQLite (users, offers, pricing_cache, pdfs, emails, outbox, activity).  
   - Jeśli online: `GET meta` → jeśli `version` > lokalna `pricing_version` → `GET base` → zapis do `pricing_cache`.  
   - Flush outbox (kolejno: SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT) z retry/backoff.

2. **Wycena**  
   - Dane z lokalnego `pricing_cache` (cennik, dodatki, standard).  
   - pricingEngine: area = width × length; dopasowanie wiersza cennika po wariantcie i area (area_min_m2–area_max_m2); fallback przy area powyżej/poniżej zakresów; dodatki z warunkami (np. HEIGHT_RANGE); standard „w cenie” w podsumowaniu.

3. **PDF**  
   - Generacja offline z szablonu HTML → PDF; zapis do folderu lokalnego; wpis w `pdfs`; enqueue `LOG_PDF` do outbox.

4. **E-mail**  
   - Jeśli online i są dane SMTP w sejfie: wysyłka od razu + enqueue `LOG_EMAIL`.  
   - Jeśli offline lub brak SMTP: enqueue `SEND_EMAIL` + `LOG_EMAIL` (po wysłaniu).

5. **Aktywność**  
   - Co 60–120 s: enqueue `HEARTBEAT` (lub wysyłka od razu gdy online). Offline: zapis lokalny, później flush.

---

## 5. Plan wdrożenia MVP

### Faza 1: Desktop first (Electron + shared)

1. **Tydzień 1 – fundament**  
   - Monorepo (npm workspaces), `shared` z TypeScript.  
   - Schema SQLite + migracje, inicjalizacja DB w Electron (main).  
   - Kontrakt API: klient w `shared` (GET meta, GET base, POST logPdf, logEmail, heartbeat).  
   - Sync: pobieranie META → porównanie version → pobieranie base → zapis do `pricing_cache`.

2. **Tydzień 2 – wycena i PDF**  
   - pricingEngine (dopasowanie cennika, dodatki z warunkami, standard w cenie).  
   - Normalizacja liczb (string → number) z bazy.  
   - Generator PDF (HTML template → PDF), zapis lokalny, wpis do `pdfs` i outbox LOG_PDF.

3. **Tydzień 3 – e-mail i outbox**  
   - Outbox: kolejka operacji, flush przy połączeniu, idempotency (np. id operacji).  
   - SMTP sender (CyberFolks), credentials z keytar (desktop).  
   - Fallback: brak SMTP → tylko outbox SEND_EMAIL.

4. **Tydzień 4 – UX i admin**  
   - Flow: Klient → Konfiguracja hali → Dodatki → Podsumowanie → PDF → Wyślij email.  
   - Historia (PDF/email) per user, filtry.  
   - Panel admin: użytkownicy, aktywność, historia globalna (odczyt z API/Sheets lub z lokalnego serwisu – patrz niżej).

### Faza 2: Mobile (React Native)

5. **Tydzień 5–6**  
   - Projekt RN z tym samym `shared`.  
   - Adaptery: SQLite (expo-sqlite / react-native-sqlite-storage), Keychain (react-native-keychain).  
   - UI uproszczone pod telefon (te same ekrany, responsywne).  
   - Testy na urządzeniu (Android/iOS).

### Uwaga o panelu admina

- **Opcja A:** Admin loguje się do tej samej aplikacji z rolą ADMIN; dane aktywności/historii pobiera z backendu (Apps Script zwraca dane z Sheets – arkusze HISTORIA_PDF, HISTORIA_EMAIL, USERS, ACTIVITY).  
- **Opcja B:** Osobna „admin app” lub ten sam build z routingiem /admin.  
Rekomendacja: ten sam build, route `/admin`; backend udostępnia endpointy typu `GET history?token=adminToken` (tylko dla zalogowanego ADMIN).

---

## 6. Bezpieczeństwo (skrót)

- Hasła do aplikacji: hash (bcrypt/argon2) w SQLite; reset hasła: token/OTP przez email (minimalny flow).  
- Hasła SMTP: tylko w systemowym sejfie (Windows Credential Vault / macOS Keychain / Android Keystore / iOS Keychain); nigdy w Sheets ani w backendzie.  
- Endpoint Apps Script: możliwość zabezpieczenia tokenem (np. header `X-App-Token`) dla operacji zapisu.  
- RODO: przechowywanie tylko danych koniecznych (np. nazwa klienta, email, oferta); bez zbędnych danych osobowych.

---

## 7. Migracja w przyszłości (Postgres/Supabase)

- Warstwa dostępu do danych w `shared` abstrahowana (np. `PdfRepository`, `EmailRepository`).  
- Dziś: implementacja na SQLite.  
- Później: drugi backend (Supabase/Postgres) z tymi samymi interfejsami; sync może nadal startować od META z Apps Script lub przełączyć na Postgres API.
