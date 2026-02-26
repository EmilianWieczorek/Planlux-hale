# Planlux Hale – Enterprise Refactor Plan

## Overview

Comprehensive refactor to production-ready, enterprise-grade Electron CRM.

---

## 1) Project Cleanup ✅

- [x] Remove `Planlux-hale-analiza` folder
- [x] Remove redundant markdown: `GIT-REPO-SETUP.md`, `REPO-CLEANUP-REPORT.md` (merge into docs if needed)
- [x] Update `.gitignore` per spec

**Root structure (final):**
```
.github/
docs/
packages/
scripts/
.gitignore
package.json
commitlint.config.js
.releaserc.json
CHANGELOG.md
README.md
README-ARCH.md
```

---

## 2) Code Structure

- Single source of truth: `packages/shared` (types, constants, enums)
- Desktop: `electron/`, `renderer/`, `assets/`, `src/`, `electron-builder.yml`
- Remove duplicates, consolidate utils into shared

---

## 3) Offer Numbering Logic

| Component | Change |
|-----------|--------|
| `saveOfferDraft` | Never generate TEMP. Only persist existing `offer_number`. |
| `createOffer` (new IPC) | `reserveOfferNumber` → commit to DB. Single entry point. |
| `syncTempOfferNumbers` | Only fix offline TEMP offers when back online. |
| Kalkulator | Call `createOffer` or `getNextOfferNumber` before first draft save. |

**Tests:** online create → PLX-...; offline → TEMP; sync TEMP→PLX

---

## 4) PDF Preview

- Fix CSP for PDF preview (no Google CDN)
- Use local fonts
- Add diagnostic logs on PDF generation failure
- Embed: Addons, construction types, roof, walls on page 2

---

## 5) Admin Panel

- Validate roles: USER | BOSS | ADMIN (add BOSS to schema)
- Remove CHECK constraint errors (migration)
- Snackbar UI feedback on errors
- Activity logs for admin

---

## 6) DB Migration

- Add BOSS role to users
- Remove old CHECK constraint on role
- Add `activity_logs` / audit trail table
- Stable DB versioning

---

## 7) CI/CD + Release

- Workflow: push main → build → semantic-release → tag
- Tag push → build Electron → GitHub Release + installer
- Already configured in `.github/workflows/release.yml`

---

## 8) Auto-update

- electron-updater: `checkForUpdatesAndNotify` on startup
- Modal "Nowa wersja dostępna"
- Silent download, restart to install

---

## 9) Security

- contextIsolation: true, nodeIntegration: false (already set)
- Harden IPC: validate all inputs
- CSP policy

---

## 10) Documentation

- README: setup, build, branch strategy, conventions
- Architecture diagram
- Troubleshooting guide
