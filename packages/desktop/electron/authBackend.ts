/**
 * Auth and users sync with Apps Script backend (Google Sheets USERS).
 * POST actions: login, listUsers, upsertUser.
 */

const AUTH_TIMEOUT_MS = 8000;

export type BackendUser = { email: string; role: string; name?: string; active?: boolean };
export type LoginResponse = { ok: true; user: BackendUser } | { ok: false; error?: string };
export type ListUsersResponse = { ok: true; users: BackendUser[] } | { ok: false; error?: string };
export type UpsertUserResponse = { ok: true } | { ok: false; error?: string };

export async function loginViaBackend(
  baseUrl: string,
  email: string,
  password: string
): Promise<LoginResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email: email.trim().toLowerCase(), password }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = (await res.json()) as LoginResponse;
    return data ?? { ok: false, error: "Brak odpowiedzi" };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

export async function listUsersFromBackend(baseUrl: string): Promise<ListUsersResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listUsers" }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = (await res.json()) as ListUsersResponse;
    return data ?? { ok: false, error: "Brak odpowiedzi" };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

export async function upsertUserViaBackend(
  baseUrl: string,
  payload: { email: string; name?: string; role?: string; tempPassword?: string; active?: number }
): Promise<UpsertUserResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upsertUser",
        email: (payload.email ?? "").trim().toLowerCase(),
        name: (payload.name ?? "").trim() || undefined,
        role: payload.role ?? "HANDLOWIEC",
        tempPassword: payload.tempPassword ?? undefined,
        active: payload.active ?? 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    const data = (await res.json()) as UpsertUserResponse;
    return data ?? { ok: false, error: "Brak odpowiedzi" };
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}
