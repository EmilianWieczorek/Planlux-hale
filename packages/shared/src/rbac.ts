/**
 * RBAC – single source of truth for role-based access.
 * Roles: HANDLOWIEC (sales), SZEF (boss/view-only admin), ADMIN (full).
 */

export const ROLES = ["HANDLOWIEC", "SZEF", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Panel admina: podgląd/zarządzanie biznesowe (aktywność, historia, statystyki). */
export function canAccessAdminPanel(role: string | null | undefined): boolean {
  const r = (role ?? "").toUpperCase();
  return r === "SZEF" || r === "ADMIN";
}

/** Zarządzanie użytkownikami: tworzenie, edycja, usuwanie, role, reset haseł. Tylko ADMIN. */
export function canManageUsers(role: string | null | undefined): boolean {
  return (role ?? "").toUpperCase() === "ADMIN";
}

/** Ustawienia systemowe (seed, reset DB, globalne SMTP itd.). Tylko ADMIN. */
export function canManageSystemSettings(role: string | null | undefined): boolean {
  return (role ?? "").toUpperCase() === "ADMIN";
}

/** Raporty / podgląd aktywności, historia PDF, e-mail – SZEF i ADMIN. */
export function canViewReports(role: string | null | undefined): boolean {
  const r = (role ?? "").toUpperCase();
  return r === "SZEF" || r === "ADMIN";
}

/** Kalkulator, oferty, PDF, e-mail – wszystkie trzy role. */
export function canUseSalesFeatures(role: string | null | undefined): boolean {
  const r = (role ?? "").toUpperCase();
  return r === "HANDLOWIEC" || r === "SZEF" || r === "ADMIN";
}

/** Zwraca rolę znormalizowaną do HANDLOWIEC | SZEF | ADMIN. */
export function normalizeRole(role: string | null | undefined): Role {
  const r = (role ?? "").trim().toUpperCase();
  if (r === "ADMIN") return "ADMIN";
  if (r === "SZEF" || r === "BOSS" || r === "MANAGER") return "SZEF";
  return "HANDLOWIEC";
}
