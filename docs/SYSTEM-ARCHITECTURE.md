# PLANLUX HALE — SYSTEM ARCHITECTURE

This document describes the architecture of the **Planlux Hale** application to help developers and AI tools (Cursor, ChatGPT) understand the system.

The goal is to keep development **consistent, secure, and modular**.

---

# 1. Project Overview

Planlux Hale is a **desktop CRM and quotation system for steel halls**.

It is used by salespeople to:

• configure hall parameters
• calculate pricing
• generate PDF offers
• send offers by email
• store offer history
• manage CRM information

The application is **offline-first** with optional cloud synchronization.

---

# 2. Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Material UI |
| Desktop Runtime | Electron |
| Backend / Cloud | Supabase |
| Local Database | SQLite (better-sqlite3) |
| Language | TypeScript |
| Build System | Vite + Electron Builder |

---

# 3. Monorepo Structure

Repository uses **npm workspaces**.

Main structure:

| Path | Purpose |
|------|---------|
| `packages/desktop/` | Electron application |
| `packages/core/` | Business logic shared between modules |
| `packages/shared/` | Types, pricing engine, helpers |
| `docs/` | Project documentation |
| `scripts/` | Build and helper scripts |
| `supabase/` | Database migrations |

---

# 4. Desktop Application Architecture

The Electron application has two main processes.

## MAIN PROCESS

**Location:** `packages/desktop/electron/`

**Responsible for:**

• application lifecycle
• database access
• Supabase communication
• PDF generation
• email sending
• update system
• IPC handlers

**Key files:** `main.ts`, `ipc.ts`

---

## RENDERER PROCESS

**Location:** `packages/desktop/renderer/`

**Technology:** React + Material UI

**Responsibilities:**

• UI rendering
• forms
• hall calculator
• CRM interface
• dashboard

Communication with main process happens via **Electron IPC** (preload whitelist; no direct Node in renderer).

---

# 5. Local Database

| Aspect | Detail |
|--------|--------|
| Database | SQLite |
| Driver | better-sqlite3 |
| File location | Electron `userData` directory: `userData/planlux-hale.db` |

**Database stores:**

• offers
• CRM data
• cached pricing
• configuration
• local history

Before updates the database is **automatically backed up** to `userData/backups/db-backup-{timestamp}.db`.

---

# 6. Supabase Integration

Supabase is used as a **cloud backend**.

**Supabase provides:**

• authentication
• configuration sync
• pricing configuration
• update control

**Important tables:**

• `base_pricing`, `pricing_surface`, `addons_surcharges`, `standard_included`
• For updates: `app_releases`

---

# 7. Pricing Engine

**Location:** `packages/shared/src/pricing/`

**Responsibilities:**

• calculate hall price
• apply pricing tiers
• apply addons
• apply surcharges

**Input:** hall parameters (width, length, height, variant)

**Output:** calculated total price

Pricing data is loaded from Supabase and cached locally.

---

# 8. CRM System

CRM functionality includes:

• storing client data
• storing offers
• tracking email history
• viewing offer list

**Main table:** `offers`

**Fields include:** `client_name`, `client_email`, `client_phone`, `variant_hali`, `area_m2`, `total_pln`

Offers are saved to Supabase and cached locally.

---

# 9. PDF Generation

PDF offers are generated in the **main process**.

**Location:** `packages/desktop/electron/`

**PDF templates:** `packages/desktop/assets/pdf-template/`

**PDF generation includes:**

• client data
• hall parameters
• calculated price
• company branding

PDF can be saved locally or emailed to the client.

---

# 10. Email System

Emails are sent from the **main process**.

**Library:** nodemailer

**Email includes:** PDF attachment, offer details

Email history is stored in the CRM database.

---

# 11. Auto Update System

Planlux Hale uses a **custom update system** (no electron-updater for the Supabase flow).

**Components:**

• Supabase Database (`app_releases`)
• Supabase Storage (installer files)
• Electron updater module: `packages/desktop/electron/updates/`

**Flow:**

1. App starts → update service checks Supabase `app_releases` (active, channel `stable`).
2. If a newer version exists → UI can show “update available”.
3. User triggers download → installer downloaded to `userData/updates/planlux-update-{version}.exe`.
4. SHA256 verification (mandatory).
5. SQLite database backup to `userData/backups/`.
6. Installer executed; app quits.

**Installer files** are stored in Supabase Storage (e.g. bucket `updates`); `app_releases.download_url` points to the file.

---

# 12. Security Principles

The application enforces:

• SHA256 verification for downloaded updates
• SQLite backup before updates
• Restricted installer path (only from `userData/updates/`, `.exe only)
• No Node integration in renderer (preload whitelist only)
• IPC validation and typed handlers

Updates are only executed from the **`userData/updates`** directory.

---

# 13. Development Workflow

**Branch strategy:**

| Branch | Purpose |
|--------|---------|
| `main` | production |
| `dev` | development |
| `feature/*` | feature branches |

**Workflow:** dev → testing → merge → main

---

# 14. AI Development Guidelines

When generating code with AI tools:

**Follow existing architecture.**

• Keep business logic in `shared` / `core`.
• Renderer must not access the DB directly; use IPC.
• Main process handles system operations (DB, Supabase, PDF, email, updates).
• IPC must be explicit and typed; use the preload whitelist.
• Avoid duplicating Supabase clients; reuse the one provided to IPC/main.

Prefer **modular code** and existing patterns.

---

# 15. Future Modules

Planned modules:

• warehouse system
• advanced CRM analytics
• multi-company support
• offline synchronization engine
• mobile companion app

---

# End of document
