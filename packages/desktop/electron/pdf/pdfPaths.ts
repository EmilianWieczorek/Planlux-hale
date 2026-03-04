/**
 * Jedno źródło ścieżek dla PDF: template dir (DEV/PROD) i URL assetów.
 * Używane przez oficjalny pipeline PDF (renderTemplate + generatePdfFromTemplate).
 *
 * Punkt wpięcia finalnego template: packages/desktop/assets/pdf-template/Planlux-PDF/
 * Wymagane: index.html, styles.css, opcjonalnie assets/ (logo, ikony). getPdfTemplateDir()
 * zwraca ten katalog, gdy index.html istnieje.
 */

import { app } from "electron";
import path from "path";
import fs from "fs";

const TEMPLATE_SUBDIR = path.join("assets", "pdf-template", "Planlux-PDF");

/** W packaged app nie używamy ścieżek repo (packages/desktop). */
function isRepoRelativePath(dir: string): boolean {
  const normalized = path.normalize(dir);
  return (
    normalized.includes(`${path.sep}packages${path.sep}desktop`) ||
    normalized.includes("/packages/desktop")
  );
}

/** E2E/debug: log only when PLANLUX_E2E=1 or PLANLUX_LOG_LEVEL=debug. */
function shouldLogPdfPaths(): boolean {
  return process.env.PLANLUX_E2E === "1" || process.env.PLANLUX_LOG_LEVEL === "debug";
}

/**
 * Zwraca katalog szablonu Planlux-PDF (tam gdzie leży index.html).
 * Działa w DEV (run from repo) i PROD (packaged app / app.asar).
 * W production (app.isPackaged) pomija ścieżki zawierające packages/desktop.
 */
export function getPdfTemplateDir(): string | null {
  if (process.env.PLANLUX_E2E === "1" && process.env.PLANLUX_E2E_TEMPLATE_DIR) {
    const e2eDir = path.normalize(process.env.PLANLUX_E2E_TEMPLATE_DIR);
    const indexPath = path.join(e2eDir, "index.html");
    if (fs.existsSync(indexPath)) {
      if (shouldLogPdfPaths()) console.log("[E2E/pdf] templateDir from PLANLUX_E2E_TEMPLATE_DIR", path.resolve(e2eDir));
      return e2eDir;
    }
  }
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || "";
  const candidates = [
    path.join(appPath, TEMPLATE_SUBDIR),
    path.join(resourcesPath, "app.asar", TEMPLATE_SUBDIR),
    path.join(resourcesPath, TEMPLATE_SUBDIR),
    path.join(process.cwd(), TEMPLATE_SUBDIR),
    path.join(__dirname, "..", "..", TEMPLATE_SUBDIR),
  ];
  if (shouldLogPdfPaths()) {
    const diag = candidates.map((dir) => {
      const n = path.normalize(dir);
      const idx = path.join(n, "index.html");
      return { dir: n, indexExists: fs.existsSync(idx) };
    });
    console.log("[E2E/pdf] getPdfTemplateDir candidates", JSON.stringify(diag, null, 2));
    console.log("[E2E/pdf] process.cwd()", process.cwd(), "PLANLUX_E2E_DIR", process.env.PLANLUX_E2E_DIR);
  }
  for (const dir of candidates) {
    const normalized = path.normalize(dir);
    if (app.isPackaged && isRepoRelativePath(normalized)) continue;
    const indexPath = path.join(normalized, "index.html");
    if (fs.existsSync(indexPath)) {
      if (shouldLogPdfPaths()) console.log("[E2E/pdf] templateDir resolved", path.resolve(normalized));
      return normalized;
    }
  }
  if (shouldLogPdfPaths()) console.error("[E2E/pdf] templateDir NOT FOUND");
  return null;
}

/**
 * Zwraca URL file:// dla assetu względem katalogu template (np. logo, fonty).
 * Użyj w HTML/CSS gdy template ładuje assety z zewnątrz (np. <img src="...">).
 * Dla inlinowanego CSS i self-contained HTML nie jest wymagane.
 */
export function resolveTemplateAssetUrl(templateDir: string, relativePath: string): string {
  const fullPath = path.join(templateDir, relativePath).replace(/\\/g, "/");
  return `file:///${fullPath.replace(/^\//, "")}`;
}
