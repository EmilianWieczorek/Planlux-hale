/**
 * Preload – bridge do renderera.
 */

const { contextBridge, ipcRenderer } = require("electron");

const planlux = {
  platform: "desktop" as const,
  version: process.env.npm_package_version ?? "1.0.0",
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  onUpdateAvailable: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on("planlux:update-available", (_: unknown, info: { version: string }) => cb(info));
  },
  onUpdateDownloaded: (cb: () => void) => {
    ipcRenderer.on("planlux:update-downloaded", () => cb());
  },
  downloadUpdate: () => ipcRenderer.invoke("planlux:downloadUpdate"),
  quitAndInstall: () => ipcRenderer.invoke("planlux:quitAndInstall"),
};

/** Oficjalny kanał PDF: pdf:generate. generatePdf / pdfGenerate – oba wywołują ten sam handler. */
const api = {
  syncBase: () => ipcRenderer.invoke("base:sync"),
  generatePdf: (payload: unknown) => ipcRenderer.invoke("pdf:generate", payload),
  pdfGenerate: (offerData: unknown) => ipcRenderer.invoke("pdf:generate", offerData),
};

contextBridge.exposeInMainWorld("planlux", planlux);
contextBridge.exposeInMainWorld("api", api);
