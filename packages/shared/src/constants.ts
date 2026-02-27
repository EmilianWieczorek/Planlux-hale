/**
 * Stałe domenowe – jedno źródło prawdy dla enumów/statusów.
 */

export const OFFER_STATUSES = ["IN_PROGRESS", "GENERATED", "SENT", "REALIZED"] as const;
export type OfferStatusValue = (typeof OFFER_STATUSES)[number];

/** USER=SALESPERSON alias; BOSS=MANAGER alias for compatibility */
export const USER_ROLES = ["USER", "SALESPERSON", "BOSS", "MANAGER", "ADMIN"] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

export const EMAIL_HISTORY_STATUSES = ["QUEUED", "SENT", "FAILED"] as const;
export type EmailHistoryStatusValue = (typeof EMAIL_HISTORY_STATUSES)[number];

export const OUTBOX_OPERATION_TYPES = [
  "HEARTBEAT",
  "LOG_PDF",
  "SEND_EMAIL",
  "SEND_GENERIC_EMAIL",
  "LOG_EMAIL",
  "OFFER_SYNC",
] as const;
