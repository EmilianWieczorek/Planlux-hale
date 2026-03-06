# Planlux Hale — Cursor rules

Strict architectural rules for AI-assisted development. Follow these when generating or modifying code.

---

## Stack

- **Planlux Hale** is: **Electron + React + Supabase + SQLite** (monorepo).
- **Renderer:** UI only (React + Material UI). No Node, no DB, no filesystem, no direct Supabase.
- **Main process:** All system operations (DB, Supabase, PDF, email, updates, IPC).

---

## Renderer must NOT

- Access SQLite or any database.
- Access the filesystem.
- Access Supabase directly.
- Duplicate pricing calculations (pricing lives in `packages/shared/src/pricing`).

All system operations go through **IPC** (preload whitelist). Use existing IPC handlers; do not add renderer-side DB or Supabase clients.

---

## Database

- **Database:** SQLite.
- **Driver:** better-sqlite3 (main process only).
- **Location:** Under Electron `userData` (e.g. `userData/planlux-hale.db`).
- **Backup:** DB must be backed up before updates (e.g. to `userData/backups/`). The updater does this automatically.

---

## Supabase

- Used for: pricing configuration, CRM data, auth, **update releases** (`app_releases`).
- **Never create multiple Supabase clients.** Reuse the existing client/configuration passed into main/IPC.

---

## Pricing

- **Pricing logic** lives in `packages/shared/src/pricing`.
- Renderer must not duplicate pricing calculations. Call main process via IPC; main uses shared pricing.

---

## Updater

- **Location:** `packages/desktop/electron/updates/`
- **Flow (do not invert or skip):**
  1. `checkForUpdates` (Supabase `app_releases`, active, channel `stable`).
  2. If update available, download installer to `userData/updates/`.
  3. **Verify SHA256** (mandatory).
  4. **Backup SQLite** to `userData/backups/`.
  5. Run installer (path must be under `userData/updates/`, `.exe` only); then app quits.

---

## Summary

- Renderer = UI + IPC calls only.
- Main = DB, Supabase, PDF, email, updates, IPC handlers.
- One Supabase client. DB in userData. Backup before updates. SHA256 for installers.
