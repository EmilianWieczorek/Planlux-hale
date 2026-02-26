declare module "electron-updater" {
  export const autoUpdater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    checkForUpdatesAndNotify(): Promise<unknown>;
    on(channel: string, cb: (arg?: unknown) => void): void;
  };
}
