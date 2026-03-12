/**
 * Parsuje tekstowy warunek zakresu wysokości (np. z addons_surcharges) na min/max w metrach.
 * Używane do automatycznej "Dopłata za wysokość".
 * Przykłady: "4,6-5 m" -> { min: 4.6, max: 5 }; "5,01-6 m" -> { min: 5.01, max: 6 }.
 */

export interface HeightRange {
  min?: number;
  max?: number;
}

/**
 * Parsuje condition (np. "4,6-5 m", "5,01-6 m") na { min, max }.
 * Przecinek zamieniany na kropkę. Zwraca null przy błędzie (bez rzucania).
 */
export function parseHeightCondition(condition: string | null | undefined): HeightRange | null {
  const raw = (condition ?? "").trim();
  if (!raw) return null;
  try {
    const normalized = raw.replace(/,/g, ".").replace(/\s+/g, " ");
    /**
     * Accept both pure ranges ("5.01-6 m") and prefixed strings from DB
     * (e.g. "wysokość 5.01-6 m", "wysokosc 5.01–6 m").
     * We extract the first "min-max" numeric range anywhere in the string.
     */
    const rangeMatch = normalized.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*m)?/i);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
        return { min, max };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Sprawdza, czy wysokość (m) wpada w zakres z condition lub w min/max.
 */
export function heightInRange(
  heightM: number | null | undefined,
  condition: string | null | undefined,
  minNum?: number | null,
  maxNum?: number | null
): boolean {
  if (heightM == null || !Number.isFinite(heightM)) return false;
  const h = heightM;
  if (minNum != null && maxNum != null && Number.isFinite(minNum) && Number.isFinite(maxNum)) {
    return h >= minNum && h <= maxNum;
  }
  const parsed = parseHeightCondition(condition ?? "");
  if (parsed) {
    const { min, max } = parsed;
    if (min != null && max != null) return h >= min && h <= max;
    if (min != null) return h >= min;
    if (max != null) return h <= max;
  }
  return false;
}
