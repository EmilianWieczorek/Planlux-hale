# Planlux Hale

Aplikacja offline-first dla przedstawicieli handlowych PLANLUX: wycena hal, PDF, e-mail z kolejkowaniem. Desktop (Electron) + mobile (React Native) z współdzieloną logiką w `@planlux/shared`.

## Wymagania

- Node.js 18+
- npm 9+ (workspaces)
- **Desktop (Windows):** do zbudowania `better-sqlite3` potrzebne są Visual Studio Build Tools („Desktop development with C++”). Na macOS/Linux zwykle nie jest wymagane.

## Struktura

- **docs/** – architektura, kontrakt API, schema SQLite, panel admina, checklist testów (indeks: [docs/INDEX.md](docs/INDEX.md))
- **scripts/** – skrypty pomocnicze (np. seed.sql)
- **packages/** – junction do `../packages` (shared, desktop)

## Run

**PROD** (aplikacja uruchamia się z zbudowanego pliku HTML – bez dev servera):

```bash
cd "Planlux hale"
npm install
npm run build
npm run desktop
```

**DEV** (Vite dev server + Electron, hot reload):

```bash
cd "Planlux hale"
npm run dev:desktop
```

*(Uruchamiaj z głównego folderu projektu, gdzie jest `packages/`. `Planlux-hale-analiza` zawiera dokumentację i junction do `packages/`.)*

**Login (MVP):** admin@planlux.pl / admin123 (konto admin tworzone przy pierwszym uruchomieniu)

**Weryfikacja PROD:**  
- Ekran logowania → wpisz admin@planlux.pl / admin123 → Zaloguj się  
- Kalkulator: wariant hali, wymiary, dodatki → Synchronizuj bazę (wymaga internetu) → Generuj PDF  
- Historia: zakładki PDF / E-mail  
- Panel admina (tylko dla ADMIN): użytkownicy, aktywność  
- Banner OFFLINE gdy brak internetu  
- DevTools (F12): Console bez błędów, Network – assets z 200

## Backend

URL Web App (Google Apps Script):  
`https://script.google.com/macros/s/AKfycbzOCqNNK5c2trwE-Q-w6ti89Q-Img8IxH5axqLZImPLFNF3zyPCtqHE0lOKMYnuwt8H/exec`

- `GET ?action=meta` – wersja bazy  
- `GET ?action=base` – pełna baza (cennik, dodatki, standard)  
- `POST` body: `{ "action": "logPdf" | "logEmail" | "heartbeat", "payload": { ... } }`

Szczegóły: **docs/API_CONTRACT.md**.

## Kluczowe moduły (shared)

| Moduł | Opis |
|-------|------|
| **sync/pricingSync** | Pobiera META → jeśli version > lokalna → GET base → zapis do cache |
| **sync/outbox** | Kolejka SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT; flush z retry/backoff |
| **pricing/pricingEngine** | Wycena: dopasowanie cennika (wariant + area + width), dodatki z warunkami, standard w cenie |
| **pdf/template + generator** | HTML „Oferta Planlux Hale” → PDF (host dostarcza printToPdf). **Desktop:** jedna oficjalna ścieżka: `electron/pdf/renderTemplate.ts` → `generatePdfFromTemplate.ts` → `generatePdf.ts` (printToPDF); wejście: `GeneratePdfPayload` (shared). |
| **email/smtpSender + credentials** | SMTP (CyberFolks); hasła tylko w systemowym sejfie |

## Testy

Checklist: **docs/TEST_CHECKLIST.md**.

## Licencja

Wewnętrzne użycie PLANLUX.
