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

/**
 * Zwraca katalog szablonu Planlux-PDF (tam gdzie leży index.html).
 * Działa w DEV (run from repo) i PROD (packaged app / app.asar).
 * W production (app.isPackaged) pomija ścieżki zawierające packages/desktop.
 */
export function getPdfTemplateDir(): string | null {
  const appPath = app.getAppPath();
  const resourcesPath = process.resourcesPath || "";
  const candidates = [
    path.join(appPath, TEMPLATE_SUBDIR),
    path.join(resourcesPath, "app.asar", TEMPLATE_SUBDIR),
    path.join(resourcesPath, TEMPLATE_SUBDIR),
    path.join(process.cwd(), TEMPLATE_SUBDIR),
    path.join(__dirname, "..", "..", TEMPLATE_SUBDIR),
  ];
  for (const dir of candidates) {
    const normalized = path.normalize(dir);
    if (app.isPackaged && isRepoRelativePath(normalized)) continue;
    const indexPath = path.join(normalized, "index.html");
    if (fs.existsSync(indexPath)) return normalized;
  }
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
