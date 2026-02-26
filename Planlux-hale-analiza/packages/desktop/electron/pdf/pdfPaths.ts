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

/**
 * Zwraca katalog szablonu Planlux-PDF (tam gdzie leży index.html).
 * Działa w DEV (run from repo) i PROD (packaged app / app.asar).
 */
export function getPdfTemplateDir(): string | null {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, TEMPLATE_SUBDIR),
    path.join(process.cwd(), TEMPLATE_SUBDIR),
    path.join(__dirname, "..", "..", TEMPLATE_SUBDIR),
    path.join(process.resourcesPath || "", "app.asar", TEMPLATE_SUBDIR),
    path.join(process.resourcesPath || "", TEMPLATE_SUBDIR),
  ];
  for (const dir of candidates) {
    const normalized = path.normalize(dir);
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
