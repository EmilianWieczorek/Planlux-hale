/**
 * Oficjalny generator PDF: Planlux-PDF template → temp HTML → loadFile → printToPDF → save.
 * Jedyna ścieżka generowania PDF w aplikacji.
 *
 * Ścieżki assetów (logo, ikony): w szablonie względne (assets/...). Po renderze kopiujemy
 * templateDir/assets do offerDir/assets i zapisujemy HTML do offerDir/index.html. Przy
 * loadFile(offerDir/index.html) przeglądarka rozwiąże assets/... względem katalogu pliku,
 * bez wstrzykiwania file:// (unika blokady „local resource”). Przed printToPDF czekamy
 * na załadowanie wszystkich <img>.
 */

import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { app } from "electron";
import type { GeneratePdfPayload } from "@planlux/shared";
import { buildPdfFileName, escapeHtml, formatCurrency } from "@planlux/shared";
import type { PdfTemplateConfig, PdfEditorContent } from "@planlux/shared";
import { getPdfTemplateDir } from "./pdfPaths";
import { renderPdfTemplateHtml, type OfferPdfPayload } from "./renderTemplate";
import {
  getPdfOutputDir,
  getPdfPreviewDir,
  getPreviewPdfFileName,
  getTestPdfFileName,
  runPrintToPdfFromFile,
  type Logger,
} from "./generatePdf";

function isDev(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production";
}

/** Zbiera unikalne ścieżki assets/ z HTML (src i url() w CSS) */
function collectAssetPaths(html: string): string[] {
  const seen = new Set<string>();
  const srcRegex = /src=["']assets\/([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRegex.exec(html)) !== null) seen.add("assets/" + m[1]);
  const urlRegex = /url\s*\(\s*["']?assets\/([^"')]+)["']?\s*\)/gi;
  while ((m = urlRegex.exec(html)) !== null) seen.add("assets/" + m[1]);
  return Array.from(seen);
}

/**
 * Diagnostyka assetów: sprawdza istnienie plików w offerDir (po skopiowaniu assets).
 * Loguje templateDir, offerDir, listę assetów i pełne ścieżki brakujących.
 * Nie zmienia HTML – w pipeline używane są względne ścieżki (assets/...) dla loadFile().
 */
function diagnoseAssets(html: string, templateDir: string, offerDir: string, logger: Logger): void {
  const paths = collectAssetPaths(html);
  /* Logo jest wstrzykiwane przez {{logoUrl}} – i tak sprawdzamy, czy plik istnieje */
  if (!paths.includes("assets/logo-bez-tla.svg")) paths.push("assets/logo-bez-tla.svg");
  if (paths.length === 0) {
    logger.info("[pdf] diagnostyka: brak odwołań do assets/ w HTML");
    return;
  }
  logger.info("[pdf] templateDir", templateDir);
  logger.info("[pdf] offerDir (base dla loadFile)", offerDir);
  const missing: string[] = [];
  for (const assetPath of paths) {
    const absoluteInOffer = path.join(offerDir, assetPath);
    const exists = fs.existsSync(absoluteInOffer);
    if (!exists) missing.push(absoluteInOffer);
  }
  if (missing.length > 0) {
    logger.warn("[pdf] brakujące assety (ikony/logo nie załadują się) – pełne ścieżki:", missing);
  } else {
    logger.info("[pdf] wszystkie assety obecne w offerDir", paths.length);
  }
}

/** Price override z pdfOverrides (manual override w PDF). */
export interface PriceOverride {
  priceNet?: number;
  priceGross?: number;
}

/**
 * Map payload z IPC (GeneratePdfPayload) na format szablonu (OfferPdfPayload).
 * constructionType/roofType/wallsType z base.row (CENNIK), gdy dostępne.
 * priceOverride: gdy ustawione, nadpisuje cenę z pricing engine.
 */
export function mapOfferDataToPayload(
  input: GeneratePdfPayload,
  offerDate: string,
  priceOverride?: PriceOverride | null
): OfferPdfPayload {
  const o = input.offer;
  const pr = input.pricing;
  const basePrice = pr.base?.totalBase ?? 0;
  let priceNet = pr.totalPln;
  let priceGross = Math.round(priceNet * 1.23);
  if (priceOverride) {
    if (typeof priceOverride.priceNet === "number") priceNet = priceOverride.priceNet;
    if (typeof priceOverride.priceGross === "number") priceGross = priceOverride.priceGross;
    else if (typeof priceOverride.priceNet === "number") priceGross = Math.round(priceOverride.priceNet * 1.23);
  }
  const variantName = o.variantNazwa || o.variantHali;
  const baseRow = pr.base?.row;

  const baseTableRow = `<tr>
    <td>Hala – ${escapeHtml(variantName)}</td>
    <td>${formatCurrency(o.areaM2)} m²</td>
    <td>${pr.base?.cenaPerM2 != null ? formatCurrency(pr.base.cenaPerM2) + " zł/m²" : "cena za m²"}</td>
    <td class="right">${formatCurrency(basePrice)} zł</td>
  </tr>`;

  const addonsTableRows = (pr.additions ?? [])
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.nazwa)}${a.warunek ? ` (${escapeHtml(a.warunek)})` : ""}</td><td>${a.ilosc} ${a.jednostka}</td><td>${formatCurrency(a.stawka)} zł</td><td class="right">${formatCurrency(a.total)} zł</td></tr>`
    )
    .join("");

  const standardChargeRows = (pr.standardInPrice ?? [])
    .filter((s) => (s as { pricingMode?: string }).pricingMode === "CHARGE_EXTRA" && (s as { total?: number }).total != null)
    .map((s) => {
      const total = (s as { total?: number }).total!;
      const qty = (s as { mbValue?: number }).mbValue ?? s.ilosc;
      return `<tr><td>${escapeHtml(s.element)} (standard)</td><td>${qty} ${s.jednostka}</td><td>${formatCurrency(s.wartoscRef)} zł</td><td class="right">${formatCurrency(total)} zł</td></tr>`;
    })
    .join("");

  const breakdownRowsHtml = baseTableRow + addonsTableRows + standardChargeRows;

  const addonsListHtml = (pr.additions ?? [])
    .map((a) => `<li>${escapeHtml(a.nazwa)} – ${a.ilosc} ${a.jednostka} (${formatCurrency(a.total)} zł)</li>`)
    .join("");

  const addonsPillsHtml =
    (pr.additions ?? []).length > 0
      ? (pr.additions ?? [])
          .map((a) => `<span class="pill"><span class="pill__dot"></span> ${escapeHtml(a.nazwa)}</span>`)
          .join("")
      : '<span class="pill">Brak dodatków</span>';

  const standardListHtml = (pr.standardInPrice ?? [])
    .map((s) => {
      const mode = (s as { pricingMode?: string }).pricingMode;
      const total = (s as { total?: number }).total;
      const suffix =
        mode === "CHARGE_EXTRA" && total != null
          ? ` – dolicz ${formatCurrency(total)} zł`
          : " – w cenie";
      return `<li>${escapeHtml(s.element)} – ${s.ilosc} ${s.jednostka} (wart. ref. ${formatCurrency(s.wartoscRef)} zł)${suffix}${s.uwagi ? " – " + escapeHtml(s.uwagi) : ""}</li>`;
    })
    .join("");

  return {
    offerNumber: input.offerNumber,
    offerDate,
    sellerName: input.sellerName ?? "Planlux",
    sellerEmail: input.sellerEmail,
    sellerPhone: input.sellerPhone,
    clientName: o.clientName,
    clientNip: o.clientNip,
    clientEmail: o.clientEmail,
    clientPhone: o.clientPhone,
    clientAddressOrInstall: input.clientAddressOrInstall,
    variantName,
    widthM: o.widthM,
    lengthM: o.lengthM,
    heightM: o.heightM,
    areaM2: o.areaM2,
    constructionType: baseRow?.Typ_Konstrukcji,
    roofType: baseRow?.Typ_Dachu ?? baseRow?.Dach,
    wallsType: baseRow?.Boki,
    priceNet,
    priceGross,
    breakdownRowsHtml,
    addonsListHtml,
    addonsPillsHtml,
    standardListHtml,
  };
}

export type GeneratePdfFromTemplateResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string; details?: string };

/**
 * Resolve template dir, render HTML, write to userData/tmp, loadFile, printToPDF, save to Documents/Planlux Hale/output.
 * Gdy templateConfig podane – używany do renderu (teksty, widoczność sekcji); przy braku – defaults.
 * Returns { filePath, fileName } on success; { ok: false, error } on failure.
 */
export type GeneratePdfFromTemplateOptions = { testMode?: boolean; previewMode?: boolean };

/** pdfOverrides: page1 (cena), page2 (treści). */
export interface PdfOverridesForGenerator {
  page1?: { priceNet?: number; priceGross?: number };
  page2?: { sectionTitle?: string; boxText1?: string; boxText2?: string; boxText3?: string; boxText4?: string; note?: string };
}

export async function generatePdfFromTemplate(
  offerData: GeneratePdfPayload,
  logger: Logger,
  templateConfig?: Partial<PdfTemplateConfig> | null,
  options?: GeneratePdfFromTemplateOptions | null,
  pdfOverrides?: PdfOverridesForGenerator | null
): Promise<GeneratePdfFromTemplateResult> {
  const templateDir = getPdfTemplateDir();
  if (isDev()) {
    logger.info("[pdf] templateDir", templateDir ?? "(brak)");
    logger.info("[pdf] templateConfig", templateConfig != null);
  }
  if (templateDir && isDev()) {
    const stylesPath = path.join(templateDir, "styles.css");
    const stylesPathResolved = path.resolve(stylesPath);
    logger.info("[pdf] styles.css (pełna ścieżka)", stylesPathResolved);
    const heroBgPath = path.join(templateDir, "assets", "hero-bg-print-safe.png");
    const heroBgPathResolved = path.resolve(heroBgPath);
    logger.info("[pdf] hero-bg-print-safe.png (pełna ścieżka)", heroBgPathResolved);
    const stylesExists = fs.existsSync(stylesPathResolved);
    const heroBgExists = fs.existsSync(heroBgPathResolved);
    logger.info("[pdf] diagnostyka: styles.css exists/size/mtime", {
      exists: stylesExists,
      ...(stylesExists ? (() => {
        try {
          const st = fs.statSync(stylesPathResolved);
          return { sizeBytes: st.size, mtime: st.mtime.toISOString() };
        } catch {
          return {};
        }
      })() : {}),
    });
    logger.info("[pdf] diagnostyka: hero-bg-print-safe.png exists/size/mtime", {
      exists: heroBgExists,
      ...(heroBgExists ? (() => {
        try {
          const st = fs.statSync(heroBgPathResolved);
          return { sizeBytes: st.size, mtime: st.mtime.toISOString() };
        } catch {
          return {};
        }
      })() : {}),
    });
    const fromDist = templateDir.includes("dist" + path.sep) || templateDir.includes("dist/");
    logger.info("[pdf] template source", fromDist ? "dist/assets" : "packages/desktop/assets (dev)");
  }
  if (!templateDir) {
    return { ok: false, error: "Szablon Planlux-PDF nie został znaleziony (brak index.html w assets/pdf-template/Planlux-PDF)." };
  }

  const now = new Date();
  const offerDate = now.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
  const payload = mapOfferDataToPayload(offerData, offerDate, pdfOverrides?.page1 ?? null);

  const editorContentForPage2 = pdfOverrides?.page2
    ? ({ page2: pdfOverrides.page2 } as Partial<PdfEditorContent>)
    : undefined;

  let html: string;
  logger.info("[pdf] render z katalogu (pełna ścieżka)", path.resolve(templateDir));
  try {
    html = renderPdfTemplateHtml(
      templateDir,
      payload,
      templateConfig ?? undefined,
      editorContentForPage2 ?? undefined,
      !!pdfOverrides
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] renderPdfTemplateHtml failed", e);
    return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined };
  }

  const tmpDir = path.join(app.getPath("userData"), "tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const offerId = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const offerDir = path.join(tmpDir, offerId);
  const tempHtmlPath = path.join(offerDir, "index.html");

  try {
    fs.mkdirSync(offerDir, { recursive: true });
    const assetsSrc = path.join(templateDir, "assets");
    if (fs.existsSync(assetsSrc)) {
      const assetsDest = path.join(offerDir, "assets");
      fs.cpSync(assetsSrc, assetsDest, { recursive: true });
      logger.info("[pdf] assets copied to tmp", assetsDest);
    }
    /* Diagnostyka: log templateDir, offerDir, brakujące assety (pełne ścieżki). */
    diagnoseAssets(html, templateDir, offerDir, logger);
    /* Logo: wstrzykuj file:// URL z offerDir, żeby img ładował się w Electron printToPDF. */
    const logoPath = path.join(offerDir, "assets", "logo-bez-tla.svg");
    const logoUrl =
      fs.existsSync(logoPath) ? pathToFileURL(logoPath).href : "assets/logo-bez-tla.svg";
    html = html.replace(/\{\{\s*logoUrl\s*\}\}/g, logoUrl);
    fs.writeFileSync(tempHtmlPath, html, "utf-8");
    logger.info("[pdf] temp HTML written (relative asset paths)", tempHtmlPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] write temp HTML/assets failed", e);
    return { ok: false, error: `Zapis tymczasowy: ${msg}` };
  }

  const printResult = await runPrintToPdfFromFile(tempHtmlPath, logger);
  try {
    if (fs.existsSync(offerDir)) fs.rmSync(offerDir, { recursive: true });
  } catch (_) {}

  if (!printResult.ok) {
    return { ok: false, error: printResult.error, details: printResult.details };
  }

  const outputDir = options?.previewMode ? getPdfPreviewDir() : getPdfOutputDir();
  const fileName = options?.previewMode
    ? getPreviewPdfFileName()
    : options?.testMode
      ? getTestPdfFileName()
      : buildPdfFileName({
          sellerName: offerData.sellerName,
          clientCompany: offerData.offer.clientName,
          offerNumber: offerData.offerNumber,
        });
  const filePath = path.join(outputDir, fileName);

  try {
    fs.writeFileSync(filePath, printResult.buffer);
    if (isDev()) {
      logger.info("[pdf] final PDF", { filePath, fileName });
    } else {
      logger.info("[pdf] saved path", filePath);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] save PDF failed", e);
    return { ok: false, error: `Zapis PDF: ${msg}` };
  }

  return { ok: true, filePath, fileName };
}
