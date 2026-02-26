/**
 * Wspólne funkcje formatowania – escapeHtml, formatCurrency.
 * Jedno źródło prawdy (DRY) dla PDF, szablonów, renderTemplate.
 */

/** Escapuje HTML (XSS prevention). */
export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Format liczby jako waluta PL (bez symbolu zł – do wstawienia obok). */
export function formatCurrency(n: number): string {
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}
