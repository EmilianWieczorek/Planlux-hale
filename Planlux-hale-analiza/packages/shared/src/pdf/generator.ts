/**
 * Generator PDF: HTML → plik PDF.
 * Host (Electron/Node) dostarcza funkcję printToPdf (np. Electron webContents.printToPDF lub puppeteer).
 */

import type { PdfTemplateData } from "./template";
import { renderOfferHtml } from "./template";

export interface PdfGeneratorOptions {
  /** Funkcja zapisująca HTML jako PDF pod podaną ścieżką. Zwraca ścieżkę lub rzuca. */
  printToPdf: (html: string, outputPath: string) => Promise<string>;
  /** Katalog, w którym zapisywać PDF (np. Documents/PlanluxOferty). */
  outputDir: string;
}

/**
 * Generuje plik PDF z danych oferty i wyceny.
 * Zwraca pełną ścieżkę do pliku i sugerowaną nazwę pliku.
 */
export async function generatePdf(
  data: PdfTemplateData,
  options: PdfGeneratorOptions
): Promise<{ filePath: string; fileName: string }> {
  const html = renderOfferHtml(data);
  const safeName = data.offer.clientName.replace(/[^\p{L}\p{N}\s\-]/gu, "").replace(/\s+/g, "_").slice(0, 60);
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `Oferta_Planlux_${safeName}_${date}.pdf`;
  const filePath = `${options.outputDir.replace(/\/$/, "")}/${fileName}`;

  await options.printToPdf(html, filePath);

  return { filePath, fileName };
}
