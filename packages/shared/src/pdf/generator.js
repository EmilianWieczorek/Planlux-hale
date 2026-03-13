"use strict";
/**
 * Generator PDF: HTML → plik PDF.
 * Host (Electron/Node) dostarcza funkcję printToPdf (np. Electron webContents.printToPDF lub puppeteer).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePdf = generatePdf;
const template_1 = require("./template");
/**
 * Generuje plik PDF z danych oferty i wyceny.
 * Zwraca pełną ścieżkę do pliku i sugerowaną nazwę pliku.
 */
async function generatePdf(data, options) {
    const html = (0, template_1.renderOfferHtml)(data);
    const safeName = data.offer.clientName.replace(/[^\p{L}\p{N}\s\-]/gu, "").replace(/\s+/g, "_").slice(0, 60);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `Oferta_Planlux_${safeName}_${date}.pdf`;
    const filePath = `${options.outputDir.replace(/\/$/, "")}/${fileName}`;
    await options.printToPdf(html, filePath);
    return { filePath, fileName };
}
