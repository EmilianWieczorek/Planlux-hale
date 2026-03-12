/**
 * Renderer-safe environment helpers.
 * In Vite we must not use `process` or `process.env` – use import.meta.env only.
 */

export function isRendererDebug(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_LOG_LEVEL === "debug";
}
