# Build Windows installer (NSIS) – Planlux Hale

## Prerequisites

- **Node.js** 20 LTS (or >=20.19.0 as in `engines`)
- **npm** 9+
- **Windows** (build runs on Windows; target is x64)
- **Visual Studio Build Tools** (for native modules: `better-sqlite3`, `keytar`)
  - Install [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with “Desktop development with C++”
  - Required so `electron-builder install-app-deps` / native rebuild works on a clean machine

## Build commands (from repository root)

```bash
# 1. Install dependencies (rebuilds native modules for Electron)
npm install

# 2. Build the desktop app (renderer + main + assets)
npm run build -w @planlux/desktop

# 3. Create icon if missing (optional; prepack does this)
# node packages/desktop/scripts/create-icon.js

# 4. Build Windows NSIS installer
npm run dist -w @planlux/desktop
```

One-liner (build + installer):

```bash
npm run dist:desktop
```

Or from `packages/desktop`:

```bash
cd packages/desktop
npm run build
npm run dist
```

## Output artifacts

- **Installer (NSIS):**  
  `packages/desktop/release/Planlux Hale Setup 1.0.6.exe`  
  (version number matches `packages/desktop/package.json`)

- **Unpacked app (optional):**  
  `packages/desktop/release/win-unpacked/`  
  (run `Planlux Hale.exe` for quick testing without installing)

## Testing on a clean machine

1. Copy `Planlux Hale Setup 1.0.8.exe` (version from `packages/desktop/package.json`) to a Windows PC without Node/Dev tools.
2. Run the installer; choose installation directory if prompted.
3. Launch “Planlux Hale” from Start Menu or desktop shortcut.
4. Confirm the app starts and can log in (Supabase configured).

## Configuration summary

- **electron-builder** config: `packages/desktop/package.json` (section `"build"`) and `packages/desktop/electron-builder.yml`
- **App id:** `pl.planlux.hale`
- **Product name:** Planlux Hale
- **Icon:** `packages/desktop/assets/icon.ico` — multi-resolution ICO (16, 24, 32, 48, 64, 128, 256) created by `scripts/create-icon.js` on prepack. Single source of truth; used for installer, exe, desktop/Start shortcuts, taskbar, and window titlebar.
- **Windows icon cache:** If the app icon does not update after a new build:
  1. Uninstall the app.
  2. Delete desktop and Start Menu shortcuts.
  3. Restart Explorer or reboot:
     ```bash
     taskkill /f /im explorer.exe && start explorer.exe
     ```
- **Native modules:** `better-sqlite3`, `keytar` – rebuilt via `postinstall` (`electron-builder install-app-deps`) and packaged with asar unpack

## Signing (optional)

To sign the installer, set before building:

- `CSC_LINK` – path or base64 to `.pfx` certificate
- `CSC_KEY_PASSWORD` – certificate password

If not set, `dist:win` uses `CSC_IDENTITY_AUTO_DISCOVERY=false` so the build completes without signing.
