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
import type { GeneratePdfPayload, GeneratePdfAddition, GeneratePdfStandardInPrice } from "@planlux/shared";
import { buildPdfFileName, escapeHtml, formatCurrency } from "@planlux/shared";
import type { PdfTemplateConfig, PdfEditorContent } from "@planlux/shared";
import { DEFAULT_PDF_EDITOR_PAGE2 } from "@planlux/shared";
import { getPdfTemplateDir, getPdfTemplateDirCandidatesWithExists } from "./pdfPaths";
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

/** Zbiera unikalne ścieżki assets/ z HTML (src i url() w CSS, w tym ./assets/) */
function collectAssetPaths(html: string): string[] {
  const seen = new Set<string>();
  const srcRegex = /src=["'](?:\.\/)?assets\/([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = srcRegex.exec(html)) !== null) seen.add("assets/" + m[1]);
  const urlRegex = /url\s*\(\s*["']?(?:\.\/)?assets\/([^"')]+)["']?\s*\)/gi;
  while ((m = urlRegex.exec(html)) !== null) seen.add("assets/" + m[1]);
  return Array.from(seen);
}

const REQUIRED_PDF_ASSETS: string[] = [];

/**
 * Diagnostyka assetów: sprawdza istnienie plików w offerDir (po skopiowaniu assets).
 * Loguje listę wymaganych/rekomendowanych i brakujących; nie zmienia HTML.
 */
function diagnoseAssets(html: string, templateDir: string, offerDir: string, logger: Logger): { allPresent: boolean; missingRequired: string[] } {
  const paths = collectAssetPaths(html);
  if (!paths.includes("assets/logo-bez-tla.svg")) paths.push("assets/logo-bez-tla.svg");
  if (!paths.includes("assets/hero-bg-print-safe.png")) paths.push("assets/hero-bg-print-safe.png");
  const missing: string[] = [];
  const missingRequired: string[] = [];
  for (const assetPath of paths) {
    const absoluteInOffer = path.join(offerDir, assetPath);
    const exists = fs.existsSync(absoluteInOffer);
    if (!exists) {
      missing.push(absoluteInOffer);
      if (REQUIRED_PDF_ASSETS.includes(assetPath)) missingRequired.push(assetPath);
    }
  }
  logger.info("[pdf] assets check", {
    templateDir: path.resolve(templateDir),
    offerDir: path.resolve(offerDir),
    totalReferenced: paths.length,
    missingCount: missing.length,
    missingRequired: missingRequired.length > 0 ? missingRequired : undefined,
  });
  if (missing.length > 0) {
    logger.warn("[pdf] missing assets (full paths)", missing);
    if (missing.some((m) => m.includes("hero-bg-print-safe.png"))) {
      logger.warn("[pdf] hero background missing – dodaj assets/hero-bg-print-safe.png do szablonu, aby tło headera się wyświetlało");
    }
  } else {
    logger.info("[pdf] all referenced assets present in offerDir");
  }
  return { allPresent: missing.length === 0, missingRequired };
}

/** Price override z pdfOverrides (manual override w PDF). */
export interface PriceOverride {
  priceNet?: number;
  priceGross?: number;
}

const SPEC_FALLBACK = "(brak danych)";

function isAutomaticHeightSurchargeAddition(name: string | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  return (
    /dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(n) ||
    /dopłata\s*ściana\s*boczna|doplata\s*sciana\s*boczna/i.test(n) ||
    /dopłata\s*za\s*wysokość\s*ściany|doplata\s*za\s*wysokosc\s*sciany/i.test(n)
  );
}

/**
 * Map payload z IPC (GeneratePdfPayload) na format szablonu (OfferPdfPayload).
 * Technical spec (Konstrukcja, Dach, Ściany):
 *   A. input.technicalSpec (from resolveTechnicalSpecForPdf / pricing_surface)
 *   B. fallback pr.base?.row (Typ_Konstrukcji, Typ_Dachu/Dach, Boki)
 *   C. SPEC_FALLBACK "(brak danych)"
 */
export function mapOfferDataToPayload(
  input: GeneratePdfPayload,
  offerDate: string,
  priceOverride?: PriceOverride | null
): OfferPdfPayload {
  const o = input.offer;
  const pr = input.pricing;
  const baseRow = pr.base?.row;
  const basePrice = pr.base?.totalBase ?? 0;
  let priceNet = pr.totalPln;
  let priceGross = Math.round(priceNet * 1.23);
  if (priceOverride) {
    if (typeof priceOverride.priceNet === "number") priceNet = priceOverride.priceNet;
    if (typeof priceOverride.priceGross === "number") priceGross = priceOverride.priceGross;
    else if (typeof priceOverride.priceNet === "number") priceGross = Math.round(priceOverride.priceNet * 1.23);
  }
  const variantName = o.variantNazwa || o.variantHali;
  const spec = input.technicalSpec;
  const constructionType =
    (spec?.construction_type != null && String(spec.construction_type).trim() !== "")
      ? String(spec.construction_type).trim()
      : (baseRow?.Typ_Konstrukcji != null && String(baseRow.Typ_Konstrukcji).trim() !== "")
        ? String(baseRow.Typ_Konstrukcji).trim()
        : SPEC_FALLBACK;
  const roofType =
    (spec?.roof_type != null && String(spec.roof_type).trim() !== "")
      ? String(spec.roof_type).trim()
      : (baseRow?.Typ_Dachu != null && String(baseRow.Typ_Dachu).trim() !== "")
        ? String(baseRow.Typ_Dachu).trim()
        : (baseRow?.Dach != null && String(baseRow.Dach).trim() !== "")
          ? String(baseRow.Dach).trim()
          : SPEC_FALLBACK;
  const wallsType =
    (spec?.walls != null && String(spec.walls).trim() !== "")
      ? String(spec.walls).trim()
      : (baseRow?.Boki != null && String(baseRow.Boki).trim() !== "")
        ? String(baseRow.Boki).trim()
        : SPEC_FALLBACK;
  const konstrukcja = constructionType;
  const dach = roofType;
  const sciany = wallsType;

  const baseTableRow = `<tr>
    <td>Hala – ${escapeHtml(variantName)}</td>
    <td>${formatCurrency(o.areaM2)} m²</td>
    <td>${pr.base?.cenaPerM2 != null ? formatCurrency(pr.base.cenaPerM2) + " zł/m²" : "cena za m²"}</td>
    <td class="right">${formatCurrency(basePrice)} zł</td>
  </tr>`;

  const pdfAdditions = (pr.additions ?? []).filter((a: GeneratePdfAddition) => !isAutomaticHeightSurchargeAddition(a.nazwa));
  const pdfFilteredAutomaticHeightSurcharge = (pr.additions ?? []).length !== pdfAdditions.length;
  if (pdfFilteredAutomaticHeightSurcharge && process.env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug("[pdf] filtered automatic height surcharge from additions", {
      variant: o.variantHali,
      heightM: o.heightM,
      pdfFilteredAutomaticHeightSurcharge: true,
      filteredCount: (pr.additions ?? []).length - pdfAdditions.length,
    });
  }

  const addonsTableRows = pdfAdditions
    .map(
      (a: GeneratePdfAddition) =>
        `<tr><td>${escapeHtml(a.nazwa)}${a.warunek ? ` (${escapeHtml(a.warunek)})` : ""}</td><td>${a.ilosc} ${a.jednostka}</td><td>${formatCurrency(a.stawka)} zł</td><td class="right">${formatCurrency(a.total)} zł</td></tr>`
    )
    .join("");

  const standardChargeRows = (pr.standardInPrice ?? [])
    .filter((s: GeneratePdfStandardInPrice & { pricingMode?: string; total?: number }) => s.pricingMode === "CHARGE_EXTRA" && s.total != null)
    .map((s: GeneratePdfStandardInPrice & { total?: number; mbValue?: number }) => {
      const total = (s as { total?: number }).total!;
      const qty = (s as { mbValue?: number }).mbValue ?? s.ilosc;
      return `<tr><td>${escapeHtml(s.element)} (standard)</td><td>${qty} ${s.jednostka}</td><td>${formatCurrency(s.wartoscRef)} zł</td><td class="right">${formatCurrency(total)} zł</td></tr>`;
    })
    .join("");

  const breakdownRowsHtml = baseTableRow + addonsTableRows + standardChargeRows;

  const addonsListHtml = pdfAdditions
    .map((a: GeneratePdfAddition) => `<li>${escapeHtml(a.nazwa)} – ${a.ilosc} ${a.jednostka} (${formatCurrency(a.total)} zł)</li>`)
    .join("");

  function renderAddonTag(label: string): string {
    return `<span class="pill"><span class="pill__dot"></span> ${escapeHtml(label)}</span>`;
  }

  function normalizeAddonDisplayKey(label: string): string {
    return String(label ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function formatStandardAddonLabel(s: { element: string; ilosc?: number; jednostka?: string }): string {
    const unit = (s.jednostka && String(s.jednostka).trim() !== "" ? s.jednostka : "szt") as string;
    if (unit === "") return s.element;
    const qty = s.ilosc != null ? s.ilosc : 1;
    return `${s.element} – ${qty} ${unit}`;
  }

  const paidAddonsPills =
    pdfAdditions.length > 0
      ? pdfAdditions.map((a: GeneratePdfAddition) => renderAddonTag(a.nazwa)).join("")
      : "";

  const standardItems = (pr.standardInPrice ?? []).slice();
  const standardSeen = new Set<string>();
  const dedupedStandardItems = standardItems.filter((s: GeneratePdfStandardInPrice) => {
    const key = normalizeAddonDisplayKey(s.element);
    if (standardSeen.has(key)) return false;
    standardSeen.add(key);
    return true;
  });

  const standardPills = dedupedStandardItems
    .map((s: GeneratePdfStandardInPrice) => renderAddonTag(formatStandardAddonLabel({ element: s.element, ilosc: s.ilosc, jednostka: s.jednostka })))
    .join("");

  const addonsPillsHtml =
    paidAddonsPills || standardPills
      ? paidAddonsPills + standardPills
      : '<span class="pill">Brak dodatków</span>';

  const standardListHtml = "";

  if (process.env.LOG_LEVEL === "debug") {
    // eslint-disable-next-line no-console
    console.debug("[pdf] standards payload", {
      count: (pr.standardInPrice ?? []).length,
      first: (pr.standardInPrice ?? []).slice(0, 3).map((x: GeneratePdfStandardInPrice) => ({ element: x.element, uwagi: x.uwagi })),
    });
    // eslint-disable-next-line no-console
    console.debug("[pdf] rendered standards", { htmlLength: standardListHtml.length });
  }

  const clientAddressOrInstall = (o.clientAddress ?? input.clientAddressOrInstall ?? "").trim() || undefined;
  const clientNameDisplay = (o.personName || o.companyName || o.clientName || "Klient").trim();

  return {
    offerNumber: input.offerNumber,
    offerDate,
    sellerName: input.sellerName ?? "Planlux",
    sellerEmail: input.sellerEmail,
    sellerPhone: input.sellerPhone,
    clientName: clientNameDisplay,
    companyName: o.companyName?.trim() || undefined,
    personName: o.personName?.trim() || undefined,
    clientAddressOrInstall: clientAddressOrInstall ?? input.clientAddressOrInstall,
    clientNip: o.clientNip,
    clientEmail: o.clientEmail,
    clientPhone: o.clientPhone,
    variantName,
    widthM: o.widthM,
    lengthM: o.lengthM,
    heightM: o.heightM,
    areaM2: o.areaM2,
    constructionType: konstrukcja,
    roofType: dach,
    wallsType: sciany,
    technicalSpec: {
      konstrukcja,
      dach,
      sciany,
    },
    priceNet,
    priceGross,
    breakdownRowsHtml,
    addonsListHtml,
    addonsPillsHtml,
    standardListHtml,
  };
}

export type PdfFailureStage =
  | "TEMPLATE_MISSING"
  | "RENDER_FAILED"
  | "ASSET_COPY_FAILED"
  | "HTML_WRITE_FAILED"
  | "PRINT_FAILED"
  | "WRITE_FAILED";

export type GeneratePdfFromTemplateResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string; details?: string; stage?: PdfFailureStage };

/**
 * Resolve template dir, render HTML, write to userData/tmp, loadFile, printToPDF, save to Documents/Planlux Hale/output.
 * Gdy templateConfig podane – używany do renderu (teksty, widoczność sekcji); przy braku – defaults.
 * Returns { filePath, fileName } on success; { ok: false, error } on failure.
 */
export type GeneratePdfFromTemplateOptions = { testMode?: boolean; previewMode?: boolean };

/** pdfOverrides: page1 (cena), page2 (treści). Override ma priorytet nad auto-content. */
export interface PdfOverridesForGenerator {
  page1?: { priceNet?: number; priceGross?: number };
  page2?: { sectionTitle?: string; boxText1?: string; boxText2?: string; boxText3?: string; boxText4?: string; note?: string };
}

/** Szablony pełnej treści boxów 2–4: tylko wartość z bazy jest wstrzykiwana w miejsce placeholderów. */
const PAGE2_BOX2_TEMPLATE =
  "Konstrukcja stalowa dopasowana do wymiarów i obciążeń.\nPołączenia skręcane – szybki montaż i serwis.\nZabezpieczenie antykorozyjne: {{construction_type}}.";
const PAGE2_BOX3_TEMPLATE =
  "Materiał: {{roof_type}}.\nWykończenia i uszczelnienia zapewniające szczelność.\nMożliwość doposażenia: świetliki / klapy / wzmocnienia.";
const PAGE2_BOX4_TEMPLATE =
  "Ściany boczne: {{walls}}.\nStolarka: bramy i drzwi w standardzie wg ustaleń.\nObróbki i wykończenia naroży – estetyka i trwałość.";

/** Domyślna treść strony 2: box 1 stały, boxy 2–4 = pełna treść szablonowa z wstrzykniętym construction_type / roof_type / walls. Override z pdfOverrides.page2 nadal ma priorytet. */
function buildDefaultPage2FromPayload(payload: OfferPdfPayload): typeof DEFAULT_PDF_EDITOR_PAGE2 {
  const fallback = SPEC_FALLBACK;
  const construction_type = (payload.constructionType ?? payload.technicalSpec?.konstrukcja ?? "").trim() || fallback;
  const roof_type = (payload.roofType ?? payload.technicalSpec?.dach ?? "").trim() || fallback;
  const walls = (payload.wallsType ?? payload.technicalSpec?.sciany ?? "").trim() || fallback;
  return {
    sectionTitle: DEFAULT_PDF_EDITOR_PAGE2.sectionTitle,
    boxText1: DEFAULT_PDF_EDITOR_PAGE2.boxText1,
    boxText2: PAGE2_BOX2_TEMPLATE.replace(/\{\{construction_type\}\}/g, construction_type),
    boxText3: PAGE2_BOX3_TEMPLATE.replace(/\{\{roof_type\}\}/g, roof_type),
    boxText4: PAGE2_BOX4_TEMPLATE.replace(/\{\{walls\}\}/g, walls),
    note: DEFAULT_PDF_EDITOR_PAGE2.note,
  };
}

export async function generatePdfFromTemplate(
  offerData: GeneratePdfPayload,
  logger: Logger,
  templateConfig?: Partial<PdfTemplateConfig> | null,
  options?: GeneratePdfFromTemplateOptions | null,
  pdfOverrides?: PdfOverridesForGenerator | null
): Promise<GeneratePdfFromTemplateResult> {
  const isE2E = process.env.PLANLUX_E2E === "1";
  const templateDir = getPdfTemplateDir();
  logger.info("[PLANLUX_PDF_DEBUG] generatePdfFromTemplate start", {
    previewMode: options?.previewMode ?? false,
    testMode: options?.testMode ?? false,
  });
  if (isE2E || process.env.PLANLUX_LOG_LEVEL === "debug") {
    const outDir = options?.previewMode ? getPdfPreviewDir() : getPdfOutputDir();
    logger.info("[E2E/pdf] pipeline start", {
      isE2E,
      PLANLUX_E2E_DIR: process.env.PLANLUX_E2E_DIR,
      templateDir: templateDir ? path.resolve(templateDir) : null,
      templateIndexExists: templateDir ? fs.existsSync(path.join(templateDir, "index.html")) : false,
      outputDir: path.resolve(outDir),
      outputDirExists: fs.existsSync(outDir),
    });
  }
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
    const candidatesWithExists = getPdfTemplateDirCandidatesWithExists();
    logger.error("[pdf] TEMPLATE_MISSING", {
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath ?? "",
      cwd: process.cwd(),
      isPackaged: app.isPackaged,
      candidates: candidatesWithExists,
    });
    return { ok: false, error: "Szablon Planlux-PDF nie został znaleziony (brak index.html w assets/pdf-template/Planlux-PDF).", stage: "TEMPLATE_MISSING" };
  }
  logger.info("[pdf] templateDir resolved", path.resolve(templateDir));

  logger.info("[pdf] payload summary", {
    offerNumber: offerData.offerNumber,
    clientName: offerData.offer?.clientName ?? offerData.offer?.companyName ?? "(brak)",
    previewMode: options?.previewMode ?? false,
  });

  const now = new Date();
  const offerDate = now.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
  logger.info("[pdf] variantHali input", {
    variantHali: offerData.offer?.variantHali ?? "(brak)",
  });
  logger.info("[pdf] resolved technicalSpec", {
    hasTechnicalSpec: !!offerData.technicalSpec,
    construction_type: offerData.technicalSpec?.construction_type ?? "(brak)",
    roof_type: offerData.technicalSpec?.roof_type ?? "(brak)",
    walls: offerData.technicalSpec?.walls ?? "(brak)",
  });

  const payload = mapOfferDataToPayload(offerData, offerDate, pdfOverrides?.page1 ?? null);

  const ct = payload.constructionType ?? "";
  const rt = payload.roofType ?? "";
  const wt = payload.wallsType ?? "";
  const sourceConstruction =
    (offerData.technicalSpec?.construction_type?.trim() && ct === offerData.technicalSpec.construction_type.trim())
      ? "technicalSpec"
      : (offerData.pricing?.base?.row?.Typ_Konstrukcji?.trim() && ct === offerData.pricing.base.row.Typ_Konstrukcji.trim())
        ? "baseRow"
        : "fallback";
  const sourceRoof =
    (offerData.technicalSpec?.roof_type?.trim() && rt === offerData.technicalSpec.roof_type.trim())
      ? "technicalSpec"
      : ((offerData.pricing?.base?.row?.Typ_Dachu?.trim() && rt === offerData.pricing.base.row.Typ_Dachu.trim()) ||
          (offerData.pricing?.base?.row?.Dach?.trim() && rt === offerData.pricing.base.row.Dach.trim()))
        ? "baseRow"
        : "fallback";
  const sourceWalls =
    (offerData.technicalSpec?.walls?.trim() && wt === offerData.technicalSpec.walls.trim())
      ? "technicalSpec"
      : (offerData.pricing?.base?.row?.Boki?.trim() && wt === offerData.pricing.base.row.Boki.trim())
        ? "baseRow"
        : "fallback";
  logger.info("[pdf] mapOfferDataToPayload source chosen", {
    constructionType: sourceConstruction,
    roofType: sourceRoof,
    wallsType: sourceWalls,
  });
  logger.info("[pdf] final payload for page2", {
    constructionType: payload.constructionType ?? SPEC_FALLBACK,
    roofType: payload.roofType ?? SPEC_FALLBACK,
    wallsType: payload.wallsType ?? SPEC_FALLBACK,
  });

  const specMissing =
    (payload.constructionType?.trim() || "") === "" ||
    (payload.roofType?.trim() || "") === "" ||
    (payload.wallsType?.trim() || "") === "" ||
    payload.constructionType === SPEC_FALLBACK ||
    payload.roofType === SPEC_FALLBACK ||
    payload.wallsType === SPEC_FALLBACK;
  logger.info("[pdf] technical spec payload final", {
    construction_type: payload.constructionType ?? SPEC_FALLBACK,
    roof_type: payload.roofType ?? SPEC_FALLBACK,
    walls: payload.wallsType ?? SPEC_FALLBACK,
    source: offerData.technicalSpec ? "technicalSpec" : "fallback",
  });
  if (specMissing) {
    logger.warn("[pdf] technical spec missing", {
      reason: offerData.technicalSpec ? "empty fields in technicalSpec" : "technicalSpec not set",
      construction_type: payload.constructionType ?? SPEC_FALLBACK,
      roof_type: payload.roofType ?? SPEC_FALLBACK,
      walls: payload.wallsType ?? SPEC_FALLBACK,
    });
  }

  const autoPage2 = buildDefaultPage2FromPayload(payload);
  const mergedPage2 = { ...autoPage2, ...pdfOverrides?.page2 };
  const editorContentForPage2 = { page2: mergedPage2 } as Partial<PdfEditorContent>;

  let html: string;
  logger.info("[PLANLUX_PDF_DEBUG] render from templateDir", { templateDir: path.resolve(templateDir) });
  logger.info("[pdf] page2 placeholders replaced with values", {
    konstrukcja: payload.constructionType ?? SPEC_FALLBACK,
    dach: payload.roofType ?? SPEC_FALLBACK,
    sciany: payload.wallsType ?? SPEC_FALLBACK,
  });
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
    return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined, stage: "RENDER_FAILED" };
  }

  const baseDir = app.getPath("userData");
  const tmpDir = path.join(baseDir, "tmp");
  await fs.promises.mkdir(tmpDir, { recursive: true });
  const offerId = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const offerDir = path.join(tmpDir, offerId);
  const tempHtmlPath = path.join(offerDir, "index.html");
  logger.info("[PLANLUX_PDF_DEBUG] temp paths", {
    userData: baseDir,
    tmpDir,
    offerDir,
    tempHtmlPath,
  });

  try {
    await fs.promises.mkdir(offerDir, { recursive: true });
    const assetsSrc = path.join(templateDir, "assets");
    const assetsDest = path.join(offerDir, "assets");
    if (fs.existsSync(assetsSrc)) {
      fs.cpSync(assetsSrc, assetsDest, { recursive: true });
      logger.info("[PLANLUX_PDF_DEBUG] assets copied to tmp", {
        dest: path.resolve(assetsDest),
        source: path.resolve(assetsSrc),
      });
    } else {
      logger.warn("[PLANLUX_PDF_DEBUG] template has no assets directory", path.resolve(assetsSrc));
    }
    diagnoseAssets(html, templateDir, offerDir, logger);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] mkdir or copy assets failed", e);
    return { ok: false, error: `Kopiowanie assetów: ${msg}`, stage: "ASSET_COPY_FAILED" };
  }

  const assetsOfferDir = path.join(offerDir, "assets");
  const logoPngPath = path.join(assetsOfferDir, "logo-bez-tla.png");
  const logoSvgPath = path.join(assetsOfferDir, "logo-bez-tla.svg");
  const logoPngInTemplate = fs.existsSync(path.join(templateDir, "assets", "logo-bez-tla.png"));
  const logoSvgInTemplate = fs.existsSync(path.join(templateDir, "assets", "logo-bez-tla.svg"));
  const logoPngCopied = fs.existsSync(logoPngPath);
  const logoSvgCopied = fs.existsSync(logoSvgPath);
  const chosenLogoFile = logoPngCopied ? "logo-bez-tla.png" : logoSvgCopied ? "logo-bez-tla.svg" : null;
  const logoSrcInHtml = chosenLogoFile ? `assets/${chosenLogoFile}` : null;

  logger.info("[PLANLUX_PDF_DEBUG] logo diagnostics", {
    templateDir: path.resolve(templateDir),
    offerDir: path.resolve(offerDir),
    logoPngInTemplate,
    logoSvgInTemplate,
    logoPngCopied,
    logoSvgCopied,
    chosenLogoFile: chosenLogoFile ?? "(brak – użyto fallback tekstowy)",
    finalPathInHtml: logoSrcInHtml ?? "(fallback)",
  });

  if (chosenLogoFile) {
    let logoSrc: string;
    if (chosenLogoFile === "logo-bez-tla.svg") {
      try {
        const svgContent = fs.readFileSync(logoSvgPath, "utf-8");
        const base64 = Buffer.from(svgContent, "utf-8").toString("base64");
        logoSrc = `data:image/svg+xml;base64,${base64}`;
      logger.info("[PLANLUX_PDF_DEBUG] logo: SVG injected as data URI");
      } catch (e) {
        logger.warn("[pdf] logo: nie udało się wczytać SVG, używam ścieżki względnej", e);
        logoSrc = "assets/logo-bez-tla.svg";
      }
    } else {
      logoSrc = `assets/${chosenLogoFile}`;
    }
    html = html.replace(/src="assets\/logo-bez-tla\.(svg|png)"/gi, `src="${logoSrc}"`);
  } else {
    logger.warn("[pdf] logo missing in offerDir – wstawiono fallback tekstowy Planlux");
    const fallbackHtml = '<span class="brand__logoFallback" aria-hidden="true">Planlux</span>';
    html = html.replace(
      /<img\s+class="brand__logoImg"\s+src="assets\/logo-bez-tla\.(svg|png)"\s+alt="Planlux"\s*\/>/gi,
      fallbackHtml
    );
  }
  html = html.replace(/\{\{\s*logoUrl\s*\}\}/g, logoSrcInHtml ?? "assets/logo-bez-tla.svg");

  html = html.replace(/<body(\s|>)/, "<body class=\"pdf-export\"$1");

  const heroBgPath = path.join(offerDir, "assets", "hero-bg-print-safe.png");
  if (!fs.existsSync(heroBgPath)) {
    const heroFallbackStyle =
      "<style>/* fallback gdy brak hero-bg-print-safe.png */ .hero,.plx-offer .hero,.plx-spec .hero,.page--spec .hero,.xd-terrain .hero{background-image:linear-gradient(165deg,#6b0d14 0%,#8b0f1b 25%,#c8102e 60%,#a80f0f 100%)!important;background-color:#8b0f1b!important}</style>";
    html = html.replace("</head>", heroFallbackStyle + "</head>");
    logger.info("[PLANLUX_PDF_DEBUG] hero background missing – applied gradient fallback");
  }
  const diagramPath = path.join(offerDir, "assets", "diagram-techniczny.png");
  if (!fs.existsSync(diagramPath)) {
    const diagramPanelBlock = html.includes("diagram-techniczny.png")
      ? html.replace(
          /<div class="diagramPanel">\s*<img\s[^>]*?src="assets\/diagram-techniczny\.png"[^>]*?\/>\s*<span class="diagram-placeholder"[^>]*>[\s\S]*?<\/span>\s*<\/div>/,
          '<div class="diagramPanel diagram-panel-no-image"><span class="diagram-placeholder diagram-placeholder-visible">Rysunek techniczny w przygotowaniu</span></div>'
        )
      : html;
    if (diagramPanelBlock !== html) {
      html = diagramPanelBlock;
      logger.info("[pdf] diagram-techniczny.png missing – wyświetlono placeholder");
    }
  }
  try {
    fs.writeFileSync(tempHtmlPath, html, "utf-8");
    logger.info("[PLANLUX_PDF_DEBUG] temp HTML written", {
      path: tempHtmlPath,
      sizeBytes: Buffer.byteLength(html, "utf-8"),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] write temp HTML failed", e);
    return { ok: false, error: `Zapis HTML: ${msg}`, stage: "HTML_WRITE_FAILED" };
  }

  logger.info("[PLANLUX_PDF_DEBUG] calling runPrintToPdfFromFile", { tempHtmlPath });
  const printResult = await runPrintToPdfFromFile(tempHtmlPath, logger);
  try {
    if (fs.existsSync(offerDir)) fs.rmSync(offerDir, { recursive: true });
  } catch (_) {}

  if (!printResult.ok) {
    return { ok: false, error: printResult.error, details: printResult.details, stage: "PRINT_FAILED" };
  }

  const outputDir = options?.previewMode ? getPdfPreviewDir() : getPdfOutputDir();
  await fs.promises.mkdir(outputDir, { recursive: true });
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
    const stat = fs.statSync(filePath);
    if (isE2E || process.env.PLANLUX_LOG_LEVEL === "debug") {
      logger.info("[E2E/pdf] file written", { filePath: path.resolve(filePath), size: stat.size, fileName });
    }
    if (isDev()) {
      logger.info("[pdf] final PDF", { filePath, fileName, sizeBytes: stat.size });
    } else {
      logger.info("[pdf] saved path", { filePath, sizeBytes: stat.size });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] save PDF failed", e);
    return { ok: false, error: `Zapis PDF: ${msg}`, stage: "WRITE_FAILED" };
  }

  return { ok: true, filePath, fileName };
}
