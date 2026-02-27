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
