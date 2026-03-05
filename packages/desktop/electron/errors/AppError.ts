/**
 * Structured application errors – stable codes, optional public message.
 */

export interface AppErrorOptions {
  status?: number;
  cause?: unknown;
  details?: unknown;
  /** If true, message/details are safe to show in UI. */
  expose?: boolean;
}

const GENERIC_MESSAGE = "Wystąpił błąd. Spróbuj ponownie.";

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly cause?: unknown;
  readonly expose: boolean;

  constructor(
    code: string,
    message: string,
    opts: AppErrorOptions = {}
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = opts.status ?? 500;
    this.details = opts.details;
    this.cause = opts.cause;
    this.expose = opts.expose ?? false;
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, AppError);
    }
  }

  toPublic(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.expose ? this.message : GENERIC_MESSAGE,
      ...(this.expose && this.details !== undefined ? { details: this.details } : {}),
    };
  }

  static fromUnknown(err: unknown): AppError {
    if (err instanceof AppError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AUTH_SESSION_EXPIRED") || msg === "AUTH_SESSION_EXPIRED") {
      return new AppError("AUTH_SESSION_EXPIRED", "Sesja wygasła. Zaloguj się ponownie.", { expose: true, cause: err });
    }
    if (msg.includes("Unauthorized") || msg.includes("Forbidden")) {
      return new AppError("AUTH_FORBIDDEN", msg, { status: 403, expose: true, cause: err });
    }
    if (msg.includes("UNIQUE") || msg.includes("SQLITE_CONSTRAINT") || msg.includes("constraint")) {
      return new AppError("DB_CONSTRAINT", "Nie można zapisać zmian (konflikt danych).", { expose: true, cause: err });
    }
    if (msg.includes("abort") || msg.includes("timeout") || msg.includes("network") || msg.includes("fetch")) {
      return new AppError("NET_OFFLINE", "Brak połączenia z internetem.", { expose: true, cause: err });
    }
    return new AppError("UNKNOWN_ERROR", msg, { cause: err });
  }
}

export const authErrors = {
  invalidCredentials: () =>
    new AppError("AUTH_INVALID_CREDENTIALS", "Nieprawidłowy email lub hasło.", { status: 401, expose: true }),
  sessionExpired: () =>
    new AppError("AUTH_SESSION_EXPIRED", "Sesja wygasła. Zaloguj się ponownie.", { expose: true }),
  offlineUserNotFound: () =>
    new AppError("AUTH_OFFLINE_USER_NOT_FOUND", "Zaloguj się przy połączeniu z internetem (brak danych offline).", { expose: true }),
  offlineRequiresOnline: () =>
    new AppError("AUTH_OFFLINE_REQUIRES_ONLINE_LOGIN_ONCE", "Zaloguj się raz online, aby aktywować tryb offline.", { expose: true }),
};

export const dbErrors = {
  constraint: (table?: string, field?: string) =>
    new AppError("DB_CONSTRAINT", "Nie można zapisać zmian (konflikt danych).", { expose: true, details: table || field ? { table, field } : undefined }),
  generic: (message: string) =>
    new AppError("DB_ERROR", message, { expose: true }),
};
