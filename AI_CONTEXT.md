# Planlux Hale — AI context

Short repository summary for AI tools (e.g. Cursor). Use with root `ARCHITECTURE.md` and `.cursor/rules.md`.

---

## What this repo is

**Desktop CRM and quotation system for steel halls.** Electron app with React UI, Supabase backend, and local SQLite. Offline-first; used by salespeople for hall config, pricing, PDF offers, email, and CRM.

---

## Main modules

| Module | Location | Role |
|--------|----------|------|
| Electron desktop app | `packages/desktop/` | Main process: DB, Supabase, PDF, email, updates, IPC. Renderer: React UI only. |
| React UI | `packages/desktop/renderer/` | Forms, calculator, CRM UI, dashboard. Communicates only via IPC. |
| Supabase backend | Config + `supabase/` | Auth, pricing config, CRM data, update releases (`app_releases`). |
| SQLite local DB | Main process only | Offers, CRM, cached pricing, config. File: `userData/planlux-hale.db`. |
| Pricing engine | `packages/shared/src/pricing/` | Hall price calculation; used by main process via shared package. |
| PDF generator | `packages/desktop/electron/` (main) | PDF offers; templates in `packages/desktop/assets/pdf-template/`. |
| Email system | Main process | Nodemailer; history in CRM DB. |
| Custom auto-update | `packages/desktop/electron/updates/` | Supabase `app_releases` + Storage; check → download → SHA256 → backup DB → run installer. |

---

## Important folders

- `packages/desktop/` — Electron app (main + renderer).
- `packages/shared/` — Types, pricing, shared logic.
- `packages/core/` — Shared business logic.
- `supabase/` — Migrations, backend config.
- `docs/` — Architecture, API, guides, audits.

---

## Key architectural rule

**The renderer never accesses the database, filesystem, or Supabase directly.** All system operations (DB, Supabase, PDF, email, updates) happen in the **Electron main process** and are exposed to the renderer via **IPC** (preload whitelist). When generating code, keep this boundary strict.
