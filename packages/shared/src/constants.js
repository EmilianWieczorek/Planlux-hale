"use strict";
/**
 * Stałe domenowe – jedno źródło prawdy dla enumów/statusów.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTBOX_OPERATION_TYPES = exports.EMAIL_HISTORY_STATUSES = exports.USER_ROLES = exports.OFFER_STATUSES = void 0;
exports.OFFER_STATUSES = ["IN_PROGRESS", "GENERATED", "SENT", "REALIZED"];
/** Roles: HANDLOWIEC (sales), SZEF (boss), ADMIN. */
exports.USER_ROLES = ["HANDLOWIEC", "SZEF", "ADMIN"];
exports.EMAIL_HISTORY_STATUSES = ["QUEUED", "SENT", "FAILED"];
exports.OUTBOX_OPERATION_TYPES = [
    "HEARTBEAT",
    "LOG_PDF",
    "SEND_EMAIL",
    "SEND_GENERIC_EMAIL",
    "LOG_EMAIL",
    "OFFER_SYNC",
];
