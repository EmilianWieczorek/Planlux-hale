/**
 * Uprawnienia – single source of truth (re-export z rbac).
 * Używaj tych helperów wszędzie zamiast rozrzucać warunki role === 'ADMIN'.
 */

export type { Role } from "../rbac";
export {
  ROLES,
  canAccessAdminPanel,
  canManageUsers,
  canManageSystemSettings,
  canViewReports,
  canUseSalesFeatures,
  normalizeRole,
} from "../rbac";
