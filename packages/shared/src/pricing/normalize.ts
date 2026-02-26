/**
 * Normalizacja wartości liczbowych z bazy (Sheets).
 * Traktuje stringi typu "4 000", "4,5", "4 000zł", "40zł" jako liczby.
 */

export function toNumber(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const cleaned = value
      .replace(/\s/g, "")
      .replace(/[,]/g, ".")
      .replace(/[złzl\s]/gi, "");
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function normalizeJednostka(j: string | undefined): string {
  if (!j || typeof j !== "string") return "szt";
  const s = j.toLowerCase().trim();
  if (s === "mkw" || s === "m2") return "m2";
  if (s === "mb") return "mb";
  if (s === "szt") return "szt";
  if (s === "kpl") return "kpl";
  return s;
}

export function toInt(value: unknown): number {
  return Math.round(toNumber(value));
}
