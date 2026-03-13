"use strict";
/**
 * Wspólne funkcje formatowania – escapeHtml, formatCurrency.
 * Jedno źródło prawdy (DRY) dla PDF, szablonów, renderTemplate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeHtml = escapeHtml;
exports.formatCurrency = formatCurrency;
/** Escapuje HTML (XSS prevention). */
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/** Format liczby jako waluta PL (bez symbolu zł – do wstawienia obok). */
function formatCurrency(n) {
    return new Intl.NumberFormat("pl-PL", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(n);
}
