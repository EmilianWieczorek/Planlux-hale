/**
 * IPC handlers – bridge renderer <-> main.
 * Auth: session lives in main; never trust userId from renderer.
 */

import { ipcMain, app, shell, net } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import type { GeneratePdfPayload } from "@planlux/shared";
import { generatePdfPipeline } from "./pdf/generatePdf";
import { generatePdfFromTemplate, mapOfferDataToPayload, type GeneratePdfFromTemplateOptions } from "./pdf/generatePdfFromTemplate";
import { getTestPdfFileName } from "./pdf/generatePdf";
import { getPdfTemplateDir } from "./pdf/pdfPaths";
import { createSendEmailForFlush } from "./smtpSend";
import { sendEmail as sendSmtpEmail } from "./mail";
import { createFilePdfTemplateConfigStore } from "./pdf/pdfTemplateConfigStore";
import { getPreviewHtmlWithInlinedAssets } from "./pdf/renderTemplate";
import { getNextOfferNumber as getNextOfferNumberLocal } from "./offerCounters";

/** Session: current user in main process. Set on login, cleared on logout. */
export type SessionUser = { id: string; email: string; role: string; displayName: string | null };
let currentUser: SessionUser | null = null;

export function setSession(user: SessionUser | null): void {
  currentUser = user;
}

export function getSession(): SessionUser | null {
  return currentUser;
}

/** Throws if not logged in. Returns session user. */
function requireAuth(): SessionUser {
  if (!currentUser) throw new Error("Unauthorized");
  return currentUser;
}

/** Throws if not logged in or role not in allowed. Returns session user. */
function requireRole(allowedRoles: string[]): SessionUser {
  const user = requireAuth();
  if (!allowedRoles.includes(user.role)) throw new Error("Forbidden");
  return user;
}

const SALT = "planlux-hale-v1";

const ALLOWED_ROLES = ["ADMIN", "BOSS", "SALESPERSON"] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function normalizeRole(input: string): AllowedRole {
  const r = (input ?? "").trim().toUpperCase();
  if (r === "ADMIN") return "ADMIN";
  if (r === "BOSS" || r === "MANAGER" || r === "SZEF") return "BOSS";
  if (r === "SALESPERSON" || r === "USER" || r === "HANDLOWIEC") return "SALESPERSON";
  return "SALESPERSON";
}

function hashPassword(password: string): string {
  return crypto.scryptSync(password, SALT, 64).toString("hex");
}

function verifyPassword(password: string, hash: string): boolean {
  const h = hashPassword(password);
  return crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex"));
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Pierwsza litera imienia handlowca. displayName → pierwsze słowo; fallback: pierwsza litera emaila; ostatecznie X */
function getSalesInitial(user: { displayName?: string; firstName?: string; email?: string } | null | undefined): string {
  const name = (user?.firstName?.trim() || (user?.displayName?.trim().split(/\s+/)[0] ?? "")).trim();
  if (name) {
    const char = name.charAt(0);
    if (/[a-zA-Z]/.test(char)) return char.toUpperCase();
  }
  const emailFirst = (user?.email ?? "").trim().charAt(0);
  if (/[a-zA-Z0-9]/.test(emailFirst)) return emailFirst.toUpperCase();
  return "X";
}

const CHECK_INTERNET_URL = "https://example.com/favicon.ico";
const CHECK_INTERNET_TIMEOUT_MS = 3000;

function checkInternetNet(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), CHECK_INTERNET_TIMEOUT_MS);
    try {
      const request = net.request(CHECK_INTERNET_URL);
      request.on("response", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      request.on("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
      request.end();
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

export function   registerIpcHandlers(deps: {
  getDb: () => ReturnType<typeof import("better-sqlite3")>;
  apiClient: import("@planlux/shared").ApiClient;
  config: { appVersion: string };
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}) {
  const { getDb, config, apiClient, logger } = deps;

  ipcMain.handle("planlux:login", async (_, email: string, password: string) => {
    try {
      if (typeof email !== "string" || typeof password !== "string") {
        return { ok: false, error: "Invalid input" };
      }
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email.trim().toLowerCase()) as
        | { id: string; email: string; role: string; password_hash: string; display_name: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        return { ok: false, error: "Nieprawidłowy email lub hasło" };
      }
      const user: SessionUser = {
        id: row.id,
        email: row.email,
        role: normalizeRole(row.role),
        displayName: row.display_name ?? null,
      };
      currentUser = user;
      const sessionId = uuid();
      db.prepare(
        "INSERT INTO sessions (id, user_id, device_type, app_version) VALUES (?, ?, 'desktop', ?)"
      ).run(sessionId, row.id, config.appVersion);
      return {
        ok: true,
        user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
        sessionId,
      };
    } catch (e) {
      logger.error("login failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:logout", async () => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      currentUser = null;
      return { ok: true };
    } catch (e) {
      logger.error("logout failed", e);
      currentUser = null;
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:endSession", async () => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      currentUser = null;
      return { ok: true };
    } catch (e) {
      logger.error("endSession failed", e);
      return { ok: false };
    }
  });

  ipcMain.handle("planlux:getPricingCache", async () => {
    try {
      const { getCachedBase } = await import("../src/infra/db");
      const base = getCachedBase(getDb());
      if (!base) return { ok: true, data: null };
      return { ok: true, data: base };
    } catch (e) {
      logger.error("getPricingCache failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:syncPricing", async () => {
    try {
      const { syncBaseIfNeeded } = await import("../src/infra/baseSync");
      const { getLocalVersion, saveBase } = await import("../src/infra/db");
      const { config } = await import("../src/config");
      const db = getDb();
      const result = await syncBaseIfNeeded(
        apiClient,
        config.backend.url,
        globalThis.fetch.bind(globalThis),
        () => getLocalVersion(db),
        (base) => saveBase(db, base),
        logger
      );
      return {
        ok: result.status !== "error",
        status: result.status,
        version: result.version,
        lastUpdated: result.lastUpdated,
        error: result.error,
      };
    } catch (e) {
      logger.error("syncPricing failed", e);
      return { ok: false, status: "error", error: String(e) };
    }
  });

  ipcMain.handle("base:sync", async () => {
    const { syncBaseIfNeeded } = await import("../src/infra/baseSync");
    const { getLocalVersion, saveBase, getCachedBase } = await import("../src/infra/db");
    const { createOutboxStorage } = await import("../src/db/outboxStorage");
    const { flushOutbox } = await import("@planlux/shared");
    const { config } = await import("../src/config");
    const db = getDb();
    const result = await syncBaseIfNeeded(
      apiClient,
      config.backend.url,
      globalThis.fetch.bind(globalThis),
      () => getLocalVersion(db),
      (base) => saveBase(db, base),
      logger
    );
    const base = getCachedBase(db);
    if (result.status === "synced" || result.status === "unchanged" || result.status === "offline") {
      flushOutbox({
        api: apiClient,
        storage: createOutboxStorage(db as Parameters<typeof createOutboxStorage>[0]),
        isOnline: () => true,
        sendEmail: createSendEmailForFlush(getDb),
      }).then((r) => {
        if (r.processed > 0 || r.failed > 0) logger.info("[outbox] flush after sync", r);
      }).catch((e) => logger.error("[outbox] flush after sync failed", e));
    }
    return {
      ok: result.status !== "error",
      status: result.status,
      version: result.version,
      lastUpdated: result.lastUpdated ?? base?.lastUpdated,
      data: base,
      error: result.error,
    };
  });

  ipcMain.handle("planlux:calculatePrice", async (_, input: unknown) => {
    try {
      const { calculatePrice } = await import("@planlux/shared");
      const db = getDb();
      const row = db.prepare(
        "SELECT cennik_json, dodatki_json, standard_json FROM pricing_cache ORDER BY pricing_version DESC LIMIT 1"
      ).get() as { cennik_json: string; dodatki_json: string; standard_json: string } | undefined;
      if (!row) return { ok: false, error: "Brak bazy cennika. Połącz się z internetem i uruchom synchronizację." };
      const data = {
        cennik: JSON.parse(row.cennik_json),
        dodatki: JSON.parse(row.dodatki_json),
        standard: JSON.parse(row.standard_json),
      };
      const inp = input as {
        variantHali: string;
        widthM: number;
        lengthM: number;
        heightM?: number;
        selectedAdditions: Array<{ nazwa: string; ilosc: number }>;
        standardSnapshot?: Array<{ element: string; pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA" }>;
        rainGuttersAuto?: boolean;
        gates?: Array<{ width: number; height: number; quantity: number }>;
        heightSurchargeAuto?: boolean;
        manualSurcharges?: Array<{ description: string; amount: number }>;
      };
      const areaM2 = inp.widthM * inp.lengthM;
      const perimeterMb = 2 * (inp.widthM + inp.lengthM);
      const result = calculatePrice(data, {
        ...inp,
        areaM2,
        perimeterMb,
      });
      return { ok: true, result };
    } catch (e) {
      logger.error("calculatePrice failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:seedAdmin", async () => {
    try {
      const db = getDb();
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@planlux.pl");
      if (existing) return { ok: true, message: "Admin already exists" };
      const id = uuid();
      const hash = hashPassword("admin123");
      db.prepare(
        "INSERT INTO users (id, email, password_hash, role, active) VALUES (?, ?, ?, 'ADMIN', 1)"
      ).run(id, "admin@planlux.pl", hash);
      logger.info("Seeded admin user");
      return { ok: true };
    } catch (e) {
      logger.error("seedAdmin failed", e);
      return { ok: false, error: String(e) };
    }
  });

  /** Dodaje heartbeat do outbox i zapisuje lokalnie w activity (dla panelu admina). */
  ipcMain.handle("planlux:enqueueHeartbeat", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(user.id) as { email: string } | undefined;
      if (!userRow) return { ok: false, error: "Użytkownik nie znaleziony" };
      const { generateOutboxId } = await import("@planlux/shared");
      const config = (await import("../src/config")).config;
      const payload = {
        id: uuid(),
        userId: user.id,
        userEmail: userRow.email,
        deviceType: "desktop" as const,
        appVersion: config.appVersion ?? "1.0.0",
        occurredAt: new Date().toISOString(),
      };
      const outboxId = generateOutboxId();
      db.prepare("INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'HEARTBEAT', ?, 0, 5)").run(outboxId, JSON.stringify(payload));
      const activityTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").all() as Array<{ name: string }>;
      if (activityTables.length > 0) {
        db.prepare("INSERT INTO activity (id, user_id, device_type, app_version, online, occurred_at, synced) VALUES (?, ?, ?, ?, 1, ?, 0)").run(
          uuid(),
          user.id,
          "desktop",
          config.appVersion ?? "1.0.0",
          payload.occurredAt
        );
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("enqueueHeartbeat failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getActivity", async (_, options?: { all?: boolean }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, data: [] };
      const showAll = options?.all === true && (user.role === "ADMIN" || user.role === "BOSS");
      const rows = showAll
        ? db.prepare(
            `SELECT a.id, a.user_id, a.device_type, a.app_version, a.occurred_at, u.display_name as user_display_name, u.email as user_email
             FROM activity a LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.occurred_at DESC LIMIT 200`
          ).all()
        : db.prepare("SELECT * FROM activity WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100").all(user.id);
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, data: [] };
      }
      logger.error("getActivity failed", e);
      return { ok: false, error: String(e), data: [] };
    }
  });

  ipcMain.handle("planlux:getUsers", async () => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const rows = db.prepare("SELECT id, email, role, display_name, active, created_at FROM users ORDER BY email").all() as Array<{
        id: string;
        email: string;
        role: string;
        display_name: string;
        active: number;
        created_at: string;
      }>;
      return {
        ok: true,
        users: rows.map((r) => ({
          id: r.id,
          email: r.email,
          role: normalizeRole(r.role),
          displayName: r.display_name ?? "",
          active: Boolean(r.active),
          createdAt: r.created_at ?? "",
        })),
      };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, users: [] };
      }
      logger.error("getUsers failed", e);
      return { ok: false, error: String(e), users: [] };
    }
  });

  /** Admin: utwórz użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:createUser", async (_, payload: { email: string; password: string; displayName?: string; role?: string }) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const email = (payload.email ?? "").trim().toLowerCase();
      if (!email) return { ok: false, error: "Email jest wymagany" };
      const password = payload.password ?? "";
      if (password.length < 4) return { ok: false, error: "Hasło musi mieć min. 4 znaki" };
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) return { ok: false, error: "Użytkownik z tym adresem email już istnieje" };
      const id = uuid();
      const hash = hashPassword(password);
      const role = normalizeRole(payload.role ?? "SALESPERSON");
      const displayName = (payload.displayName ?? "").trim() || null;
      db.prepare(
        "INSERT INTO users (id, email, password_hash, role, display_name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))"
      ).run(id, email, hash, role, displayName);
      logger.info("[admin] createUser", { email, role });
      return { ok: true, id };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] createUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Admin: aktualizuj użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:updateUser", async (_, targetUserId: string, payload: { email?: string; displayName?: string; role?: string; password?: string }) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
      if (!target) return { ok: false, error: "Użytkownik nie znaleziony" };
      const updates: string[] = [];
      const values: unknown[] = [];
      if (payload.email !== undefined) {
        const email = payload.email.trim().toLowerCase();
        if (!email) return { ok: false, error: "Email nie może być pusty" };
        const existing = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, targetUserId);
        if (existing) return { ok: false, error: "Inny użytkownik ma ten adres email" };
        updates.push("email = ?");
        values.push(email);
      }
      if (payload.displayName !== undefined) {
        updates.push("display_name = ?");
        values.push((payload.displayName ?? "").trim() || null);
      }
      if (payload.role !== undefined) {
        const role = normalizeRole(payload.role);
        updates.push("role = ?");
        values.push(role);
      }
      if (payload.password !== undefined && payload.password.length > 0) {
        if (payload.password.length < 4) return { ok: false, error: "Hasło musi mieć min. 4 znaki" };
        updates.push("password_hash = ?");
        values.push(hashPassword(payload.password));
      }
      if (updates.length === 0) return { ok: true };
      updates.push("updated_at = datetime('now')");
      values.push(targetUserId);
      db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      logger.info("[admin] updateUser", { targetUserId });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] updateUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Admin: wyłącz/włącz użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:disableUser", async (_, targetUserId: string, active: boolean) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
      if (!target) return { ok: false, error: "Użytkownik nie znaleziony" };
      db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, targetUserId);
      logger.info("[admin] disableUser", { targetUserId, active });
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[admin] disableUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:getOffers", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const seeAll = user.role === "ADMIN" || user.role === "BOSS";
      const rows = seeAll
        ? db.prepare("SELECT * FROM offers ORDER BY created_at DESC LIMIT 200").all()
        : db.prepare("SELECT * FROM offers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(user.id);
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("getOffers failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:saveOffer", async (_, offer: unknown) => {
    try {
      const db = getDb();
      const o = offer as {
        id: string;
        userId: string;
        clientName: string;
        clientEmail?: string;
        clientPhone?: string;
        widthM: number;
        lengthM: number;
        heightM?: number;
        areaM2: number;
        variantHali: string;
        variantNazwa?: string;
        totalPln: number;
        clientJson?: string;
        hallJson?: string;
        pricingJson?: string;
      };
      db.prepare(
        `INSERT OR REPLACE INTO offers (id, user_id, client_name, client_email, client_phone, width_m, length_m, height_m, area_m2, variant_hali, variant_nazwa, total_pln, base_row_json, additions_json, standard_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).run(
        o.id,
        o.userId,
        o.clientName,
        o.clientEmail ?? null,
        o.clientPhone ?? null,
        o.widthM,
        o.lengthM,
        o.heightM ?? null,
        o.areaM2,
        o.variantHali,
        o.variantNazwa ?? null,
        o.totalPln,
        o.pricingJson ?? "{}",
        "[]",
        "[]"
      );
      return { ok: true };
    } catch (e) {
      logger.error("saveOffer failed", e);
      return { ok: false, error: String(e) };
    }
  });

  const PDF_HANDLER_TIMEOUT_MS = 20_000;
  type PdfHandlerResult = { ok: true; pdfId: string; filePath: string; fileName: string } | { ok: false; error: string; details?: string };

  async function handlePdfGenerate(
    offerData: unknown,
    templateConfig?: unknown,
    options?: GeneratePdfFromTemplateOptions | null,
    pdfOverrides?: import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null
  ): Promise<PdfHandlerResult> {
    const { insertPdf } = await import("../src/infra/db");
    const p = offerData as import("@planlux/shared").GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      return { ok: false, error: "Nieprawidłowe dane do generowania PDF (wymagane: offer, pricing, offerNumber)." };
    }
    logger.info("[pdf] start", { client: p.offer.clientName });
    const now = new Date();

    let result: { ok: true; filePath: string; fileName: string } | { ok: false; error: string; details?: string };
    const templateResult = await generatePdfFromTemplate(
      {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      },
      logger,
      (templateConfig as Partial<import("@planlux/shared").PdfTemplateConfig> | null | undefined) ?? undefined,
      options ?? undefined,
      (pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined) ?? undefined
    );

    if (templateResult.ok) {
      result = templateResult;
    } else {
      logger.error("[pdf] Planlux template failed – brak fallbacku, używamy tylko naszego layoutu", templateResult.error);
      result = { ok: false, error: templateResult.error ?? "Błąd generowania PDF z szablonu Planlux" };
    }

    if (!result.ok) {
      return { ok: false, error: result.error, details: result.details };
    }

    const pdfId = uuid();
    const offerId = uuid();
    const userId = p.userId ?? "";
    const nowIso = now.toISOString();

    // Parse clientName → clientFirstName, clientLastName, companyName
    const clientName = p.offer.clientName?.trim() || "Klient";
    const isCompany = /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
    let clientFirstName = "";
    let clientLastName = "";
    let companyName = "";
    if (isCompany) {
      companyName = clientName;
    } else {
      const parts = clientName.split(/\s+/).filter(Boolean);
      clientFirstName = parts[0] ?? "";
      clientLastName = parts.slice(1).join(" ") ?? "";
    }

    const basePrice = p.pricing.base?.totalBase ?? 0;
    const additionsTotal = (p.pricing.additions ?? []).reduce((s: number, a: { total?: number }) => s + (a.total ?? 0), 0);
    const addonsSnapshot = JSON.stringify(p.pricing.additions ?? []);
    const standardSnapshot = JSON.stringify(p.pricing.standardInPrice ?? []);

    // Zapisz ofertę do offers_crm (status GENERATED)
    try {
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length > 0) {
        db.prepare(
          `INSERT INTO offers_crm (id, offer_number, user_id, status, pdf_generated_at, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
           VALUES (?, ?, ?, 'GENERATED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, '', 1, ?, ?)`
        ).run(
          offerId,
          p.offerNumber,
          userId,
          nowIso,
          clientFirstName,
          clientLastName,
          companyName,
          p.offer.clientNip ?? "",
          p.offer.clientPhone ?? "",
          p.offer.clientEmail ?? "",
          p.offer.variantHali,
          p.offer.widthM,
          p.offer.lengthM,
          p.offer.heightM ?? null,
          p.offer.areaM2,
          basePrice,
          additionsTotal,
          p.pricing.totalPln,
          standardSnapshot,
          addonsSnapshot,
          nowIso,
          nowIso
        );
        db.prepare("INSERT INTO event_log (id, offer_id, user_id, event_type, details_json) VALUES (?, ?, ?, 'OFFER_CREATED', ?)").run(
          uuid(),
          offerId,
          userId,
          JSON.stringify({ pdfId, fileName: result.fileName })
        );
        const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
        if (auditTables.length > 0) {
          db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'PDF_GENERATED', ?)").run(
            uuid(),
            offerId,
            userId,
            JSON.stringify({ pdfId, fileName: result.fileName })
          );
        }
        logger.info("[crm] offer saved to offers_crm", { offerId, offerNumber: p.offerNumber });
      }
    } catch (e) {
      logger.warn("[crm] failed to save offer to offers_crm", e);
    }

    insertPdf(getDb(), {
      id: pdfId,
      offerId: null,
      userId,
      clientName: p.offer.clientName,
      fileName: result.fileName,
      filePath: result.filePath,
      status: "PDF_CREATED",
      totalPln: p.pricing.totalPln,
      widthM: p.offer.widthM,
      lengthM: p.offer.lengthM,
      heightM: p.offer.heightM,
      areaM2: p.offer.areaM2,
      variantHali: p.offer.variantHali,
    });
    logger.info("[pdf] db insert ok");

    const logPdfPayload = {
      id: pdfId,
      userId,
      userEmail: "",
      clientName: p.offer.clientName,
      variantHali: p.offer.variantHali,
      widthM: p.offer.widthM,
      lengthM: p.offer.lengthM,
      heightM: p.offer.heightM,
      areaM2: p.offer.areaM2,
      totalPln: p.pricing.totalPln,
      fileName: result.fileName,
      createdAt: now.toISOString(),
    };
    apiClient.logPdf(logPdfPayload).then(() => {
      getDb().prepare("UPDATE pdfs SET status = 'LOGGED', logged_at = datetime('now') WHERE id = ?").run(pdfId);
      logger.info("[pdf] Logged to Sheets", pdfId);
    }).catch(async (err) => {
      logger.warn("[pdf] logPdf failed -> enqueue LOG_PDF", err);
      try {
        const { generateOutboxId } = await import("@planlux/shared");
        const outboxId = generateOutboxId();
        getDb().prepare("INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'LOG_PDF', ?, 0, 5)").run(outboxId, JSON.stringify(logPdfPayload));
        logger.info("[pdf] LOG_PDF enqueued", { outboxId, pdfId });
      } catch (e) {
        logger.error("[pdf] Failed to enqueue LOG_PDF", e);
      }
    });

    logger.info("[pdf] done");
    return { ok: true, pdfId, filePath: result.filePath, fileName: result.fileName };
  }

  async function insertPdfFailed(offerData: unknown, errorMessage: string): Promise<void> {
    const { insertPdf } = await import("../src/infra/db");
    const p = offerData as { userId?: string; offer: { clientName: string; widthM: number; lengthM: number; heightM: number; areaM2: number; variantHali: string }; pricing?: { totalPln: number } };
    const pdfId = uuid();
    try {
      insertPdf(getDb(), {
        id: pdfId,
        offerId: null,
        userId: p.userId ?? "",
        clientName: p?.offer?.clientName ?? "",
        fileName: "(failed)",
        filePath: "(failed)",
        status: "PDF_FAILED",
        errorMessage,
        totalPln: p.pricing?.totalPln,
        widthM: p.offer.widthM,
        lengthM: p.offer.lengthM,
        heightM: p.offer.heightM,
        areaM2: p.offer.areaM2,
        variantHali: p.offer.variantHali,
      });
    } catch (_) {}
  }

  async function runPdfGenerateWithTimeout(
    offerData: unknown,
    templateConfig?: unknown,
    options?: GeneratePdfFromTemplateOptions | null,
    pdfOverrides?: unknown
  ): Promise<PdfHandlerResult> {
    const timeoutPromise = new Promise<PdfHandlerResult>((resolve) => {
      setTimeout(() => resolve({ ok: false, error: "Generowanie PDF trwało zbyt długo (timeout). Spróbuj ponownie." }), PDF_HANDLER_TIMEOUT_MS);
    });
    try {
      const outcome = await Promise.race([
        handlePdfGenerate(offerData, templateConfig, options, pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined),
        timeoutPromise,
      ]);
      if (outcome.ok === false) {
        await insertPdfFailed(offerData, outcome.error);
        const meta = (offerData as { offer?: { clientName?: string; widthM?: number; lengthM?: number }; offerNumber?: string }) || {};
        logger.error("[pdf] DIAGNOSTYKA: PDF generation failed", {
          error: outcome.error,
          details: outcome.details,
          clientName: meta.offer?.clientName,
          widthM: meta.offer?.widthM,
          lengthM: meta.offer?.lengthM,
          offerNumber: meta.offerNumber,
        });
        return { ok: false, error: outcome.error, details: outcome.details };
      }
      return outcome;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await insertPdfFailed(offerData, errMsg);
      const meta = (offerData as { offer?: { clientName?: string }; offerNumber?: string }) || {};
      logger.error("[pdf] DIAGNOSTYKA: PDF generation exception", {
        error: errMsg,
        stack: e instanceof Error ? e.stack : undefined,
        clientName: meta.offer?.clientName,
        offerNumber: meta.offerNumber,
      });
      return { ok: false, error: errMsg, details: e instanceof Error ? e.stack : undefined };
    }
  }

  ipcMain.handle("pdf:generate", async (_, offerData: unknown, templateConfig?: unknown, options?: unknown, pdfOverrides?: unknown) => {
    return runPdfGenerateWithTimeout(offerData, templateConfig, options as GeneratePdfFromTemplateOptions | null | undefined, pdfOverrides);
  });

  /** Generuje PDF preview i zwraca base64 (stabilne w rendererze). Input: payload + pdfOverrides. */
  ipcMain.handle("planlux:generatePdfPreview", async (_, payload: unknown, pdfOverrides?: unknown) => {
    const p = payload as GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      logger.warn("[pdf] generatePdfPreview: brak wymaganych danych", { hasOffer: !!p?.offer, hasPricing: !!p?.pricing, hasOfferNumber: !!p?.offerNumber });
      return { ok: false, error: "Nieprawidłowe dane (wymagane: offer, pricing, offerNumber)." };
    }
    try {
      const { getPdfTemplateDir } = await import("./pdf/pdfPaths");
      const templateDir = getPdfTemplateDir();
      if (!templateDir) {
        logger.error("[pdf] generatePdfPreview: brak katalogu szablonu PDF");
        return { ok: false, error: "Nie znaleziono szablonu PDF (Planlux-PDF)." };
      }
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] generatePdfPreview templateDir", templateDir);
      }
      const offerData = {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      };
      const result = await generatePdfFromTemplate(
        offerData,
        logger,
        undefined,
        { previewMode: true },
        (pdfOverrides as import("./pdf/generatePdfFromTemplate").PdfOverridesForGenerator | null | undefined) ?? undefined
      );
      if (!result.ok) return { ok: false, error: result.error, details: result.details };
      const buf = fs.readFileSync(result.filePath);
      const fileSize = buf.length;
      const base64Pdf = buf.toString("base64");
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] generatePdfPreview success", { filePath: result.filePath, fileSize, base64Length: base64Pdf.length });
      }
      return { ok: true, base64Pdf, fileName: result.fileName };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] planlux:generatePdfPreview failed", e);
      return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined };
    }
  });

  /** Generuje tymczasowy PDF preview (userData/preview). Ten sam pipeline co finalny PDF. Zwraca filePath + fileUrl do osadzenia w iframe. */
  ipcMain.handle("pdf:preview", async (_, payload: unknown, templateConfig?: unknown) => {
    const p = payload as GeneratePdfPayload;
    if (!p?.offer || !p?.pricing || !p?.offerNumber) {
      return { ok: false, error: "Nieprawidłowe dane (wymagane: offer, pricing, offerNumber)." };
    }
    try {
      const offerData = {
        userId: p.userId,
        offer: p.offer,
        pricing: p.pricing,
        offerNumber: p.offerNumber,
        sellerName: p.sellerName,
        sellerEmail: p.sellerEmail,
        sellerPhone: p.sellerPhone,
        clientAddressOrInstall: p.clientAddressOrInstall,
      };
      const result = await generatePdfFromTemplate(
        offerData,
        logger,
        (templateConfig as Partial<import("@planlux/shared").PdfTemplateConfig> | null | undefined) ?? undefined,
        { previewMode: true }
      );
      if (!result.ok) return { ok: false, error: result.error, details: result.details };
      const fileUrl = `planlux-pdf://preview/${result.fileName}`;
      if (process.env.NODE_ENV !== "production") {
        logger.info("[pdf] preview generated", { filePath: result.filePath, fileName: result.fileName });
      }
      return { ok: true, filePath: result.filePath, fileUrl };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] preview failed", e);
      return { ok: false, error: msg, details: e instanceof Error ? e.stack : undefined };
    }
  });

  /** Alias dla kompatybilności wstecznej – ta sama logika co pdf:generate. */
  ipcMain.handle("planlux:generatePdf", async (_, payload: unknown, templateConfig?: unknown, options?: unknown) => {
    return runPdfGenerateWithTimeout(payload, templateConfig, options as GeneratePdfFromTemplateOptions | null | undefined);
  });

  const pdfTemplateConfigStore = createFilePdfTemplateConfigStore(app.getPath("userData"));

  ipcMain.handle("planlux:loadPdfTemplateConfig", async (_, offerIdOrDraftId: string) => {
    try {
      const config = await pdfTemplateConfigStore.load(offerIdOrDraftId);
      return { ok: true, config };
    } catch (e) {
      logger.error("[pdf] loadPdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:savePdfTemplateConfig", async (_, offerIdOrDraftId: string, config: unknown) => {
    try {
      await pdfTemplateConfigStore.save(offerIdOrDraftId, config as import("@planlux/shared").PdfTemplateConfig);
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] savePdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:resetPdfTemplateConfig", async (_, offerIdOrDraftId: string) => {
    try {
      await pdfTemplateConfigStore.reset(offerIdOrDraftId);
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] resetPdfTemplateConfig failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Ping backendu przed reserveOfferNumber. Jedyny sposób określenia online. */
  async function checkOnline(): Promise<boolean> {
    try {
      const { config } = await import("../src/config");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(config.backend.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "health" }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return res.ok || res.status < 500;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    } catch {
      return false;
    }
  }

  /** Tworzy ofertę: numer zawsze lokalnie z offer_counters (offline-first). TEMP tylko przy wyjątku. */
  ipcMain.handle("planlux:createOffer", async (_, minimalData?: { clientName?: string; widthM?: number; lengthM?: number }) => {
    try {
      const user = requireAuth();
      const numRes = await (async () => {
        const db = getDb();
        const row = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(user.id) as { display_name: string | null; email?: string } | undefined;
        const initial = getSalesInitial(row ? { displayName: row.display_name ?? undefined, email: row.email } : null);
        const year = new Date().getFullYear();
        try {
          const hasTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_counters'").get() as { name?: string } | undefined)?.name === "offer_counters";
          if (hasTable) {
            const plxNumber = getNextOfferNumberLocal(db, "PLX", year, initial);
            logger.info("[offer] createOffer local PLX", { offerNumber: plxNumber });
            return { ok: true, offerNumber: plxNumber, isTemp: false };
          }
          logger.warn("[offer] offer_counters table missing, using TEMP fallback");
        } catch (e) {
          logger.warn("[offer] offer_counters failed, using TEMP fallback", e);
        }
        const { getDeviceId } = await import("./deviceId");
        const deviceId = getDeviceId();
        return { ok: true, offerNumber: `TEMP-${deviceId}-${Date.now()}`, isTemp: true };
      })();
      if (!numRes?.ok || !numRes.offerNumber) return { ok: false, error: "Nie udało się zarezerwować numeru oferty" };

      const offerId = uuid();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, offerId, offerNumber: numRes.offerNumber, isTemp: numRes.isTemp ?? false };

      const clientName = (minimalData?.clientName ?? "").trim();
      const w = minimalData?.widthM ?? 0;
      const l = minimalData?.lengthM ?? 0;
      const areaM2 = w * l || 0;
      const isCompany = /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
      let clientFirstName = "";
      let clientLastName = "";
      let companyName = "";
      if (isCompany) companyName = clientName;
      else {
        const parts = clientName.split(/\s+/).filter(Boolean);
        clientFirstName = parts[0] ?? "";
        clientLastName = parts.slice(1).join(" ") ?? "";
      }
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
         VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, '', '', '', 'T18_T35_DACH', ?, ?, NULL, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
      ).run(offerId, numRes.offerNumber, user.id, clientFirstName, clientLastName, companyName, w, l, areaM2, nowIso, nowIso);

      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'CREATE_OFFER', ?)").run(
          uuid(), offerId, user.id, JSON.stringify({ offerNumber: numRes.offerNumber, clientName, widthM: w, lengthM: l })
        );
      }
      logger.info("[crm] createOffer ok", { offerId, offerNumber: numRes.offerNumber });
      return { ok: true, offerId, offerNumber: numRes.offerNumber, isTemp: numRes.isTemp ?? false };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[crm] createOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Auto-numer oferty: zawsze lokalnie z offer_counters (offline-first). TEMP tylko przy wyjątku. */
  ipcMain.handle("planlux:getNextOfferNumber", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const row = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(user.id) as
        | { display_name: string | null; email?: string }
        | undefined;
      const initial = getSalesInitial(row ? { displayName: row.display_name ?? undefined, email: row.email } : null);
      const year = new Date().getFullYear();
      try {
        const hasTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_counters'").get() as { name?: string } | undefined)?.name === "offer_counters";
        if (hasTable) {
          const plxNumber = getNextOfferNumberLocal(db, "PLX", year, initial);
          logger.info("[offer] getNextOfferNumber local PLX", { offerNumber: plxNumber });
          return { ok: true, offerNumber: plxNumber };
        }
        logger.warn("[offer] offer_counters table missing, using TEMP fallback");
      } catch (e) {
        logger.warn("[offer] offer_counters failed, using TEMP fallback", e);
      }
      const { getDeviceId } = await import("./deviceId");
      const deviceId = getDeviceId();
      const tempNumber = `TEMP-${deviceId}-${Date.now()}`;
      return { ok: true, offerNumber: tempNumber, isTemp: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[offer] getNextOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const OFFER_DRAFT_PATH = path.join(app.getPath("userData"), "offer-draft.json");
  ipcMain.handle("planlux:loadOfferDraft", async () => {
    try {
      requireAuth();
      if (!fs.existsSync(OFFER_DRAFT_PATH)) return { ok: true, draft: null };
      const raw = fs.readFileSync(OFFER_DRAFT_PATH, "utf-8");
      const draft = JSON.parse(raw);
      return { ok: true, draft };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, draft: null };
      }
      logger.error("[draft] loadOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), draft: null };
    }
  });
  ipcMain.handle("planlux:saveOfferDraft", async (_, draft: unknown) => {
    try {
      const user = requireAuth();
      fs.mkdirSync(path.dirname(OFFER_DRAFT_PATH), { recursive: true });
      fs.writeFileSync(OFFER_DRAFT_PATH, JSON.stringify(draft, null, 0), "utf-8");

      const d = draft as {
        draftId?: string;
        offerNumber?: string;
        clientName?: string;
        clientNip?: string;
        clientEmail?: string;
        clientPhone?: string;
        variantHali?: string;
        widthM?: string;
        lengthM?: string;
        heightM?: string;
      };
      const clientName = (d?.clientName ?? "").trim();
      const w = parseFloat(String(d?.widthM ?? 0)) || 0;
      const l = parseFloat(String(d?.lengthM ?? 0)) || 0;
      const hasData = clientName.length > 0 && w > 0 && l > 0;

      if (hasData && user.id) {
        try {
          const db = getDb();
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
          if (tables.length > 0) {
            const offerId = d.draftId ?? uuid();
            const existing = db.prepare("SELECT id, offer_number FROM offers_crm WHERE id = ?").get(offerId) as { id: string; offer_number: string } | undefined;
            const draftNumber = (d?.offerNumber?.trim() && d.offerNumber !== "—") ? d.offerNumber : null;
            const existingNumber = existing?.offer_number && !existing.offer_number.startsWith("TEMP-") ? existing.offer_number : null;
            const offerNumber = draftNumber ?? existingNumber;
            if (!offerNumber) {
              return { ok: true };
            }
            const areaM2 = w * l;
            const h = d.heightM ? parseFloat(String(d.heightM)) : null;
            const isCompany = /sp\.|s\.a\.|z o\.o\.|s\.c\.|s\.r\.o\./i.test(clientName);
            let clientFirstName = "";
            let clientLastName = "";
            let companyName = "";
            if (isCompany) {
              companyName = clientName;
            } else {
              const parts = clientName.split(/\s+/).filter(Boolean);
              clientFirstName = parts[0] ?? "";
              clientLastName = parts.slice(1).join(" ") ?? "";
            }
            const nowIso = new Date().toISOString();
            if (existing) {
              db.prepare(
                `UPDATE offers_crm SET
                  client_first_name=?, client_last_name=?, company_name=?, nip=?, phone=?, email=?, variant_hali=?,
                  width_m=?, length_m=?, height_m=?, area_m2=?, updated_at=?
                  WHERE id=?`
              ).run(clientFirstName, clientLastName, companyName, d.clientNip ?? "", d.clientPhone ?? "", d.clientEmail ?? "", d.variantHali ?? "T18_T35_DACH", w, l, h, areaM2, nowIso, offerId);
            } else {
              db.prepare(
                `INSERT INTO offers_crm (id, offer_number, user_id, status, client_first_name, client_last_name, company_name, nip, phone, email, variant_hali, width_m, length_m, height_m, area_m2, hall_summary, base_price_pln, additions_total_pln, total_pln, standard_snapshot, addons_snapshot, note_html, version, created_at, updated_at)
                 VALUES (?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, 0, 0, '[]', '[]', '', 1, ?, ?)`
              ).run(
                offerId,
                offerNumber,
                user.id,
                clientFirstName,
                clientLastName,
                companyName,
                d.clientNip ?? "",
                d.clientPhone ?? "",
                d.clientEmail ?? "",
                d.variantHali ?? "T18_T35_DACH",
                w,
                l,
                h,
                areaM2,
                nowIso,
                nowIso
              );
            }
            const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
            if (auditTables.length > 0) {
              const auditType = existing ? "UPDATE_DRAFT" : "CREATE_DRAFT";
              db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, ?, ?)").run(
                uuid(),
                offerId,
                user.id,
                auditType,
                JSON.stringify({ clientName, widthM: w, lengthM: l })
              );
            }
            return { ok: true };
          }
        } catch (e) {
          logger.warn("[crm] saveOfferDraft to offers_crm skipped", e);
        }
      }

      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[draft] saveOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:clearOfferDraft", async () => {
    try {
      requireAuth();
      if (fs.existsSync(OFFER_DRAFT_PATH)) fs.unlinkSync(OFFER_DRAFT_PATH);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[draft] clearOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Dashboard: statystyki ofert (per użytkownik lub globalne dla managera). */
  ipcMain.handle("planlux:getDashboardStats", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) {
        return {
          ok: true,
          byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
          totalPln: 0,
          perUser: [],
        };
      }
      const seeAll = user.role === "ADMIN" || user.role === "BOSS";
      const filterUser = seeAll ? null : user.id;
      const where = filterUser ? "WHERE user_id = ?" : "";
      const args = filterUser ? [filterUser] : [];

      const rows = db.prepare(
        `SELECT status, total_pln, user_id FROM offers_crm ${where}`
      ).all(...args) as Array<{ status: string; total_pln: number; user_id: string }>;

      const byStatus: Record<string, number> = { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 };
      let totalPln = 0;
      const userMap = new Map<string, { count: number; totalPln: number }>();

      for (const r of rows) {
        const s = (r.status ?? "IN_PROGRESS").toUpperCase();
        if (s in byStatus) byStatus[s]++;
        totalPln += Number(r.total_pln ?? 0) || 0;
        if (seeAll && r.user_id) {
          const u = userMap.get(r.user_id) ?? { count: 0, totalPln: 0 };
          u.count++;
          u.totalPln += Number(r.total_pln ?? 0) || 0;
          userMap.set(r.user_id, u);
        }
      }

      let perUser: Array<{ userId: string; displayName: string; email: string; count: number; totalPln: number }> = [];
      if (seeAll && userMap.size > 0) {
        const users = db.prepare("SELECT id, email, display_name FROM users WHERE active = 1").all() as Array<{ id: string; email: string; display_name: string }>;
        const userById = new Map(users.map((u) => [u.id, u]));
        perUser = Array.from(userMap.entries())
          .map(([uid, data]) => ({
            userId: uid,
            displayName: (() => {
              const u = userById.get(uid);
              const dn = (u?.display_name ?? "").trim();
              return dn || u?.email || uid;
            })(),
            email: userById.get(uid)?.email ?? "",
            count: data.count,
            totalPln: data.totalPln,
          }))
          .sort((a, b) => b.count - a.count);
      }

      return { ok: true, byStatus, totalPln, perUser };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 }, totalPln: 0, perUser: [], error: e.message };
      }
      logger.error("[dashboard] getDashboardStats failed", e);
      return {
        ok: false,
        byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
        totalPln: 0,
        perUser: [],
      };
    }
  });

  /** CRM: lista ofert z offers_crm. SALESPERSON → filtr user_id; BOSS/ADMIN → wszystkie. */
  ipcMain.handle("planlux:getOffersCrm", async (_, params?: { statusFilter?: string; searchQuery?: string }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, offers: [] };
      const statusFilter = params?.statusFilter ?? "all";
      const searchQuery = params?.searchQuery ?? "";
      let sql = "SELECT id, offer_number, status, user_id, client_first_name, client_last_name, company_name, nip, phone, variant_hali, width_m, length_m, area_m2, total_pln, created_at, pdf_generated_at, emailed_at, realized_at FROM offers_crm";
      const args: unknown[] = [];
      const seeAll = user.role === "ADMIN" || user.role === "BOSS";
      if (!seeAll) {
        sql += " WHERE user_id = ?";
        args.push(user.id);
      }
      if (statusFilter !== "all") {
        sql += (args.length > 0 ? " AND" : " WHERE") + " status = ?";
        args.push(statusFilter.toUpperCase());
      }
      if (searchQuery?.trim()) {
        const q = `%${searchQuery.trim()}%`;
        sql += (args.length > 0 ? " AND" : " WHERE") + " (offer_number LIKE ? OR client_first_name LIKE ? OR client_last_name LIKE ? OR company_name LIKE ? OR nip LIKE ? OR phone LIKE ?)";
        args.push(q, q, q, q, q, q);
      }
      sql += " ORDER BY created_at DESC LIMIT 200";
      const rows = db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
      const offers = rows.map((r) => ({
        id: r.id,
        offerNumber: r.offer_number,
        status: r.status,
        userId: r.user_id ?? "",
        clientFirstName: r.client_first_name ?? "",
        clientLastName: r.client_last_name ?? "",
        companyName: r.company_name ?? "",
        nip: r.nip ?? "",
        phone: r.phone ?? "",
        variantHali: r.variant_hali ?? "",
        widthM: r.width_m ?? 0,
        lengthM: r.length_m ?? 0,
        areaM2: r.area_m2 ?? 0,
        totalPln: r.total_pln ?? 0,
        createdAt: r.created_at ?? "",
        pdfGeneratedAt: r.pdf_generated_at ?? null,
        emailedAt: r.emailed_at ?? null,
        realizedAt: r.realized_at ?? null,
      }));
      return { ok: true, offers };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message, offers: [] };
      }
      logger.error("[crm] getOffersCrm failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), offers: [] };
    }
  });

  /** CRM: znajdź potencjalne duplikaty (imię/nazwisko, firma, NIP, telefon, e-mail). */
  ipcMain.handle("planlux:findDuplicateOffers", async (_, params: { clientName: string; nip?: string; phone?: string; email?: string }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, duplicates: [] };

      const norm = (s: string) => (s ?? "").trim().toLowerCase();
      const digits = (s: string) => (s ?? "").replace(/\D/g, "");
      const nameNorm = norm(params.clientName ?? "").replace(/\s+/g, " ");
      const nipNorm = digits(params.nip ?? "");
      const phoneNorm = digits(params.phone ?? "");
      const emailNorm = norm(params.email ?? "");

      const rows = db.prepare(
        `SELECT id, offer_number, status, client_first_name, client_last_name, company_name, nip, phone, email, width_m, length_m, area_m2, total_pln, created_at
         FROM offers_crm WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`
      ).all(user.id) as Array<Record<string, unknown>>;

      const duplicates: Array<{
        id: string;
        offerNumber: string;
        status: string;
        clientDisplay: string;
        nip: string;
        phone: string;
        email: string;
        widthM: number;
        lengthM: number;
        areaM2: number;
        totalPln: number;
        createdAt: string;
      }> = [];

      for (const r of rows) {
        const dbNip = digits(String(r.nip ?? ""));
        const dbPhone = digits(String(r.phone ?? ""));
        const dbEmail = norm(String(r.email ?? ""));
        const dbCompany = norm(String(r.company_name ?? ""));
        const dbFullName = norm([r.client_first_name, r.client_last_name].filter(Boolean).join(" "));
        const dbDisplay = (r.company_name && String(r.company_name).trim())
          ? String(r.company_name).trim()
          : [r.client_first_name, r.client_last_name].filter(Boolean).join(" ").trim() || "—";

        let match = false;
        if (nipNorm.length >= 4 && dbNip.length >= 4 && nipNorm === dbNip) match = true;
        if (phoneNorm.length >= 6 && dbPhone.length >= 6 && phoneNorm === dbPhone) match = true;
        if (emailNorm.length >= 3 && dbEmail.length >= 3 && emailNorm === dbEmail) match = true;
        if (nameNorm.length >= 3) {
          if (dbCompany && dbCompany.includes(nameNorm)) match = true;
          if (dbFullName && dbFullName.includes(nameNorm)) match = true;
          if (nameNorm.includes(dbCompany) || nameNorm.includes(dbFullName)) match = true;
        }
        if (match) {
          duplicates.push({
            id: r.id as string,
            offerNumber: r.offer_number as string,
            status: r.status as string,
            clientDisplay: dbDisplay,
            nip: String(r.nip ?? ""),
            phone: String(r.phone ?? ""),
            email: String(r.email ?? ""),
            widthM: Number(r.width_m ?? 0),
            lengthM: Number(r.length_m ?? 0),
            areaM2: Number(r.area_m2 ?? 0),
            totalPln: Number(r.total_pln ?? 0),
            createdAt: r.created_at as string,
          });
        }
      }

      return { ok: true, duplicates };
    } catch (e) {
      logger.error("[crm] findDuplicateOffers failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), duplicates: [] };
    }
  });

  /** CRM: oznacz ofertę jako zrealizowaną. */
  ipcMain.handle("planlux:markOfferRealized", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      const offerRow = db.prepare("SELECT user_id FROM offers_crm WHERE id = ?").get(offerId) as { user_id: string } | undefined;
      if (!offerRow) return { ok: false, error: "Oferta nie znaleziona" };
      if (offerRow.user_id !== user.id && user.role !== "ADMIN" && user.role !== "BOSS") return { ok: false, error: "Forbidden" };
      const now = new Date().toISOString();
      db.prepare("UPDATE offers_crm SET status = 'REALIZED', realized_at = ?, updated_at = ? WHERE id = ?").run(now, now, offerId);
      const uid = user.id;
      const id = uuid();
      db.prepare("INSERT INTO event_log (id, offer_id, user_id, event_type, details_json) VALUES (?, ?, ?, 'OFFER_REALIZED', ?)").run(
        id,
        offerId,
        uid,
        JSON.stringify({ realizedAt: now })
      );
      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'STATUS_CHANGED', ?)").run(
          uuid(),
          offerId,
          uid,
          JSON.stringify({ fromStatus: "SENT", toStatus: "REALIZED", realizedAt: now })
        );
      }
      return { ok: true };
    } catch (e) {
      logger.error("[crm] markOfferRealized failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const ROLES_SEE_ALL = ["ADMIN", "BOSS"];

  function canAccessOffer(db: ReturnType<typeof getDb>, offerId: string, userId: string): boolean {
    const offer = db.prepare("SELECT user_id FROM offers_crm WHERE id = ?").get(offerId) as { user_id: string } | undefined;
    if (!offer) return false;
    if (offer.user_id === userId) return true;
    const user = db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(userId) as { role: string } | undefined;
    return !!user && ROLES_SEE_ALL.includes(user.role);
  }

  /** CRM: szczegóły oferty (pełne dane). Owner lub BOSS/ADMIN ma dostęp. */
  ipcMain.handle("planlux:getOfferDetails", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", offer: null };
      const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(offerId) as Record<string, unknown> | undefined;
      if (!row) return { ok: false, error: "Oferta nie znaleziona", offer: null };
      const offer = {
        id: row.id,
        offerNumber: row.offer_number,
        userId: row.user_id,
        status: row.status,
        createdAt: row.created_at,
        pdfGeneratedAt: row.pdf_generated_at ?? null,
        emailedAt: row.emailed_at ?? null,
        realizedAt: row.realized_at ?? null,
        clientFirstName: row.client_first_name ?? "",
        clientLastName: row.client_last_name ?? "",
        companyName: row.company_name ?? "",
        nip: row.nip ?? "",
        phone: row.phone ?? "",
        email: row.email ?? "",
        variantHali: row.variant_hali ?? "",
        widthM: row.width_m ?? 0,
        lengthM: row.length_m ?? 0,
        heightM: row.height_m ?? null,
        areaM2: row.area_m2 ?? 0,
        hallSummary: row.hall_summary ?? "",
        basePricePln: row.base_price_pln ?? 0,
        additionsTotalPln: row.additions_total_pln ?? 0,
        totalPln: row.total_pln ?? 0,
        standardSnapshot: row.standard_snapshot ?? "[]",
        addonsSnapshot: row.addons_snapshot ?? "[]",
        noteHtml: row.note_html ?? "",
        version: row.version ?? 1,
        updatedAt: row.updated_at ?? "",
      };
      return { ok: true, offer };
    } catch (e) {
      logger.error("[crm] getOfferDetails failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), offer: null };
    }
  });

  /** CRM: audit trail oferty (offer_audit + event_log). Owner lub manager/admin ma dostęp. */
  ipcMain.handle("planlux:getOfferAudit", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", items: [] };
      const auditRows = db.prepare(
        "SELECT id, offer_id, user_id, type, payload_json, created_at FROM offer_audit WHERE offer_id = ? ORDER BY created_at ASC"
      ).all(offerId) as Array<{ id: string; type: string; payload_json: string; created_at: string }>;
      const eventRows = db.prepare(
        "SELECT id, event_type as type, details_json as payload_json, created_at FROM event_log WHERE offer_id = ? ORDER BY created_at ASC"
      ).all(offerId) as Array<{ id: string; type: string; payload_json: string; created_at: string }>;
      const items = [
        ...auditRows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload_json || "{}"), createdAt: r.created_at })),
        ...eventRows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload_json || "{}"), createdAt: r.created_at })),
      ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return { ok: true, items };
    } catch (e) {
      logger.error("[crm] getOfferAudit failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });

  /** CRM: historia e-maili dla oferty. Owner lub BOSS/ADMIN ma dostęp. */
  ipcMain.handle("planlux:getEmailHistoryForOffer", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", emails: [] };
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_history'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, emails: [] };
      const rows = db.prepare(
        "SELECT id, from_email, to_email, subject, body, attachments_json, sent_at, status, error_message, created_at FROM email_history WHERE offer_id = ? ORDER BY created_at DESC"
      ).all(offerId) as Array<Record<string, unknown>>;
      const emails = rows.map((r) => ({
        id: r.id,
        fromEmail: r.from_email ?? "",
        toEmail: r.to_email ?? "",
        subject: r.subject ?? "",
        body: r.body ?? "",
        attachments: JSON.parse((r.attachments_json as string) || "[]"),
        sentAt: r.sent_at ?? null,
        status: r.status ?? "",
        errorMessage: r.error_message ?? null,
        createdAt: r.created_at ?? "",
      }));
      return { ok: true, emails };
    } catch (e) {
      logger.error("[crm] getEmailHistoryForOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), emails: [] };
    }
  });

  /** CRM: pliki PDF powiązane z ofertą (z event_log). Owner lub BOSS/ADMIN ma dostęp. */
  ipcMain.handle("planlux:getPdfsForOffer", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", pdfs: [] };
      const eventRows = db.prepare(
        "SELECT details_json FROM event_log WHERE offer_id = ? AND event_type = 'OFFER_CREATED'"
      ).all(offerId) as Array<{ details_json: string }>;
      const pdfIds = eventRows.map((r) => {
        try {
          const d = JSON.parse(r.details_json || "{}");
          return d.pdfId;
        } catch {
          return null;
        }
      }).filter(Boolean) as string[];
      if (pdfIds.length === 0) return { ok: true, pdfs: [] };
      const placeholders = pdfIds.map(() => "?").join(",");
      const pdfRows = db.prepare(
        `SELECT id, file_name, file_path, status, created_at FROM pdfs WHERE id IN (${placeholders})`
      ).all(...pdfIds) as Array<{ id: string; file_name: string; file_path: string; status: string; created_at: string }>;
      const pdfs = pdfRows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        filePath: r.file_path,
        status: r.status,
        createdAt: r.created_at,
      }));
      return { ok: true, pdfs };
    } catch (e) {
      logger.error("[crm] getPdfsForOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), pdfs: [] };
    }
  });

  /** Wewnętrzna logika sync – używana przez handler i saveOfferDraft. */
  async function doSyncTempOfferNumbers(): Promise<{
    ok: boolean;
    syncedCount: number;
    updated: Array<{ offerId: string; oldNumber: string; newNumber: string }>;
    failed: Array<{ offerId: string; error: string }>;
    error?: string;
  }> {
    const log = (msg: string, data?: unknown) => {
      console.log(`[sync] ${msg}`, data ?? "");
      logger.info(`[sync] ${msg}`, data);
    };
    const errLog = (msg: string, e?: unknown) => {
      console.error(`[sync] ${msg}`, e ?? "");
      logger.error(`[sync] ${msg}`, e);
    };
    const updated: Array<{ offerId: string; oldNumber: string; newNumber: string }> = [];
    const failed: Array<{ offerId: string; error: string }> = [];
    try {
      log("START syncTempOfferNumbers (lokalnie, bez backendu)");
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) {
        log("brak tabeli offers_crm, pomijam");
        return { ok: true, syncedCount: 0, updated, failed };
      }
      const tempRows = db.prepare(
        "SELECT id, offer_number, user_id FROM offers_crm WHERE offer_number LIKE 'TEMP-%'"
      ).all() as Array<{ id: string; offer_number: string; user_id: string }>;
      log("found TEMP offers count", tempRows.length);
      const hasCountersTable = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_counters'").get() as { name?: string } | undefined)?.name === "offer_counters";
      if (!hasCountersTable) {
        log("brak tabeli offer_counters, pomijam sync");
        return { ok: true, syncedCount: 0, updated, failed };
      }
      for (const row of tempRows) {
        log("processing offerId", { offerId: row.id, tempNumber: row.offer_number });
        try {
          const userRow = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(row.user_id) as { display_name: string | null; email?: string } | undefined;
          const initial = getSalesInitial(userRow ? { displayName: userRow.display_name ?? undefined, email: userRow.email } : null);
          const year = new Date().getFullYear();
          let newNumber: string;
          try {
            newNumber = getNextOfferNumberLocal(db, "PLX", year, initial);
            log("wygenerowano lokalnie", { offerId: row.id, newNumber });
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            errLog("offer_counters failed – przechodzę do następnej", { offerId: row.id, error: e });
            failed.push({ offerId: row.id, error: errMsg });
            continue;
          }
          try {
            db.transaction(() => {
              const stmt = db.prepare("UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?");
              const info = stmt.run(newNumber, row.id);
              log("SQLite update ok", { rowsAffected: info.changes });
              if (info.changes === 0) {
                errLog("UPDATE offers_crm nie zaktualizował żadnego wiersza", { offerId: row.id });
              }
              const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
              if (auditTables.length > 0) {
                db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'OFFER_NUMBER_ASSIGNED', ?)").run(
                  uuid(), row.id, row.user_id, JSON.stringify({ oldNumber: row.offer_number, newNumber })
                );
                const updAudit = db.prepare(
                  "UPDATE offer_audit SET payload_json = REPLACE(payload_json, ?, ?) WHERE offer_id = ? AND payload_json LIKE '%' || ? || '%'"
                );
                updAudit.run(row.offer_number, newNumber, row.id, row.offer_number);
                log("audit insert ok");
              }
            })();
            updated.push({ offerId: row.id, oldNumber: row.offer_number, newNumber });
            log("TEMP→PLX zakończony sukcesem", { offerId: row.id, newNumber });
          } catch (txErr) {
            const errMsg = txErr instanceof Error ? txErr.message : String(txErr);
            errLog("transakcja SQLite nie powiodła się", { offerId: row.id, error: txErr });
            failed.push({ offerId: row.id, error: errMsg });
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          errLog("błąd w pętli oferty – przechodzę dalej", { offerId: row.id, error: e });
          failed.push({ offerId: row.id, error: errMsg });
        }
      }
      log("syncTempOfferNumbers zakończony", { syncedCount: updated.length, updated, failed });
      return { ok: true, syncedCount: updated.length, updated, failed };
    } catch (e) {
      errLog("syncTempOfferNumbers failed", e);
      return { ok: false, syncedCount: 0, updated, failed, error: e instanceof Error ? e.message : String(e) };
    }
  }

  ipcMain.handle("planlux:syncTempOfferNumbers", () => doSyncTempOfferNumbers());

  /** CRM: zamień numer oferty (np. TEMP→final po sync). Owner lub BOSS/ADMIN. */
  ipcMain.handle("planlux:replaceOfferNumber", async (_, offerId: string, newOfferNumber: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona" };
      db.prepare("UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?").run(newOfferNumber, offerId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[crm] replaceOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

/** CRM: wyślij e-mail oferty (online: SMTP + SENT; offline: QUEUED + outbox). */
  ipcMain.handle("planlux:sendOfferEmail", async (_, offerId: string, params: { to: string; subject: string; body: string; pdfPath?: string }) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona" };
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(user.id) as { email: string } | undefined;
      if (!userRow?.email) return { ok: false, error: "Użytkownik nie znaleziony" };

      const offerRow = db.prepare("SELECT id FROM offers_crm WHERE id = ?").get(offerId);
      if (!offerRow) return { ok: false, error: "Oferta nie znaleziona" };

      const emailId = uuid();
      const fromEmail = userRow.email;
      const attachments = params.pdfPath ? [params.pdfPath] : [];
      const nowIso = new Date().toISOString();

      db.prepare(
        `INSERT INTO email_history (id, offer_id, user_id, from_email, to_email, subject, body, attachments_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        emailId,
        offerId,
        user.id,
        fromEmail,
        params.to.trim(),
        params.subject.trim() || "Oferta PLANLUX",
        params.body.trim(),
        JSON.stringify(attachments),
        "QUEUED",
        nowIso
      );

      const onlineRes = await (async () => {
        try {
          const res = await fetch("https://www.google.com", { method: "HEAD", mode: "no-cors" });
          return res != null;
        } catch {
          return false;
        }
      })();

      if (onlineRes) {
        const { getSmtpConfig, sendMail } = await import("./smtpSend");
        const creds = getSmtpConfig(fromEmail);
        if (!creds) {
          db.prepare("UPDATE email_history SET status = 'FAILED', error_message = ? WHERE id = ?").run(
            "Skonfiguruj SMTP w ustawieniach (userData/smtp-config.json)",
            emailId
          );
          return { ok: false, error: "Skonfiguruj SMTP w ustawieniach" };
        }
        try {
          await sendMail(creds, {
            from: fromEmail,
            to: params.to.trim(),
            subject: params.subject.trim() || "Oferta PLANLUX",
            body: params.body.trim(),
            attachmentPath: params.pdfPath,
          });
          db.prepare("UPDATE email_history SET status = 'SENT', sent_at = ? WHERE id = ?").run(nowIso, emailId);
          db.prepare("UPDATE offers_crm SET status = 'SENT', emailed_at = ?, updated_at = ? WHERE id = ?").run(nowIso, nowIso, offerId);
          const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
          if (auditTables.length > 0) {
            db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_SENT', ?)").run(
              uuid(),
              offerId,
              user.id,
              JSON.stringify({ emailId, to: params.to })
            );
          }
          return { ok: true };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          db.prepare("UPDATE email_history SET status = 'FAILED', error_message = ? WHERE id = ?").run(msg, emailId);
          logger.error("[email] send failed", e);
          return { ok: false, error: msg };
        }
      }

      const { generateOutboxId } = await import("@planlux/shared");
      const outboxId = generateOutboxId();
      db.prepare(
        "INSERT INTO outbox (id, operation_type, payload_json, retry_count, max_retries) VALUES (?, 'SEND_EMAIL', ?, 0, 5)"
      ).run(outboxId, JSON.stringify({
        emailId,
        to: params.to.trim(),
        subject: params.subject.trim() || "Oferta PLANLUX",
        body: params.body.trim(),
        attachmentPath: params.pdfPath ?? undefined,
      }));

      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_QUEUED', ?)").run(
          uuid(),
          offerId,
          user.id,
          JSON.stringify({ emailId, to: params.to })
        );
      }
      return { ok: true, queued: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[email] sendOfferEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Ogólny kanał e-mail: sprawdzenie internetu (net.request); offline → { ok: false, offline: true }. */
  ipcMain.handle("planlux:sendEmail", async (_, payload: unknown) => {
    try {
      const user = requireAuth();
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "Invalid payload" };
      }
      const { to, subject, text, html } = payload as {
        to?: unknown;
        subject?: unknown;
        text?: unknown;
        html?: unknown;
      };
      if (typeof to !== "string" || typeof subject !== "string") {
        return { ok: false, error: "Invalid input" };
      }

      const hasInternet = await checkInternetNet();
      if (!hasInternet) {
        return { ok: false, offline: true };
      }

      const safeText = typeof text === "string" ? text : text != null ? String(text) : undefined;
      const safeHtml = typeof html === "string" ? html : html != null ? String(html) : undefined;

      const info = await sendSmtpEmail({
        to: (to as string).trim(),
        subject: (subject as string).trim(),
        text: safeText,
        html: safeHtml,
      });
      logger.info("[mail] sendEmail ok", { userId: user.id, to });
      return { ok: true, info };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("[mail] sendEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** CRM: załaduj ofertę do edycji (format dla draft store). Owner lub BOSS/ADMIN. */
  ipcMain.handle("planlux:loadOfferForEdit", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", draft: null };
      const row = db.prepare("SELECT * FROM offers_crm WHERE id = ?").get(offerId) as Record<string, unknown> | undefined;
      if (!row) return { ok: false, error: "Oferta nie znaleziona", draft: null };
      const clientName = [row.client_first_name, row.client_last_name].filter(Boolean).join(" ") || (row.company_name as string) || "";
      const addons = (() => {
        try {
          const arr = JSON.parse((row.addons_snapshot as string) || "[]") as Array<{ nazwa?: string; name?: string; ilosc?: number; quantity?: number }>;
          return arr.map((a) => ({ nazwa: a.nazwa ?? a.name ?? "", ilosc: a.ilosc ?? a.quantity ?? 1 }));
        } catch {
          return [];
        }
      })();
      const draft = {
        draftId: row.id,
        variantHali: row.variant_hali ?? "T18_T35_DACH",
        widthM: String(row.width_m ?? ""),
        lengthM: String(row.length_m ?? ""),
        heightM: row.height_m != null ? String(row.height_m) : "",
        clientName: clientName || (row.company_name as string) || "",
        clientNip: row.nip ?? "",
        clientEmail: row.email ?? "",
        clientPhone: row.phone ?? "",
        addons,
        pdfOverrides: {},
        offerNumber: row.offer_number ?? "",
        offerNumberLocked: true,
        updatedAt: new Date().toISOString(),
        lastPreviewAt: null,
      };
      return { ok: true, draft };
    } catch (e) {
      logger.error("[crm] loadOfferForEdit failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), draft: null };
    }
  });

  const PDF_EDITOR_CONTENT_PATH = path.join(app.getPath("userData"), "pdf-editor-content.json");
  ipcMain.handle("planlux:loadPdfEditorContent", async () => {
    try {
      if (!fs.existsSync(PDF_EDITOR_CONTENT_PATH)) return { ok: true, content: null };
      const raw = fs.readFileSync(PDF_EDITOR_CONTENT_PATH, "utf-8");
      const content = JSON.parse(raw);
      return { ok: true, content };
    } catch (e) {
      logger.error("[pdf] loadPdfEditorContent failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:savePdfEditorContent", async (_, content: unknown) => {
    try {
      fs.mkdirSync(path.dirname(PDF_EDITOR_CONTENT_PATH), { recursive: true });
      fs.writeFileSync(PDF_EDITOR_CONTENT_PATH, JSON.stringify(content, null, 0), "utf-8");
      return { ok: true };
    } catch (e) {
      logger.error("[pdf] savePdfEditorContent failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Dev: ścieżka szablonu + następna nazwa pliku testowego (oferta-test-YYYYMMDD-HHmmss.pdf). */
  ipcMain.handle("planlux:getPdfDebugInfo", async () => {
    try {
      const templateDir = getPdfTemplateDir();
      return { ok: true, templateDir: templateDir ?? null, nextTestFileName: getTestPdfFileName() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:getPdfPreviewHtml", async (_, payload: unknown, templateConfig: unknown) => {
    try {
      const templateDir = getPdfTemplateDir();
      if (!templateDir) {
        return { ok: false, error: "Szablon PDF nie znaleziony" };
      }
      const offerDate = new Date().toLocaleDateString("pl-PL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      const offerPayload = mapOfferDataToPayload(payload as GeneratePdfPayload, offerDate);
      const html = getPreviewHtmlWithInlinedAssets(
        templateDir,
        offerPayload,
        (templateConfig as Record<string, unknown>) ?? undefined
      );
      return { ok: true, html };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("[pdf] getPdfPreviewHtml failed", e);
      return { ok: false, error: errMsg };
    }
  });

  ipcMain.handle("planlux:getPdfs", async () => {
    try {
      const user = requireRole(["ADMIN", "BOSS"]);
      const db = getDb();
      const rows = db.prepare(
        `SELECT p.id, p.user_id, p.offer_id, p.client_name, p.variant_hali, p.file_name, p.file_path, p.status, p.created_at,
          u.display_name as user_display_name
         FROM pdfs p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100`
      ).all();
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("getPdfs failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getEmails", async () => {
    try {
      const user = requireRole(["ADMIN", "BOSS"]);
      const db = getDb();
      const hasEmailHistory = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_history'").all() as Array<{ name: string }>).length > 0;
      if (hasEmailHistory) {
        const rows = db.prepare(
          `SELECT eh.id, eh.offer_id, eh.user_id, eh.from_email, eh.to_email, eh.subject, eh.sent_at, eh.status, eh.error_message, eh.created_at,
            u.display_name as user_display_name
           FROM email_history eh
           LEFT JOIN users u ON eh.user_id = u.id
           ORDER BY eh.created_at DESC LIMIT 100`
        ).all();
        return { ok: true, data: rows };
      }
      const rows = db.prepare("SELECT * FROM emails ORDER BY created_at DESC LIMIT 100").all();
      return { ok: true, data: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) {
        return { ok: false, error: e.message };
      }
      logger.error("getEmails failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getOutboxCount", async () => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT COUNT(*) as c FROM outbox WHERE processed_at IS NULL").get() as { c: number };
      return { ok: true, count: row.c };
    } catch (e) {
      return { ok: true, count: 0 };
    }
  });

  ipcMain.handle("shell:openPath", async (_, filePath: string) => {
    try {
      const err = await shell.openPath(filePath);
      return { ok: !err, error: err || undefined };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("shell:showItemInFolder", async (_, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  /** Online = ping do backendu (nie navigator.onLine). */
  ipcMain.handle("planlux:isOnline", async () => {
    try {
      const { config } = await import("../src/config");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let ok = false;
      let err: unknown = null;
      try {
        const res = await fetch(config.backend.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "health" }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        ok = res.ok || res.status < 500;
        if (!ok) err = new Error(`HTTP ${res.status}`);
      } catch (e) {
        clearTimeout(timeout);
        err = e;
      }
      console.log("[IPC] isOnline ping ok =", ok, "error =", err);
      return { ok: true, online: ok };
    } catch (e) {
      console.log("[IPC] isOnline outer error =", e);
      return { ok: true, online: false };
    }
  });

  /** Real Internet check via Electron net.request (no navigator.onLine). */
  ipcMain.handle("planlux:checkInternet", async () => {
    try {
      const online = await checkInternetNet();
      return { ok: true, online };
    } catch (e) {
      logger.warn("[checkInternet] error", e);
      return { ok: true, online: false };
    }
  });

  // ---------- SMTP accounts & email outbox (secure store, offline-first) ----------
  const {
    checkInternet: checkInternetEmail,
    enqueueEmail,
    sendNow,
    processOutbox,
    startOutboxWorker,
  } = await import("./emailService");
  const { setPassword: secureSetPassword, setSmtpPassword, getPassword: secureGetPassword, deletePassword: secureDeletePassword, deleteSmtpPassword, isKeytarAvailable } = await import("./secureStore");
  const { getAccountByUserId, buildTransportForUser, getEmailSettings, setEmailSetting, sendOfferEmailNow, renderTemplate } = await import("./emailService");

  startOutboxWorker(getDb as () => import("./emailService").Db, logger);

  ipcMain.handle("planlux:smtp:listAccounts", async () => {
    try {
      requireAuth();
      const rows = getDb().prepare("SELECT id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at FROM smtp_accounts ORDER BY is_default DESC, created_at ASC").all();
      return { ok: true, accounts: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[smtp] listAccounts failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:smtp:upsertAccount", async (_, payload: unknown) => {
    try {
      requireRole(["ADMIN"]);
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { id?: string; name?: string; from_name?: string; from_email?: string; host?: string; port?: number; secure?: boolean; auth_user?: string; password?: string; reply_to?: string; is_default?: boolean };
      const id = (p.id && typeof p.id === "string") ? p.id : uuid();
      const name = (p.name && typeof p.name === "string") ? p.name : "";
      const from_name = (p.from_name && typeof p.from_name === "string") ? p.from_name : "";
      const from_email = (p.from_email && typeof p.from_email === "string") ? p.from_email.trim() : "";
      const host = (p.host && typeof p.host === "string") ? p.host.trim() : "";
      const port = typeof p.port === "number" ? p.port : 587;
      const secure = p.secure === true ? 1 : 0;
      const auth_user = (p.auth_user && typeof p.auth_user === "string") ? p.auth_user.trim() : from_email;
      const reply_to = (p.reply_to && typeof p.reply_to === "string") ? p.reply_to.trim() : null;
      const is_default = p.is_default === true ? 1 : 0;
      const now = new Date().toISOString();
      const db = getDb();
      const existing = db.prepare("SELECT id FROM smtp_accounts WHERE id = ?").get(id);
      if (existing) {
        db.prepare(
          "UPDATE smtp_accounts SET name=?, from_name=?, from_email=?, host=?, port=?, secure=?, auth_user=?, reply_to=?, is_default=?, updated_at=? WHERE id=?"
        ).run(name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, now, id);
        if (typeof p.password === "string" && p.password.length > 0) {
          await secureSetPassword(id, p.password);
        }
      } else {
        db.prepare(
          "INSERT INTO smtp_accounts (id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)"
        ).run(id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, now, now);
        if (typeof p.password === "string" && p.password.length > 0) {
          await secureSetPassword(id, p.password);
        }
      }
      if (is_default === 1) {
        db.prepare("UPDATE smtp_accounts SET is_default = 0 WHERE id != ?").run(id);
      }
      return { ok: true, id };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[smtp] upsertAccount failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:smtp:setDefaultAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      getDb().prepare("UPDATE smtp_accounts SET is_default = 0").run();
      getDb().prepare("UPDATE smtp_accounts SET is_default = 1 WHERE id = ?").run(accountId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:smtp:testAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      const db = getDb();
      const row = db.prepare("SELECT * FROM smtp_accounts WHERE id = ?").get(accountId) as import("./emailService").SmtpAccountRow | undefined;
      if (!row) return { ok: false, error: "Konto nie znalezione" };
      const transporter = await (await import("./emailService")).buildTransport(db as import("./emailService").Db, row);
      await transporter.verify();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("[smtp] testAccount failed", e);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle("planlux:smtp:deleteAccount", async (_, accountId: string) => {
    try {
      requireRole(["ADMIN"]);
      await secureDeletePassword(accountId);
      getDb().prepare("UPDATE smtp_accounts SET active = 0 WHERE id = ?").run(accountId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:smtp:isKeytarAvailable", async () => ({ ok: true, available: isKeytarAvailable() }));

  /** Per-user: SMTP config for current user (no password). */
  ipcMain.handle("planlux:smtp:getForCurrentUser", async () => {
    try {
      const user = requireAuth();
      const db = getDb();
      const row = getAccountByUserId(db as import("./emailService").Db, user.id);
      if (!row) return { ok: true, account: null };
      const { id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, active, created_at, updated_at } = row;
      return { ok: true, account: { id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, active, created_at, updated_at } };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Upsert SMTP for a user. SALESPERSON can only update self; ADMIN/BOSS can update any user. */
  ipcMain.handle("planlux:smtp:upsertForUser", async (_, payload: unknown) => {
    try {
      const user = requireAuth();
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { targetUserId?: string; from_name?: string; from_email?: string; host?: string; port?: number; secure?: boolean; auth_user?: string; smtpPass?: string; reply_to?: string };
      const targetUserId = (typeof p.targetUserId === "string" ? p.targetUserId : null) ?? user.id;
      if (user.role === "SALESPERSON" && targetUserId !== user.id) return { ok: false, error: "Forbidden" };
      const db = getDb();
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(targetUserId) as { email: string } | undefined;
      if (!userRow) return { ok: false, error: "Użytkownik nie znaleziony" };
      const from_email = (typeof p.from_email === "string" ? p.from_email.trim() : null) ?? userRow.email;
      const from_name = (typeof p.from_name === "string" ? p.from_name.trim() : "") || from_email;
      const host = (typeof p.host === "string" ? p.host.trim() : "") || "";
      const port = typeof p.port === "number" ? p.port : 587;
      const secure = p.secure === true ? 1 : 0;
      const auth_user = (typeof p.auth_user === "string" ? p.auth_user.trim() : null) ?? from_email;
      const reply_to = (typeof p.reply_to === "string" ? p.reply_to.trim() : null) || null;
      const now = new Date().toISOString();
      const existing = db.prepare("SELECT id FROM smtp_accounts WHERE user_id = ?").get(targetUserId) as { id: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE smtp_accounts SET from_name=?, from_email=?, host=?, port=?, secure=?, auth_user=?, reply_to=?, updated_at=? WHERE user_id=?"
        ).run(from_name, from_email, host, port, secure, auth_user, reply_to, now, targetUserId);
      } else {
        const id = uuid();
        db.prepare(
          "INSERT INTO smtp_accounts (id, user_id, name, from_name, from_email, host, port, secure, auth_user, reply_to, is_default, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,1,?,?)"
        ).run(id, targetUserId, "", from_name, from_email, host, port, secure, auth_user, reply_to, now, now);
      }
      if (typeof p.smtpPass === "string" && p.smtpPass.length > 0) {
        await setSmtpPassword(targetUserId, p.smtpPass);
      }
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[smtp] upsertForUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Test SMTP connection for a user. */
  ipcMain.handle("planlux:smtp:testForUser", async (_, userId?: string) => {
    try {
      const user = requireAuth();
      const targetUserId = (typeof userId === "string" ? userId : null) ?? user.id;
      if (user.role === "SALESPERSON" && targetUserId !== user.id) return { ok: false, error: "Forbidden" };
      const db = getDb() as import("./emailService").Db;
      const transporter = await buildTransportForUser(db, targetUserId);
      await transporter.verify();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn("[smtp] testForUser failed", e);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle("planlux:settings:getEmailSettings", async () => {
    try {
      requireAuth();
      const db = getDb() as import("./emailService").Db;
      const settings = getEmailSettings(db);
      return { ok: true, settings };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:settings:updateEmailSettings", async (_, payload: unknown) => {
    try {
      requireRole(["ADMIN"]);
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { office_cc_email?: string; office_cc_default_enabled?: boolean; email_template_subject?: string; email_template_body_html?: string; email_template_body_text?: string };
      const db = getDb();
      if (typeof p.office_cc_email === "string") setEmailSetting(db as import("./emailService").Db, "office_cc_email", p.office_cc_email);
      if (typeof p.office_cc_default_enabled === "boolean") setEmailSetting(db as import("./emailService").Db, "office_cc_default_enabled", p.office_cc_default_enabled ? "1" : "0");
      if (typeof p.email_template_subject === "string") setEmailSetting(db as import("./emailService").Db, "email_template_subject", p.email_template_subject);
      if (typeof p.email_template_body_html === "string") setEmailSetting(db as import("./emailService").Db, "email_template_body_html", p.email_template_body_html);
      if (typeof p.email_template_body_text === "string") setEmailSetting(db as import("./emailService").Db, "email_template_body_text", p.email_template_body_text);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Preview subject/body for offer email (templates + vars). */
  ipcMain.handle("planlux:email:getOfferEmailPreview", async (_, offerId: string) => {
    try {
      const user = requireAuth();
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona", subject: "", bodyHtml: "", bodyText: "" };
      const settings = getEmailSettings(db as import("./emailService").Db);
      const offerRow = db.prepare("SELECT offer_number, client_first_name, client_last_name, company_name, user_id FROM offers_crm WHERE id = ?").get(offerId) as { offer_number: string; client_first_name: string; client_last_name: string; company_name: string; user_id: string } | undefined;
      if (!offerRow) return { ok: true, subject: settings.email_template_subject, bodyHtml: settings.email_template_body_html, bodyText: settings.email_template_body_text };
      const salespersonRow = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(user.id) as { display_name: string | null; email: string } | undefined;
      const clientName = [offerRow.client_first_name, offerRow.client_last_name].filter(Boolean).join(" ") || offerRow.company_name || "";
      const templateVars: Record<string, string> = {
        offerNumber: offerRow.offer_number || "",
        clientName,
        companyName: offerRow.company_name || "",
        salespersonName: salespersonRow?.display_name?.trim() || salespersonRow?.email || "",
        salespersonEmail: salespersonRow?.email || "",
        date: new Date().toLocaleDateString("pl-PL"),
      };
      const subject = renderTemplate(settings.email_template_subject, templateVars);
      const bodyHtml = renderTemplate(settings.email_template_body_html, templateVars);
      const bodyText = renderTemplate(settings.email_template_body_text, templateVars);
      return { ok: true, subject, bodyHtml, bodyText, officeCcDefault: settings.office_cc_default_enabled, officeCcEmail: settings.office_cc_email };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message, subject: "", bodyHtml: "", bodyText: "" };
      return { ok: false, error: e instanceof Error ? e.message : String(e), subject: "", bodyHtml: "", bodyText: "" };
    }
  });

  /** Send offer email: templates, CC to office, auto PDF. SALESPERSON = own account; BOSS/ADMIN may send as another user. */
  ipcMain.handle("planlux:email:sendOfferEmail", async (_, payload: unknown) => {
    try {
      const user = requireAuth();
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { offerId: string; to: string; ccOfficeEnabled?: boolean; subjectOverride?: string; bodyOverride?: string; sendAsUserId?: string };
      const offerId = typeof p.offerId === "string" ? p.offerId : "";
      const to = typeof p.to === "string" ? p.to.trim() : "";
      if (!offerId || !to) return { ok: false, error: "Oferta i adres odbiorcy są wymagane" };
      const db = getDb();
      if (!canAccessOffer(db, offerId, user.id)) return { ok: false, error: "Oferta nie znaleziona" };
      const senderUserId = (user.role === "ADMIN" || user.role === "BOSS") && typeof p.sendAsUserId === "string" ? p.sendAsUserId : user.id;
      if (user.role === "SALESPERSON" && senderUserId !== user.id) return { ok: false, error: "Forbidden" };
      const account = getAccountByUserId(db as import("./emailService").Db, senderUserId);
      if (!account) return { ok: false, error: "Skonfiguruj konto SMTP w Panelu admina (E-mail)" };

      const settings = getEmailSettings(db as import("./emailService").Db);
      const offerRow = db.prepare("SELECT offer_number, client_first_name, client_last_name, company_name, user_id FROM offers_crm WHERE id = ?").get(offerId) as { offer_number: string; client_first_name: string; client_last_name: string; company_name: string; user_id: string } | undefined;
      if (!offerRow) return { ok: false, error: "Oferta nie znaleziona" };
      const salespersonRow = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(senderUserId) as { display_name: string | null; email: string } | undefined;
      const clientName = [offerRow.client_first_name, offerRow.client_last_name].filter(Boolean).join(" ") || offerRow.company_name || "";
      const companyName = offerRow.company_name || "";
      const templateVars: Record<string, string> = {
        offerNumber: offerRow.offer_number || "",
        clientName,
        companyName,
        salespersonName: salespersonRow?.display_name?.trim() || salespersonRow?.email || "",
        salespersonEmail: salespersonRow?.email || "",
        date: new Date().toLocaleDateString("pl-PL"),
      };
      const subject = typeof p.subjectOverride === "string" && p.subjectOverride.trim()
        ? p.subjectOverride.trim()
        : renderTemplate(settings.email_template_subject, templateVars);
      const bodyHtml = typeof p.bodyOverride === "string" && p.bodyOverride.trim()
        ? p.bodyOverride.trim()
        : renderTemplate(settings.email_template_body_html, templateVars);
      const bodyText = typeof p.bodyOverride === "string" && p.bodyOverride.trim()
        ? p.bodyOverride.trim().replace(/<[^>]+>/g, " ").trim()
        : renderTemplate(settings.email_template_body_text, templateVars);

      let cc = "";
      if (p.ccOfficeEnabled !== false && settings.office_cc_default_enabled !== false && settings.office_cc_email) {
        cc = settings.office_cc_email.trim();
      } else if (p.ccOfficeEnabled === true && settings.office_cc_email) {
        cc = settings.office_cc_email.trim();
      }

      const eventRows = db.prepare("SELECT details_json FROM event_log WHERE offer_id = ? AND event_type = 'OFFER_CREATED'").all(offerId) as Array<{ details_json: string }>;
      const pdfIds = eventRows.map((r) => {
        try {
          const d = JSON.parse(r.details_json || "{}");
          return d.pdfId;
        } catch {
          return null;
        }
      }).filter(Boolean) as string[];
      let pdfPath: string | null = null;
      let pdfFileName: string | null = null;
      if (pdfIds.length > 0) {
        const pdfRow = db.prepare("SELECT file_path, file_name FROM pdfs WHERE id = ?").get(pdfIds[0]) as { file_path: string; file_name: string } | undefined;
        if (pdfRow?.file_path) {
          pdfPath = pdfRow.file_path;
          pdfFileName = pdfRow.file_name || "oferta.pdf";
        }
      }
      const attachments = pdfPath && pdfFileName ? [{ filename: pdfFileName, path: pdfPath }] : undefined;

      const online = await checkInternetEmail();
      if (!online) {
        const id = enqueueEmail(db as import("./emailService").Db, {
          to,
          cc: cc || undefined,
          subject,
          html: bodyHtml,
          text: bodyText,
          attachments,
          relatedOfferId: offerId,
          accountUserId: senderUserId,
        }, logger);
        return { ok: true, queued: true, outboxId: id };
      }

      const result = await sendOfferEmailNow(db as import("./emailService").Db, {
        to,
        cc: cc || undefined,
        subject,
        bodyHtml,
        bodyText,
        attachments,
        accountUserId: senderUserId,
      }, logger);

      if (result.ok) {
        const now = new Date().toISOString();
        db.prepare("UPDATE offers_crm SET status = 'SENT', emailed_at = ?, updated_at = ? WHERE id = ?").run(now, now, offerId);
        const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
        if (auditTables.length > 0) {
          db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'EMAIL_SENT', ?)").run(
            uuid(), offerId, user.id, JSON.stringify({ to })
          );
        }
        return { ok: true, sent: true };
      }

      enqueueEmail(db as import("./emailService").Db, {
        to,
        cc: cc || undefined,
        subject,
        html: bodyHtml,
        text: bodyText,
        attachments,
        relatedOfferId: offerId,
        accountUserId: senderUserId,
      }, logger);
      return { ok: true, queued: true, error: result.error };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[email] sendOfferEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:email:send", async (_, payload: unknown) => {
    try {
      requireAuth();
      if (!payload || typeof payload !== "object") return { ok: false, error: "Invalid payload" };
      const p = payload as { to?: string; cc?: string; bcc?: string; subject?: string; text?: string; html?: string; attachments?: Array<{ filename: string; path: string }>; relatedOfferId?: string; accountId?: string | null };
      const to = typeof p.to === "string" ? p.to.trim() : "";
      const subject = typeof p.subject === "string" ? p.subject.trim() : "";
      if (!to || !subject) return { ok: false, error: "Do i temat są wymagane" };
      const online = await checkInternetEmail();
      const db = getDb() as import("./emailService").Db;
      if (!online) {
        const id = enqueueEmail(db, {
          to,
          cc: p.cc,
          bcc: p.bcc,
          subject,
          text: p.text,
          html: p.html,
          attachments: p.attachments,
          relatedOfferId: p.relatedOfferId,
          accountId: p.accountId,
        }, logger);
        return { ok: true, queued: true, outboxId: id };
      }
      const { getDefaultAccount: getDefaultSmtpAccount } = await import("./emailService");
      const defaultAccount = getDefaultSmtpAccount(db);
      if (!defaultAccount && !p.accountId) return { ok: false, error: "Skonfiguruj konto SMTP w Panelu admina" };
      const accountId = p.accountId ?? defaultAccount?.id ?? null;
      const account: import("./emailService").SmtpAccountRow | null | undefined = accountId
        ? (db.prepare("SELECT * FROM smtp_accounts WHERE id = ? AND active = 1").get(accountId) as import("./emailService").SmtpAccountRow | undefined)
        : defaultAccount;
      if (!account) return { ok: false, error: "Konto SMTP nie znalezione" };
      const tempId = uuid();
      const outboxRow: import("./emailService").EmailOutboxRow = {
        id: tempId,
        account_id: account.id,
        to_addr: to,
        cc: p.cc || null,
        bcc: p.bcc || null,
        subject,
        text_body: p.text || null,
        html_body: p.html || null,
        attachments_json: JSON.stringify(p.attachments || []),
        related_offer_id: p.relatedOfferId || null,
        status: "queued",
        retry_count: 0,
        next_retry_at: null,
        last_error: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const result = await sendNow(db, outboxRow, logger);
      if (result.ok) {
        db.prepare(
          "INSERT INTO email_history (id, outbox_id, account_id, to_addr, subject, status, provider_message_id, sent_at, created_at) VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?)"
        ).run(uuid(), tempId, account.id, to, subject, result.messageId || null, new Date().toISOString(), new Date().toISOString());
        return { ok: true, sent: true };
      }
      enqueueEmail(db, { to, cc: p.cc, bcc: p.bcc, subject, text: p.text, html: p.html, attachments: p.attachments, relatedOfferId: p.relatedOfferId, accountId: account.id }, logger);
      return { ok: true, queued: true, outboxId: tempId };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      logger.error("[email] send failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:email:outboxList", async (_, filter: { status?: string }) => {
    try {
      requireAuth();
      const status = filter?.status;
      const db = getDb();
      const rows = status
        ? db.prepare("SELECT * FROM email_outbox WHERE status = ? ORDER BY created_at DESC LIMIT 200").all(status)
        : db.prepare("SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 200").all();
      return { ok: true, items: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });

  ipcMain.handle("planlux:email:retryNow", async (_, outboxId: string) => {
    try {
      requireAuth();
      getDb().prepare("UPDATE email_outbox SET next_retry_at = NULL, status = 'queued', updated_at = ? WHERE id = ?").run(new Date().toISOString(), outboxId);
      return { ok: true };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:email:historyList", async (_, limit?: number) => {
    try {
      requireAuth();
      const limitNum = typeof limit === "number" ? Math.min(limit, 500) : 100;
      const rows = getDb().prepare("SELECT * FROM email_history ORDER BY created_at DESC LIMIT ?").all(limitNum);
      return { ok: true, items: rows };
    } catch (e) {
      if (e instanceof Error && (e.message === "Unauthorized" || e.message === "Forbidden")) return { ok: false, error: e.message };
      return { ok: false, error: e instanceof Error ? e.message : String(e), items: [] };
    }
  });
}
