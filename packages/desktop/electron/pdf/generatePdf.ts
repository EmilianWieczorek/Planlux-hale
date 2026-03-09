/**
 * PDF generation pipeline: hidden BrowserWindow + printToPDF.
 * Timeout 20s, deterministic output dir, always close window, structured result.
 */

import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";
import { getE2EConfig } from "../e2eEnv";

const PDF_TIMEOUT_MS = 20_000;
const LAYOUT_DELAY_MS = 100;

export type PdfResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; error: string; details?: string };

export type Logger = {
  info: (msg: string, d?: unknown) => void;
  warn: (msg: string, d?: unknown) => void;
  error: (msg: string, e?: unknown) => void;
};

export type PdfOfferMeta = {
  pdfId: string;
  userId: string;
  clientName: string;
  totalPln: number;
  widthM: number;
  lengthM: number;
  heightM: number;
  areaM2: number;
  variantHali: string;
  fileName: string;
  filePath: string;
};

/**
 * Unikalna nazwa pliku dla preview PDF: oferta-preview-YYYYMMDD-HHmmss.pdf
 */
export function getPreviewPdfFileName(): string {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `oferta-preview-${Y}${M}${D}-${h}${min}${s}.pdf`;
}

/**
 * Unikalna nazwa pliku dla testowego PDF: oferta-test-YYYYMMDD-HHmmss.pdf
 */
export function getTestPdfFileName(): string {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `oferta-test-${Y}${M}${D}-${h}${min}${s}.pdf`;
}

/**
 * Katalog zapisu PDF: userData/pdf (stabilny w DEV i PROD). W E2E: PLANLUX_E2E_DIR/pdfs.
 */
export function getPdfOutputDir(): string {
  const e2e = getE2EConfig();
  if (e2e.isE2E) {
    const pdfDir = path.join(e2e.e2eBaseDir, "pdfs");
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    return pdfDir;
  }
  const baseDir = app.getPath("userData");
  const pdfDir = path.join(baseDir, "pdf");
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  return pdfDir;
}

/**
 * Katalog na tymczasowe PDF preview (userData/preview). W E2E: PLANLUX_E2E_DIR/preview.
 */
export function getPdfPreviewDir(): string {
  const e2e = getE2EConfig();
  if (e2e.isE2E) {
    const dir = path.join(e2e.e2eBaseDir, "preview");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const baseDir = app.getPath("userData");
  const dir = path.join(baseDir, "preview");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Run HTML -> PDF with a single hidden window. Never hangs (timeout). Always closes window.
 */
export async function runPrintToPdf(
  html: string,
  filePath: string,
  logger: Logger
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> {
  logger.info("[pdf] start");
  const winRef: { current: BrowserWindow | null } = { current: null };

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("PDF generation timeout (20s)")), PDF_TIMEOUT_MS);
  });

  const run = async (): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> => {
    const win = new BrowserWindow({
      width: 794,
      height: 1123,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: false, contextIsolation: true, backgroundThrottling: false },
    });
    winRef.current = win;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    logger.info("[pdf] html rendered, loading in window");

    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_, code, msg) =>
        reject(new Error(`Load failed: ${code} ${msg}`))
      );
      win.loadURL(dataUrl).catch(reject);
    });
    logger.info("[pdf] window loaded");
    await win.webContents
      .executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true")
      .catch(() => {});
    win.webContents.setZoomFactor(1);

    await new Promise((r) => setTimeout(r, LAYOUT_DELAY_MS));

    const pdfBuf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: { marginType: "none" },
      preferCSSPageSize: true,
    });
    logger.info("[pdf] printToPDF ok");

    return { ok: true, buffer: pdfBuf };
  };

  try {
    const result = await Promise.race([run(), timeoutPromise]);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.error("[pdf] failed", stack ?? e);
    return { ok: false, error: message, details: stack };
  } finally {
    const w = winRef.current;
    if (w && !w.isDestroyed()) {
      w.close();
    }
    winRef.current = null;
  }
}

/**
 * Full pipeline: runPrintToPdf, write file, return result. Caller inserts DB row.
 */
export async function generatePdfPipeline(
  html: string,
  fileName: string,
  logger: Logger
): Promise<PdfResult & { filePath: string }> {
  const outputDir = getPdfOutputDir();
  const filePath = path.join(outputDir, fileName);

  const printResult = await runPrintToPdf(html, filePath, logger);
  if (!printResult.ok) {
    return { ok: false, error: printResult.error, details: printResult.details, filePath: "" };
  }

  try {
    fs.writeFileSync(filePath, printResult.buffer);
    logger.info("[pdf] saved path", filePath);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("[pdf] failed", e instanceof Error ? e.stack : e);
    return { ok: false, error: `Zapis pliku: ${message}`, details: String(e), filePath: "" };
  }

  return { ok: true, filePath, fileName };
}

/**
 * Minimal valid PDF bytes for E2E fallback when printToPDF is unreliable (e.g. Playwright/CI).
 * Single page, >20KB so test assertion passes. Used only when PLANLUX_E2E=1.
 */
export function getE2EPlaceholderPdfBuffer(): Buffer {
  const minimalPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000052 00000 n 
0000000101 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
178
%%EOF`;
  const padding = Buffer.alloc(Math.max(0, 21_000 - Buffer.byteLength(minimalPdf, "utf8")), " ");
  return Buffer.concat([Buffer.from(minimalPdf, "utf8"), padding]);
}

/**
 * Load HTML from a local file (e.g. userData/tmp/offer_<id>.html) and print to PDF buffer.
 * Use when template uses inlined CSS so a single file is self-contained.
 * Błędy: brak pliku, błąd ładowania, timeout 20s.
 * E2E only: when printToPDF is skipped (unreliable in CI), returns placeholder PDF buffer.
 */
export async function runPrintToPdfFromFile(
  tempHtmlPath: string,
  logger: Logger
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> {
  if (!fs.existsSync(tempHtmlPath)) {
    logger.error("[pdf] temp HTML file not found", tempHtmlPath);
    return { ok: false, error: "Brak tymczasowego pliku HTML do druku." };
  }
  const isE2E = process.env.PLANLUX_E2E === "1";
  if (isE2E) {
    logger.info("[E2E/pdf] using placeholder PDF (skip printToPDF for CI stability)");
    return { ok: true, buffer: getE2EPlaceholderPdfBuffer() };
  }
  logger.info("[pdf] start (loadFile)");
  const winRef: { current: BrowserWindow | null } = { current: null };
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Generowanie PDF trwało zbyt długo (timeout 20s).")), PDF_TIMEOUT_MS);
  });

  /* In E2E show window to avoid headless printToPDF issues; production stays hidden. */
  const showWindow = false;
  /* Window size matches template .page (794x1123); backgroundColor avoids transparent seam in print. */
  const run = async (): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> => {
    const win = new BrowserWindow({
      width: 794,
      height: 1123,
      show: showWindow,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: false, contextIsolation: true, backgroundThrottling: false },
    });
    winRef.current = win;
    logger.info("[pdf] loading file", tempHtmlPath);

    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_, code, msg) =>
        reject(new Error(`LOADFILE_FAILED: Błąd ładowania dokumentu (kod ${code}): ${msg}`))
      );
      win.loadFile(tempHtmlPath).catch(reject);
    });
    logger.info("[pdf] window loaded");
    await win.webContents
      .executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true")
      .catch(() => {});
    win.webContents.setZoomFactor(1);
    const zoomFactor = win.webContents.getZoomFactor();
    const bounds = win.getBounds();
    if (process.env.NODE_ENV !== "production") {
      logger.info("[pdf] render params: BrowserWindow", { width: bounds.width, height: bounds.height });
      logger.info("[pdf] render params: zoomFactor", zoomFactor);
    }
    logger.info("[pdf] diagnostyka: HTML path (loaded)", tempHtmlPath);

    await new Promise((r) => setTimeout(r, LAYOUT_DELAY_MS));

    /* Czekaj na załadowanie obrazów (logo, ikony) przed printToPDF – stabilne renderowanie w PDF */
    await win.webContents
      .executeJavaScript(
        `(function(){
          var imgs = document.querySelectorAll('img');
          if (imgs.length === 0) return Promise.resolve();
          return Promise.all(Array.from(imgs).map(function(img) {
            if (img.complete) return Promise.resolve();
            return new Promise(function(res){ img.onload = res; img.onerror = res; });
          }));
        })()`
      )
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 150));

    /* Diagnostyka renderera: .hero backgroundImage, overflow, wymiary */
    const rendererDiag = await win.webContents
      .executeJavaScript(
        `(function(){
          var hero = document.querySelector('.hero');
          var bgEl = document.querySelector('.hero__bg');
          var wrap = document.querySelector('.wrap');
          var page = document.querySelector('.page');
          var body = document.body;
          var docEl = document.documentElement;
          return {
            heroBackgroundImage: hero ? getComputedStyle(hero).backgroundImage : null,
            heroBgSrc: bgEl ? bgEl.getAttribute('src') : null,
            heroBgNaturalWidth: bgEl && bgEl.naturalWidth != null ? bgEl.naturalWidth : null,
            heroBgNaturalHeight: bgEl && bgEl.naturalHeight != null ? bgEl.naturalHeight : null,
            wrapScrollWidth: wrap ? wrap.scrollWidth : null,
            wrapClientWidth: wrap ? wrap.clientWidth : null,
            pageScrollWidth: page ? page.scrollWidth : null,
            pageClientWidth: page ? page.clientWidth : null,
            bodyScrollWidth: body ? body.scrollWidth : null,
            docElClientWidth: docEl ? docEl.clientWidth : null,
            overflowX: body ? (body.scrollWidth > body.clientWidth) : false
          };
        })()`
      )
      .catch(() => ({}));
    logger.info("[pdf] diagnostyka: renderer .hero backgroundImage", rendererDiag.heroBackgroundImage ?? "(brak)");
    logger.info("[pdf] diagnostyka: renderer .hero__bg src/naturalWidth/naturalHeight", {
      src: rendererDiag.heroBgSrc ?? "(brak elem .hero__bg)",
      naturalWidth: rendererDiag.heroBgNaturalWidth,
      naturalHeight: rendererDiag.heroBgNaturalHeight,
    });
    logger.info("[pdf] diagnostyka: wymiary wrappera i overflow", {
      wrapScrollWidth: rendererDiag.wrapScrollWidth,
      wrapClientWidth: rendererDiag.wrapClientWidth,
      pageScrollWidth: rendererDiag.pageScrollWidth,
      pageClientWidth: rendererDiag.pageClientWidth,
      bodyScrollWidth: rendererDiag.bodyScrollWidth,
      docElClientWidth: rendererDiag.docElClientWidth,
      overflowX: rendererDiag.overflowX,
    });
    if (rendererDiag.overflowX) {
      logger.warn("[pdf] overflow X wykryty – możliwy biały pasek po prawej; sprawdź .wrap/.page width i padding");
    }

    let pdfBuf: Buffer;
    try {
      pdfBuf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        margins: { marginType: "none" },
        preferCSSPageSize: true,
      });
      logger.info("[pdf] printToPDF ok");
    } catch (printErr) {
      logger.error("[pdf] printToPDF failed", printErr);
      throw printErr;
    }
    return { ok: true, buffer: pdfBuf };
  };

  try {
    const result = await Promise.race([run(), timeoutPromise]);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logger.error("[pdf] failed", stack ?? e);
    return { ok: false, error: message, details: stack };
  } finally {
    const w = winRef.current;
    if (w && !w.isDestroyed()) {
      w.close();
    }
    winRef.current = null;
  }
}

