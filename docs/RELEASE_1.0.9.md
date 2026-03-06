# Release 1.0.9

**Release version:** 1.0.9

---

## Steps to build the Windows installer

1. **Install dependencies** (from repository root):
   ```bash
   npm install
   ```

2. **Build the Windows installer** (from repository root):
   ```bash
   npm run dist:win
   ```

This builds the desktop app and runs Electron Builder for Windows (NSIS). The build runs with `CSC_IDENTITY_AUTO_DISCOVERY=false` so the installer is not code-signed (suitable for internal or test distribution).

---

## Output location

- **Installer and unpacked build:** `packages/desktop/release/`
- The `.exe` installer (e.g. `Planlux Hale 1.0.9.exe` or similar) will be in that folder.

---

## After building: Supabase Storage

Upload the built Windows installer to **Supabase Storage** so the in-app updater can offer it:

1. Create or use the **`updates`** bucket (see `docs/UPDATER_SUPABASE_SETUP.md`).
2. Upload the `.exe` (e.g. under `updates/stable/Planlux-Hale-1.0.9.exe`).
3. Compute the **SHA256** of the file (hex, lowercase).
4. Insert a row into the **`app_releases`** table with `version = '1.0.9'`, the file’s public or signed URL in `download_url`, and the SHA256 in `sha256` (with `active = true`, `channel = 'stable'`).

The desktop app will then see 1.0.9 as an available update when it checks Supabase.
