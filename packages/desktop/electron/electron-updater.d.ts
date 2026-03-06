declare module "electron-updater" {
  export type FeedUrlOptions =
    | { provider: "generic"; url: string }
    | { provider: "github"; owner?: string; repo?: string };

  export const autoUpdater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    /** Optional: override provider at runtime (e.g. generic URL). */
    setFeedURL?(options: FeedUrlOptions): void;
    /** Check for updates (no notify). */
    checkForUpdates?(): Promise<unknown>;
    checkForUpdatesAndNotify(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
    on(channel: string, cb: (...args: unknown[]) => void): void;
  };
}
