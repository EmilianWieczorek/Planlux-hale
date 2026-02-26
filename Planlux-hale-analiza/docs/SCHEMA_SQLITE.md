# Model danych SQLite – Planlux Hale

## Tabele i pola

| Tabela | Opis | Kluczowe pola |
|--------|------|----------------|
| **users** | Użytkownicy aplikacji (handlowcy + admin) | id, email, password_hash, role (USER/ADMIN) |
| **offers** | Konfiguracja oferty (klient, wymiary, wariant, ceny) | user_id, client_*, width_m, length_m, height_m, area_m2, variant_hali, base_price_pln, total_pln, *_json |
| **pricing_cache** | Snapshot bazy cennika z backendu | pricing_version, last_updated, cennik_json, dodatki_json, standard_json |
| **pdfs** | Historia wygenerowanych PDF | user_id, offer_id, client_name, file_path, file_name, status (LOCAL/LOGGED) |
| **emails** | Historia e-maili (do wysłania / wysłane / błąd) | user_id, pdf_id, to_email, status (DO_WYSŁANIA/SENT/FAILED), error_message |
| **outbox** | Kolejka operacji do wysłania przy połączeniu | operation_type (SEND_EMAIL, LOG_PDF, LOG_EMAIL, HEARTBEAT), payload_json, retry_count, processed_at |
| **activity** | Heartbeat, czas w aplikacji, urządzenie | user_id, device_type (phone/desktop), app_version, synced |

## Indeksy

- **users:** email (UNIQUE), role  
- **offers:** user_id, created_at, client_name  
- **pricing_cache:** pricing_version (UNIQUE)  
- **pdfs:** user_id, created_at, status  
- **emails:** user_id, status, created_at  
- **outbox:** processed_at, created_at, operation_type  
- **activity:** user_id, occurred_at, synced  

## Kolejność flush outbox

1. HEARTBEAT (najpierw, żeby odblokować ewentualne blokady po stronie serwera)  
2. LOG_PDF (logowanie PDF przed e-mailami)  
3. SEND_EMAIL (wysłanie z kolejki)  
4. LOG_EMAIL (logowanie po wysłaniu)

W praktyce: przetwarzamy w kolejności `created_at`; dla SEND_EMAIL przed wysłaniem sprawdzamy, czy mamy połączenie i credentials.
