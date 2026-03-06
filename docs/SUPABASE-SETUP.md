# Konfiguracja Supabase (Planlux Hale)

Backend aplikacji to **wyłącznie Supabase** (Auth, Postgres, Storage, Edge Functions). Brak Google Apps Script.

## 1. Zmienne środowiskowe (aplikacja desktop)

W `.env` lub zmiennych systemowych (tylko **publishable/anon key**, nigdy service role w aplikacji):

```env
SUPABASE_URL=https://fxsqwmflnzdnalkhwnuz.supabase.co
SUPABASE_ANON_KEY=sb_publishable_-uI4LEze8IwCUmgK-K6Jkg_bJEDB-wl
```

Opcjonalnie: `SUPABASE_PUBLISHABLE_KEY` (ta sama wartość co anon key).

## 2. Migracje bazy

```bash
# W katalogu projektu (gdzie jest supabase/)
supabase init          # jeśli brak konfiguracji
supabase db push       # lub: supabase migration up
```

Migracje w `supabase/migrations/`:
- `20250227000001_initial_schema.sql` – tabele (profiles, clients, offers, offer_counters, email_history, pdf_history, base_pricing, sync_log), RLS, trigger, RPC `rpc_finalize_offer_number`.
- `20260227000000_base_pricing_anon_read.sql` – polityka **Allow anon read base_pricing**, żeby aplikacja desktop mogła pobrać cennik przy starcie (przed logowaniem). Bez tej migracji RLS zwraca 0 wierszy dla anon i aplikacja używa tylko fallbacku SQLite.
- `20250227000002_finalized_at_triggers_storage.sql` – kolumna `finalized_at`, triggery `updated_at`, bucket `offer-pdfs` i polityki Storage.
- `20260305000000_create_profiles.sql` – bezpieczna migracja uzupełniająca: upewnia się, że istnieje `public.profiles` (uuid → auth.users), RLS i trigger `handle_new_user`.

## 3. Storage

Bucket `offer-pdfs` jest tworzony w migracji. Ścieżka plików:  
`<owner_id>/<offer_id>/<offer_number_or_temp>.pdf`

## 4. Edge Functions

```bash
supabase functions deploy send_offer_email
supabase functions deploy create-user
```

Sekrety (tylko w Supabase, nie w repo):

**Dla send_offer_email (e-mail):**  
Albo Resend (prostsze):
```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set RESEND_FROM=noreply@example.com
```
Albo SMTP:
```bash
supabase secrets set SMTP_HOST=smtp.example.com
supabase secrets set SMTP_PORT=587
supabase secrets set SMTP_USER=...
supabase secrets set SMTP_PASS=...
supabase secrets set SMTP_FROM=noreply@example.com
```

**create-user** używa tylko `SUPABASE_SERVICE_ROLE_KEY` (ustawiany automatycznie przy deploy).

## 5. Checklist w Supabase Dashboard

- [ ] **Auth** – provider Email/Password włączony
- [ ] **RLS** – włączone na wszystkich tabelach (migracje to ustawiają)
- [ ] **Storage** – bucket `offer-pdfs` (private), polityki zgodne z migracją
- [ ] **Edge Functions** – `send_offer_email` i `create-user` wdrożone; sekrety: RESEND_API_KEY (lub SMTP_*) i RESEND_FROM/SMTP_FROM
- [ ] Brak **service role key** w aplikacji desktop i w repo

### 5.1. Błąd „could not find table 'public.profiles' in the schema cache”

Jeśli aplikacja desktop lub test `planlux:testSupabaseConnection` zgłasza błąd:

- `could not find table 'public.profiles' in the schema cache`  
lub kod błędu `SUPABASE_SCHEMA_MISSING`,

oznacza to, że migracje nie zostały zastosowane w projekcie Supabase.

Rozwiązanie:

```bash
cd <katalog z supabase/>
supabase db push
```

Następnie w Supabase Dashboard sprawdź, czy istnieje tabela `public.profiles` z kolumnami `id`, `email`, `display_name`, `role`.

## 6. Migracja danych z Google Sheets (jednorazowo)

1. Eksport z Sheets do CSV (arkusze: klienci, oferty, historia maili, baza cen).
2. Umieść pliki w `./imports/` (np. `clients.csv`, `offers.csv`, `email_history.csv`, `base_pricing.csv`).
3. Ustaw **tylko na maszynie deweloperskiej**: `SUPABASE_SERVICE_ROLE_KEY` (do jednorazowego skryptu).
4. Uruchom: `npx ts-node scripts/migrate_from_sheets_export.ts` (lub `tsx`).

Szczegóły w komentarzach w `scripts/migrate_from_sheets_export.ts`.
