"use strict";
/**
 * RBAC – single source of truth for role-based access.
 * Roles: HANDLOWIEC (sales), SZEF (boss/view-only admin), ADMIN (full).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLES = void 0;
exports.canAccessAdminPanel = canAccessAdminPanel;
exports.canManageUsers = canManageUsers;
exports.canManageSystemSettings = canManageSystemSettings;
exports.canViewReports = canViewReports;
exports.canUseSalesFeatures = canUseSalesFeatures;
exports.normalizeRole = normalizeRole;
exports.ROLES = ["HANDLOWIEC", "SZEF", "ADMIN"];
/** Panel admina: podgląd/zarządzanie biznesowe (aktywność, historia, statystyki). */
function canAccessAdminPanel(role) {
    const r = (role ?? "").toUpperCase();
    return r === "SZEF" || r === "ADMIN";
}
/** Zarządzanie użytkownikami: tworzenie, edycja, usuwanie, role, reset haseł. Tylko ADMIN. */
function canManageUsers(role) {
    return (role ?? "").toUpperCase() === "ADMIN";
}
/** Ustawienia systemowe (seed, reset DB, globalne SMTP itd.). Tylko ADMIN. */
function canManageSystemSettings(role) {
    return (role ?? "").toUpperCase() === "ADMIN";
}
/** Raporty / podgląd aktywności, historia PDF, e-mail – SZEF i ADMIN. */
function canViewReports(role) {
    const r = (role ?? "").toUpperCase();
    return r === "SZEF" || r === "ADMIN";
}
/** Kalkulator, oferty, PDF, e-mail – wszystkie trzy role. */
function canUseSalesFeatures(role) {
    const r = (role ?? "").toUpperCase();
    return r === "HANDLOWIEC" || r === "SZEF" || r === "ADMIN";
}
/** Zwraca rolę znormalizowaną do HANDLOWIEC | SZEF | ADMIN. Central mapping: SALES→HANDLOWIEC, MANAGER→SZEF, ADMIN→ADMIN. */
function normalizeRole(role) {
    const r = (role ?? "").trim().toUpperCase();
    if (r === "ADMIN")
        return "ADMIN";
    if (r === "SZEF" || r === "BOSS" || r === "MANAGER")
        return "SZEF";
    if (r === "SALES" || r === "HANDLOWIEC")
        return "HANDLOWIEC";
    return "HANDLOWIEC";
}
