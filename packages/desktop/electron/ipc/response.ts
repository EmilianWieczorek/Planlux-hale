/**
 * Normalized IPC response: ok/data or ok:false with error { code, message }.
 * Wrapper catches thrown errors and returns stable shape; preserves legacy fields.
 */

import crypto from "crypto";
import { AppError } from "../errors/AppError";

export type Ok<T = unknown> = { ok: true; data?: T } & Record<string, unknown>;
export type Fail = {
  ok: false;
  error: { code: string; message: string; details?: unknown };
  correlationId?: string;
} & Record<string, unknown>;

export type IpcResult = Ok | Fail;

function correlationId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export type WrapOptions = {
  scope?: string;
  /** If true, keep all top-level keys from handler result on success. */
  legacyPassthrough?: boolean;
};

export type LogFn = (msg: string, meta?: unknown) => void;

/**
 * Wraps an async IPC handler: normalizes return shape, catches throws, logs with correlationId.
 * - Success: if result has ok:true, return as-is (ensure legacy fields). If result is object without ok, return { ok: true, ...result }. If primitive, return { ok: true, data: result }.
 * - Throw: convert to AppError, log (stack/cause not sent to UI), return { ok: false, error: toPublic(), correlationId } plus legacy `error` string for old UI.
 */
export function wrapIpcHandler<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: unknown, ...args: TArgs) => Promise<TResult> | TResult,
  opts: { scope?: string; legacyPassthrough?: boolean; log: LogFn } = { log: () => {} }
): (event: unknown, ...args: TArgs) => Promise<IpcResult & Record<string, unknown>> {
  const scope = opts.scope ?? channel;
  const log = opts.log;
  return async (event: unknown, ...args: TArgs): Promise<IpcResult & Record<string, unknown>> => {
    const cid = correlationId();
    try {
      const result = await handler(event, ...args);
      if (result != null && typeof result === "object" && "ok" in result) {
        const r = result as Record<string, unknown>;
        if (r.ok === false) {
          const err = r.error;
          const code = typeof err === "object" && err != null && "code" in err ? String((err as { code: string }).code) : (typeof r.errorCode === "string" ? r.errorCode : "UNKNOWN_ERROR");
          const message = typeof err === "object" && err != null && "message" in err ? String((err as { message: string }).message) : String(err ?? "Wystąpił błąd.");
          return {
            ...r,
            ok: false,
            error: { code, message },
            correlationId: cid,
            errorCode: code,
            errorMessage: message,
          } as Fail & Record<string, unknown>;
        }
        return { ok: true, ...r, correlationId: cid } as Ok & Record<string, unknown>;
      }
      if (result != null && typeof result === "object") {
        return { ok: true, ...(result as Record<string, unknown>) } as Ok & Record<string, unknown>;
      }
      return { ok: true, data: result } as Ok & Record<string, unknown>;
    } catch (err) {
      const appErr = AppError.fromUnknown(err);
      log(`[${scope}] error`, { correlationId: cid, code: appErr.code, message: appErr.message, stack: err instanceof Error ? err.stack : undefined });
      const pub = appErr.toPublic();
      return {
        ok: false,
        error: pub,
        correlationId: cid,
        errorCode: pub.code,
        errorMessage: pub.message,
      } as Fail & Record<string, unknown>;
    }
  };
}
