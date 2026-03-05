/**
 * Safe error message extraction from IPC responses.
 * Supports: normalized { error: { code, message } }, legacy errorMessage/errorCode, string error.
 */
export function getErrorMessage(res: unknown): string {
  if (res == null) return "Wystąpił błąd.";
  const r = res as Record<string, unknown>;
  if (typeof r.errorMessage === "string" && r.errorMessage.trim()) return r.errorMessage.trim();
  if (typeof r.error === "string" && r.error.trim()) return r.error.trim();
  if (r.error && typeof r.error === "object" && typeof (r.error as { message?: string }).message === "string") {
    const msg = (r.error as { message: string }).message.trim();
    if (msg) return msg;
  }
  if (typeof r.message === "string" && r.message.trim()) return r.message.trim();
  return "Nie udało się wykonać operacji.";
}
