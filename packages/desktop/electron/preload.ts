/**
 * Preload – bridge do renderera.
 */

const { contextBridge, ipcRenderer } = require("electron");

const planlux = {
  platform: "desktop" as const,
  version: process.env.npm_package_version ?? "1.0.0",
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
};

/** Oficjalny kanał PDF: pdf:generate. generatePdf / pdfGenerate – oba wywołują ten sam handler. */
const api = {
  syncBase: () => ipcRenderer.invoke("base:sync"),
  generatePdf: (payload: unknown) => ipcRenderer.invoke("pdf:generate", payload),
  pdfGenerate: (offerData: unknown) => ipcRenderer.invoke("pdf:generate", offerData),
};

contextBridge.exposeInMainWorld("planlux", planlux);
contextBridge.exposeInMainWorld("api", api);
