# Kontrakt API – Backend Supabase

Backend aplikacji to **wyłącznie Supabase** (Postgres, Auth, Storage, Edge Functions). Brak Google Apps Script.

- **Auth:** Supabase Auth (email/hasło). Profile i role w tabeli `profiles`.
- **Dane:** Postgres (offers, clients, base_pricing, email_history, pdf_history, sync_log, offer_counters).
- **Pliki PDF:** Storage bucket `offer-pdfs` (ścieżka: `<owner_id>/<offer_id>/<filename>.pdf`).
- **Operacje uprzywilejowane:** Edge Functions z sekretami (np. `send_offer_email`, `create-user`).

Wszystkie odpowiedzi JSON. Aplikacja desktop używa klienta Supabase **tylko w procesie main** (renderer przez IPC).

**Wymaganie odpowiedzi:** Endpointy i RPC zwracają JSON:
- Sukces: `{ "ok": true, ... }`.
- Błąd: `{ "ok": false, "error": "opis", "code": "ERR_..." }`.

---

## 1. META / BASE (baza cen – base_pricing)

- **getMeta:** `supabase.from("base_pricing").select("payload, version, created_at").order("version", { ascending: false }).limit(1)` → zwraca `meta.version`, `meta.lastUpdated`.
- **getBase:** ten sam select; zwraca pełny `payload` (cennik, dodatki, standard).

Aplikacja porównuje `meta.version` z lokalnym cache i przy wyższej wersji pobiera pełną bazę.

---

## 2. Oferty, klienci, numeracja

- **Oferty:** CRUD przez `supabase.from("offers")` (RLS: owner lub admin/manager).
- **Finalizacja numeru:** RPC `rpc_finalize_offer_number(p_offer_id uuid)` (SECURITY DEFINER).
- **Klienci:** `supabase.from("clients")` (RLS: created_by = auth.uid() lub admin/manager).

---

## 3. E-mail

- **Wysyłka:** Edge Function `send_offer_email` (body: offer_id, to_email, subject?, bodyHtml?, attachPdf?). Sekrety SMTP/Resend tylko w Supabase.
- **Historia:** tabela `email_history` (insert z Edge Function lub z aplikacji po wysłaniu przez SMTP lokalnie – w zależności od flow).

---

## 4. PDF

- **Upload:** Storage bucket `offer-pdfs`, ścieżka `<owner_id>/<offer_id>/<nazwa>.pdf`.
- **Historia:** tabela `pdf_history` (storage_path, offer_id, created_by).

---

## 5. Użytkownicy (admin)

- **Lista:** `supabase.from("profiles").select("id, email, display_name, role")` (RLS: admin/manager widzą wszystkich).
- **Tworzenie:** Edge Function `create-user` (body: email, password, displayName?, role?). Wymaga JWT użytkownika z rolą ADMIN.
