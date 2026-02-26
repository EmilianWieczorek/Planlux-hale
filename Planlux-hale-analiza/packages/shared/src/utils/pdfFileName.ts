/**
 * Helpers do budowania nazwy pliku PDF: PLANLUX-Oferta-{KTO}-{NUMER}.pdf
 * KTO = krótsze z (handlowiec, firma klienta). Numer: PLX-E0001-2026 (bez / w nazwie).
 */

const WINDOWS_FORBIDDEN = /[\\/:*?"<>|]/g;
const MAX_SEGMENT_LEN = 40;

/** Sanityzuje fragment nazwy pliku – usuwa znaki niedozwolone w Windows. */
export function sanitizeFilePart(str: string): string {
  if (typeof str !== "string") return "";
  let s = str.trim();
  s = s.replace(WINDOWS_FORBIDDEN, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\.+$/, ""); // trailing kropki
  return s.slice(0, MAX_SEGMENT_LEN);
}

/** Wybiera krótszy z dwóch stringów po sanityzacji. Jeśli jeden pusty – zwraca drugi. */
export function pickShorter(a: string, b: string): string {
  const sa = sanitizeFilePart(a);
  const sb = sanitizeFilePart(b);
  if (!sa) return sb || "Handlowiec";
  if (!sb) return sa;
  return sa.length <= sb.length ? sa : sb;
}

/** Zamienia / na - w numerze oferty (dla nazwy pliku w Windows). */
export function formatOfferNumberForFile(offerNumber: string): string {
  if (typeof offerNumber !== "string") return "PLX-X0001-2026";
  return offerNumber.replace(/\//g, "-").replace(/\s+/g, "").trim() || "PLX-X0001-2026";
}

export interface BuildPdfFileNameParams {
  sellerName?: string;
  clientCompany?: string;
  offerNumber: string;
}

/** Buduje nazwę pliku: PLANLUX-Oferta-{KTO}-PLX-E0001-2026.pdf */
export function buildPdfFileName(params: BuildPdfFileNameParams): string {
  const { sellerName = "", clientCompany = "", offerNumber } = params;
  const chosen = pickShorter(sellerName, clientCompany);
  const formattedNumber = formatOfferNumberForFile(offerNumber);
  return `PLANLUX-Oferta-${chosen}-${formattedNumber}.pdf`;
}
