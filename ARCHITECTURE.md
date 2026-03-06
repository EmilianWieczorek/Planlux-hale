# Planlux Hale — Architecture

High-level architecture for developers and AI tools. Detailed and alternative docs: `docs/ARCHITECTURE.md`, `docs/SYSTEM-ARCHITECTURE.md`.

---

## What is Planlux Hale?

**Desktop CRM and quotation system for steel halls.** Salespeople configure hall parameters, calculate pricing, generate PDF offers, send offers by email, and manage CRM. **Offline-first** with optional cloud sync.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Material UI |
| Desktop | Electron |
| Backend / Cloud | Supabase |
| Local database | SQLite (better-sqlite3) |
| Language | TypeScript |
| Build | Vite + Electron Builder |

---

## Monorepo Structure

| Path | Purpose |
|------|---------|
| `packages/desktop/` | Electron app (main + renderer) |
| `packages/shared/` | Types, pricing engine, helpers |
| `packages/core/` | Business logic shared between modules |
| `docs/` | Project documentation |
| `scripts/` | Build and helper scripts |
| `supabase/` | Database migrations |

---

## Electron: Main vs Renderer

### Main process (`packages/desktop/electron/`)

- Application lifecycle, window, menu
- **Database access** (SQLite via better-sqlite3)
- **Supabase** communication (single client, passed via deps)
- **PDF generation**
- **Email** (nodemailer)
- **Update system** (custom Supabase-based updater)
- **IPC handlers** (`main.ts`, `ipc.ts`)

**Key files:** `main.ts`, `ipc.ts`, `updates/`

### Renderer process (`packages/desktop/renderer/`)

- React + Material UI
- UI, forms, hall calculator, CRM interface, dashboard
- **Communication only via IPC** (preload whitelist)

**Rule:** The renderer must **not** directly access SQLite, the filesystem, or Supabase. All system operations go through IPC from the main process.

---

## Supabase

- **Role:** Cloud backend — auth, config sync, pricing config, CRM data, update control.
- **Important:** One Supabase client in the app; reuse the instance provided to main/IPC. Do not create multiple clients.
- **Tables (examples):** `base_pricing`, `pricing_surface`, `addons_surcharges`, `standard_included`, `app_releases` (updates).

---

## SQLite (Local Database)

- **Driver:** better-sqlite3 (main process only).
- **Location:** `userData/planlux-hale.db` (Electron `userData` directory).
- **Stores:** offers, CRM data, cached pricing, configuration, local history.
- **Backup:** Before applying updates, DB is backed up to `userData/backups/db-backup-{timestamp}.db`.

---

## Pricing Engine

- **Location:** `packages/shared/src/pricing/`
- **Role:** Calculate hall price, apply tiers, addons, surcharges. Input: hall params; output: total price.
- **Data:** Loaded from Supabase, cached locally. Renderer must not duplicate pricing logic; use IPC/main.

---

## CRM

- Offers, client data, email history, offer list. Main table: `offers`. Data synced/cached with Supabase where configured.

---

## PDF and Email

- **PDF:** Generated in the **main process** (`packages/desktop/electron/`). Templates: `packages/desktop/assets/pdf-template/`. Can be saved locally or attached to email.
- **Email:** Sent from main process (nodemailer). History stored in CRM DB.

---

## Auto Update System

- **Custom updater** (Supabase + Storage), no electron-updater for this flow.
- **Module:** `packages/desktop/electron/updates/`
- **Flow:** Check Supabase `app_releases` → if newer version, download installer → verify SHA256 → backup SQLite → run installer from `userData/updates/` → app quits.
- **Security:** Installer path restricted to `userData/updates/`; only `.exe`; SHA256 required.

---

## Rule for AI and Developers

**Renderer never accesses the database, filesystem, or Supabase directly.** All system operations (DB, Supabase, PDF, email, updates) happen in the Electron main process and are exposed to the renderer via typed IPC only.
