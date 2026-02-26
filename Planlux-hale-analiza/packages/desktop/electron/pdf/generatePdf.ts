/**
 * PDF generation pipeline: hidden BrowserWindow + printToPDF.
 * Timeout 20s, deterministic output dir, always close window, structured result.
 */

import { app, BrowserWindow } from "electron";
import path from "path";
import fs from "fs";

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
 * Resolve output directory: documents/Planlux Hale/output or userData/output.
 */
export function getPdfOutputDir(): string {
  try {
    const docs = app.getPath("documents");
    const dir = path.join(docs, "Planlux Hale", "output");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const dir = path.join(app.getPath("userData"), "output");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

/**
 * Katalog na tymczasowe PDF preview (userData/preview).
 */
export function getPdfPreviewDir(): string {
  const dir = path.join(app.getPath("userData"), "preview");
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
 * Load HTML from a local file (e.g. userData/tmp/offer_<id>.html) and print to PDF buffer.
 * Use when template uses inlined CSS so a single file is self-contained.
 * Błędy: brak pliku, błąd ładowania, timeout 20s.
 */
export async function runPrintToPdfFromFile(
  tempHtmlPath: string,
  logger: Logger
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> {
  if (!fs.existsSync(tempHtmlPath)) {
    logger.error("[pdf] temp HTML file not found", tempHtmlPath);
    return { ok: false, error: "Brak tymczasowego pliku HTML do druku." };
  }
  logger.info("[pdf] start (loadFile)");
  const winRef: { current: BrowserWindow | null } = { current: null };
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Generowanie PDF trwało zbyt długo (timeout 20s).")), PDF_TIMEOUT_MS);
  });

  /* Window size matches template .page (794x1123); backgroundColor avoids transparent seam in print. */
  const run = async (): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string; details?: string }> => {
    const win = new BrowserWindow({
      width: 794,
      height: 1123,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: { sandbox: false, contextIsolation: true, backgroundThrottling: false },
    });
    winRef.current = win;
    logger.info("[pdf] loading file", tempHtmlPath);

    await new Promise<void>((resolve, reject) => {
      win.webContents.once("did-finish-load", () => resolve());
      win.webContents.once("did-fail-load", (_, code, msg) =>
        reject(new Error(`Błąd ładowania dokumentu (kod ${code}): ${msg}`))
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

    /* Diagnostyka renderera: .hero backgroundImage i ewentualny .hero__bg */
    const rendererDiag = await win.webContents
      .executeJavaScript(
        `(function(){
          var hero = document.querySelector('.hero');
          var bgEl = document.querySelector('.hero__bg');
          return {
            heroBackgroundImage: hero ? getComputedStyle(hero).backgroundImage : null,
            heroBgSrc: bgEl ? bgEl.getAttribute('src') : null,
            heroBgNaturalWidth: bgEl && bgEl.naturalWidth != null ? bgEl.naturalWidth : null,
            heroBgNaturalHeight: bgEl && bgEl.naturalHeight != null ? bgEl.naturalHeight : null
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

