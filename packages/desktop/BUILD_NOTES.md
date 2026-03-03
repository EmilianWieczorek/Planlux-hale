# Build notes – Planlux Hale Desktop

## Keytar (native module)

The app uses **keytar** for secure SMTP password storage (OS keychain). After installing dependencies, rebuild native modules for Electron:

```bash
cd packages/desktop
npm install
npm run rebuild
```

If `electron-rebuild` is not installed globally, use:

```bash
npx electron-rebuild -f -w keytar
```

On Windows, ensure you have [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) so that native addons can compile.

If keytar fails to build, the app falls back to AES-encrypted storage in user data (no OS keychain).

## Windows installer (NSIS)

From the **repository root**:

```bash
npm run build -w @planlux/desktop
npm run dist -w @planlux/desktop
```

Or from `packages/desktop`:

```bash
npm run build
npm run dist
```

The installer is generated in `packages/desktop/release/` (e.g. `Planlux-Hale-1.0.0.exe`).
