"use strict";
/**
 * Helpers do budowania nazwy pliku PDF: PLANLUX-Oferta-{KTO}-{NUMER}.pdf
 * KTO = krótsze z (handlowiec, firma klienta). Numer: PLX-E0001-2026 (bez / w nazwie).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeFilePart = sanitizeFilePart;
exports.pickShorter = pickShorter;
exports.formatOfferNumberForFile = formatOfferNumberForFile;
exports.buildPdfFileName = buildPdfFileName;
const WINDOWS_FORBIDDEN = /[\\/:*?"<>|]/g;
const MAX_SEGMENT_LEN = 40;
/** Sanityzuje fragment nazwy pliku – usuwa znaki niedozwolone w Windows. */
function sanitizeFilePart(str) {
    if (typeof str !== "string")
        return "";
    let s = str.trim();
    s = s.replace(WINDOWS_FORBIDDEN, "");
    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/\.+$/, ""); // trailing kropki
    return s.slice(0, MAX_SEGMENT_LEN);
}
/** Wybiera krótszy z dwóch stringów po sanityzacji. Jeśli jeden pusty – zwraca drugi. */
function pickShorter(a, b) {
    const sa = sanitizeFilePart(a);
    const sb = sanitizeFilePart(b);
    if (!sa)
        return sb || "Handlowiec";
    if (!sb)
        return sa;
    return sa.length <= sb.length ? sa : sb;
}
/** Zamienia / na - w numerze oferty (dla nazwy pliku w Windows). */
function formatOfferNumberForFile(offerNumber) {
    if (typeof offerNumber !== "string")
        return "PLX-X0001-2026";
    return offerNumber.replace(/\//g, "-").replace(/\s+/g, "").trim() || "PLX-X0001-2026";
}
/** Buduje nazwę pliku: PLANLUX-Oferta-{KTO}-PLX-E0001-2026.pdf */
function buildPdfFileName(params) {
    const { sellerName = "", clientCompany = "", offerNumber } = params;
    const chosen = pickShorter(sellerName, clientCompany);
    const formattedNumber = formatOfferNumberForFile(offerNumber);
    return `PLANLUX-Oferta-${chosen}-${formattedNumber}.pdf`;
}
