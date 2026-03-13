"use strict";
/**
 * Normalizacja błędów do czytelnego tekstu dla UI i logów.
 * Zawsze zwraca string; nigdy "[object Object]".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeErrorMessage = normalizeErrorMessage;
function normalizeErrorMessage(error) {
    if (error == null)
        return "Nieznany błąd";
    if (typeof error === "string")
        return error.trim() || "Nieznany błąd";
    if (error instanceof Error)
        return error.message.trim() || "Nieznany błąd";
    if (typeof error === "object") {
        const o = error;
        if (typeof o.message === "string" && o.message.trim())
            return o.message.trim();
        if (typeof o.error === "string" && o.error.trim())
            return o.error.trim();
        if (typeof o.error === "object" && o.error != null && typeof o.error.message === "string") {
            const msg = o.error.message;
            if (msg.trim())
                return msg.trim();
        }
        if (typeof o.details === "string" && o.details.trim())
            return o.details.trim();
        if (typeof o.msg === "string" && o.msg.trim())
            return o.msg.trim();
        if (typeof o.code === "string" && o.code.trim())
            return `Błąd: ${o.code}`;
    }
    const s = String(error);
    return s === "[object Object]" ? "Nieznany błąd" : s;
}
