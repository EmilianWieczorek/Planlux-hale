/**
 * IPC handlers – bridge renderer <-> main.
 */

import { ipcMain, app, shell } from "electron";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import type { GeneratePdfPayload } from "@planlux/shared";
import { generatePdfPipeline } from "./pdf/generatePdf";
import { generatePdfFromTemplate, mapOfferDataToPayload, type GeneratePdfFromTemplateOptions } from "./pdf/generatePdfFromTemplate";
import { getTestPdfFileName } from "./pdf/generatePdf";
import { getPdfTemplateDir } from "./pdf/pdfPaths";
import { createSendEmailForFlush } from "./smtpSend";
import { createFilePdfTemplateConfigStore } from "./pdf/pdfTemplateConfigStore";
import { getPreviewHtmlWithInlinedAssets } from "./pdf/renderTemplate";
import { getNextOfferNumber as getNextOfferNumberLocal } from "./offerCounters";

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

export function   registerIpcHandlers(deps: {
  getDb: () => ReturnType<typeof import("better-sqlite3")>;
  apiClient: import("@planlux/shared").ApiClient;
  config: { appVersion: string };
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}) {
  const { getDb, config, apiClient, logger } = deps;

  ipcMain.handle("planlux:login", async (_, email: string, password: string) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT * FROM users WHERE email = ? AND active = 1").get(email) as
        | { id: string; email: string; role: string; password_hash: string; display_name: string }
        | undefined;
      if (!row || !verifyPassword(password, row.password_hash)) {
        return { ok: false, error: "Nieprawidłowy email lub hasło" };
      }
      const sessionId = uuid();
      db.prepare(
        "INSERT INTO sessions (id, user_id, device_type, app_version) VALUES (?, ?, 'desktop', ?)"
      ).run(sessionId, row.id, config.appVersion);
      return {
        ok: true,
        user: {
          id: row.id,
          email: row.email,
          role: normalizeRole(row.role),
          displayName: row.display_name,
        },
        sessionId,
      };
    } catch (e) {
      logger.error("login failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:endSession", async () => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1").get() as { id: string } | undefined;
      if (row) {
        db.prepare("UPDATE sessions SET ended_at = datetime('now') WHERE id = ?").run(row.id);
      }
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
  ipcMain.handle("planlux:enqueueHeartbeat", async (_, userId: string) => {
    try {
      const db = getDb();
      const user = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(userId) as { email: string } | undefined;
      if (!user) return { ok: false, error: "Użytkownik nie znaleziony" };
      const { generateOutboxId } = await import("@planlux/shared");
      const config = (await import("../src/config")).config;
      const payload = {
        id: uuid(),
        userId,
        userEmail: user.email,
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
          userId,
          "desktop",
          config.appVersion ?? "1.0.0",
          payload.occurredAt
        );
      }
      return { ok: true };
    } catch (e) {
      logger.error("enqueueHeartbeat failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getActivity", async (_, userId: string, isAdmin: boolean) => {
    try {
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, data: [] };
      const rows = isAdmin
        ? db.prepare(
            `SELECT a.id, a.user_id, a.device_type, a.app_version, a.occurred_at, u.display_name as user_display_name, u.email as user_email
             FROM activity a LEFT JOIN users u ON a.user_id = u.id
             ORDER BY a.occurred_at DESC LIMIT 200`
          ).all()
        : db.prepare("SELECT * FROM activity WHERE user_id = ? ORDER BY occurred_at DESC LIMIT 100").all(userId);
      return { ok: true, data: rows };
    } catch (e) {
      logger.error("getActivity failed", e);
      return { ok: false, error: String(e), data: [] };
    }
  });

  ipcMain.handle("planlux:getUsers", async () => {
    try {
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
      logger.error("getUsers failed", e);
      return { ok: false, error: String(e), users: [] };
    }
  });

  /** Admin: utwórz użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:createUser", async (_, actingUserId: string, payload: { email: string; password: string; displayName?: string; role?: string }) => {
    try {
      const db = getDb();
      const actor = db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(actingUserId) as { role: string } | undefined;
      if (!actor || actor.role !== "ADMIN") {
        return { ok: false, error: "Brak uprawnień (wymagana rola ADMIN)" };
      }
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
      logger.error("[admin] createUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Admin: aktualizuj użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:updateUser", async (_, actingUserId: string, targetUserId: string, payload: { email?: string; displayName?: string; role?: string; password?: string }) => {
    try {
      const db = getDb();
      const actor = db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(actingUserId) as { role: string } | undefined;
      if (!actor || actor.role !== "ADMIN") {
        return { ok: false, error: "Brak uprawnień (wymagana rola ADMIN)" };
      }
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
      logger.error("[admin] updateUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Admin: wyłącz/włącz użytkownika. Wymaga roli ADMIN. */
  ipcMain.handle("planlux:disableUser", async (_, actingUserId: string, targetUserId: string, active: boolean) => {
    try {
      const db = getDb();
      const actor = db.prepare("SELECT role FROM users WHERE id = ? AND active = 1").get(actingUserId) as { role: string } | undefined;
      if (!actor || actor.role !== "ADMIN") {
        return { ok: false, error: "Brak uprawnień (wymagana rola ADMIN)" };
      }
      const target = db.prepare("SELECT id FROM users WHERE id = ?").get(targetUserId);
      if (!target) return { ok: false, error: "Użytkownik nie znaleziony" };
      db.prepare("UPDATE users SET active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, targetUserId);
      logger.info("[admin] disableUser", { targetUserId, active });
      return { ok: true };
    } catch (e) {
      logger.error("[admin] disableUser failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("planlux:getOffers", async (_, userId: string, isAdmin: boolean) => {
    try {
      const db = getDb();
      const rows = isAdmin
        ? db.prepare("SELECT * FROM offers ORDER BY created_at DESC LIMIT 200").all()
        : db.prepare("SELECT * FROM offers WHERE user_id = ? ORDER BY created_at DESC LIMIT 200").all(userId);
      return { ok: true, data: rows };
    } catch (e) {
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
  ipcMain.handle("planlux:createOffer", async (_, userId: string, minimalData?: { clientName?: string; widthM?: number; lengthM?: number }) => {
    try {
      const numRes = await (async () => {
        const db = getDb();
        const row = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(userId) as { display_name: string | null; email?: string } | undefined;
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
      ).run(offerId, numRes.offerNumber, userId.trim(), clientFirstName, clientLastName, companyName, w, l, areaM2, nowIso, nowIso);

      const auditTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offer_audit'").all() as Array<{ name: string }>;
      if (auditTables.length > 0) {
        db.prepare("INSERT INTO offer_audit (id, offer_id, user_id, type, payload_json) VALUES (?, ?, ?, 'CREATE_OFFER', ?)").run(
          uuid(), offerId, userId.trim(), JSON.stringify({ offerNumber: numRes.offerNumber, clientName, widthM: w, lengthM: l })
        );
      }
      logger.info("[crm] createOffer ok", { offerId, offerNumber: numRes.offerNumber });
      return { ok: true, offerId, offerNumber: numRes.offerNumber, isTemp: numRes.isTemp ?? false };
    } catch (e) {
      logger.error("[crm] createOffer failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Auto-numer oferty: zawsze lokalnie z offer_counters (offline-first). TEMP tylko przy wyjątku. */
  ipcMain.handle("planlux:getNextOfferNumber", async (_, userId: string) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT display_name, email FROM users WHERE id = ? AND active = 1").get(userId) as
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
      logger.error("[offer] getNextOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const OFFER_DRAFT_PATH = path.join(app.getPath("userData"), "offer-draft.json");
  ipcMain.handle("planlux:loadOfferDraft", async () => {
    try {
      if (!fs.existsSync(OFFER_DRAFT_PATH)) return { ok: true, draft: null };
      const raw = fs.readFileSync(OFFER_DRAFT_PATH, "utf-8");
      const draft = JSON.parse(raw);
      return { ok: true, draft };
    } catch (e) {
      logger.error("[draft] loadOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:saveOfferDraft", async (_, draft: unknown, userId?: string) => {
    try {
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

      if (hasData && typeof userId === "string" && userId.trim()) {
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
                userId.trim(),
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
                userId.trim(),
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
      logger.error("[draft] saveOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("planlux:clearOfferDraft", async () => {
    try {
      if (fs.existsSync(OFFER_DRAFT_PATH)) fs.unlinkSync(OFFER_DRAFT_PATH);
      return { ok: true };
    } catch (e) {
      logger.error("[draft] clearOfferDraft failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Dashboard: statystyki ofert (per użytkownik lub globalne dla managera). */
  ipcMain.handle("planlux:getDashboardStats", async (_, userId: string, isAdmin: boolean) => {
    try {
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
      const filterUser = isAdmin ? null : userId;
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
        if (isAdmin && r.user_id) {
          const u = userMap.get(r.user_id) ?? { count: 0, totalPln: 0 };
          u.count++;
          u.totalPln += Number(r.total_pln ?? 0) || 0;
          userMap.set(r.user_id, u);
        }
      }

      let perUser: Array<{ userId: string; displayName: string; email: string; count: number; totalPln: number }> = [];
      if (isAdmin && userMap.size > 0) {
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
      logger.error("[dashboard] getDashboardStats failed", e);
      return {
        ok: false,
        byStatus: { IN_PROGRESS: 0, GENERATED: 0, SENT: 0, REALIZED: 0 },
        totalPln: 0,
        perUser: [],
      };
    }
  });

  /** CRM: lista ofert z offers_crm. isAdmin=true → bez filtra user_id (Szef widzi wszystkie). */
  ipcMain.handle("planlux:getOffersCrm", async (_, userId: string, statusFilter: string, searchQuery: string, isAdmin?: boolean) => {
    try {
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='offers_crm'").all() as Array<{ name: string }>;
      if (tables.length === 0) return { ok: true, offers: [] };
      let sql = "SELECT id, offer_number, status, user_id, client_first_name, client_last_name, company_name, nip, phone, variant_hali, width_m, length_m, area_m2, total_pln, created_at, pdf_generated_at, emailed_at, realized_at FROM offers_crm";
      const args: unknown[] = [];
      if (!isAdmin) {
        sql += " WHERE user_id = ?";
        args.push(userId);
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
      logger.error("[crm] getOffersCrm failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e), offers: [] };
    }
  });

  /** CRM: znajdź potencjalne duplikaty (imię/nazwisko, firma, NIP, telefon, e-mail). */
  ipcMain.handle("planlux:findDuplicateOffers", async (
    _,
    userId: string,
    params: { clientName: string; nip?: string; phone?: string; email?: string }
  ) => {
    try {
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
      ).all(userId) as Array<Record<string, unknown>>;

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
  ipcMain.handle("planlux:markOfferRealized", async (_, offerId: string, userId?: string) => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.prepare("UPDATE offers_crm SET status = 'REALIZED', realized_at = ?, updated_at = ? WHERE id = ?").run(now, now, offerId);
      const row = db.prepare("SELECT user_id FROM offers_crm WHERE id = ?").get(offerId) as { user_id: string } | undefined;
      const uid = userId ?? row?.user_id ?? "";
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

  /** CRM: szczegóły oferty (pełne dane). Owner lub manager/admin ma dostęp. */
  ipcMain.handle("planlux:getOfferDetails", async (_, offerId: string, userId: string) => {
    try {
      const db = getDb();
      if (!canAccessOffer(db, offerId, userId)) return { ok: false, error: "Oferta nie znaleziona", offer: null };
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
  ipcMain.handle("planlux:getOfferAudit", async (_, offerId: string, userId: string) => {
    try {
      const db = getDb();
      if (!canAccessOffer(db, offerId, userId)) return { ok: false, error: "Oferta nie znaleziona", items: [] };
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

  /** CRM: historia e-maili dla oferty. Owner lub manager/admin ma dostęp. */
  ipcMain.handle("planlux:getEmailHistoryForOffer", async (_, offerId: string, userId: string) => {
    try {
      const db = getDb();
      if (!canAccessOffer(db, offerId, userId)) return { ok: false, error: "Oferta nie znaleziona", emails: [] };
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

  /** CRM: pliki PDF powiązane z ofertą (z event_log). Owner lub manager/admin ma dostęp. */
  ipcMain.handle("planlux:getPdfsForOffer", async (_, offerId: string, userId: string) => {
    try {
      const db = getDb();
      if (!canAccessOffer(db, offerId, userId)) return { ok: false, error: "Oferta nie znaleziona", pdfs: [] };
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

  /** CRM: zamień numer oferty (np. TEMP→final po sync). */
  ipcMain.handle("planlux:replaceOfferNumber", async (_, offerId: string, newOfferNumber: string) => {
    try {
      const db = getDb();
      db.prepare("UPDATE offers_crm SET offer_number = ?, updated_at = datetime('now') WHERE id = ?").run(newOfferNumber, offerId);
      return { ok: true };
    } catch (e) {
      logger.error("[crm] replaceOfferNumber failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** CRM: wyślij e-mail oferty (online: SMTP + SENT; offline: QUEUED + outbox). */
  ipcMain.handle("planlux:sendOfferEmail", async (
    _,
    offerId: string,
    userId: string,
    params: { to: string; subject: string; body: string; pdfPath?: string }
  ) => {
    try {
      const db = getDb();
      const userRow = db.prepare("SELECT email FROM users WHERE id = ? AND active = 1").get(userId) as { email: string } | undefined;
      if (!userRow?.email) return { ok: false, error: "Użytkownik nie znaleziony" };

      const offerRow = db.prepare("SELECT id FROM offers_crm WHERE id = ? AND user_id = ?").get(offerId, userId);
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
        userId,
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
              userId,
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
          userId,
          JSON.stringify({ emailId, to: params.to })
        );
      }
      return { ok: true, queued: true };
    } catch (e) {
      logger.error("[email] sendOfferEmail failed", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** CRM: załaduj ofertę do edycji (format dla draft store). */
  ipcMain.handle("planlux:loadOfferForEdit", async (_, offerId: string, userId: string) => {
    try {
      const db = getDb();
      const row = db.prepare("SELECT * FROM offers_crm WHERE id = ? AND user_id = ?").get(offerId, userId) as Record<string, unknown> | undefined;
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

  ipcMain.handle("planlux:getPdfs", async (_, userId: string, isAdmin: boolean) => {
    try {
      const db = getDb();
      const rows = isAdmin
        ? db.prepare(
            `SELECT p.id, p.user_id, p.offer_id, p.client_name, p.variant_hali, p.file_name, p.file_path, p.status, p.created_at,
              u.display_name as user_display_name
             FROM pdfs p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT 100`
          ).all()
        : db.prepare("SELECT * FROM pdfs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId);
      return { ok: true, data: rows };
    } catch (e) {
      logger.error("getPdfs failed", e);
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("planlux:getEmails", async (_, userId: string, isAdmin: boolean) => {
    try {
      const db = getDb();
      const hasEmailHistory = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='email_history'").all() as Array<{ name: string }>).length > 0;
      if (hasEmailHistory) {
        const rows = isAdmin
          ? db.prepare(
              `SELECT eh.id, eh.offer_id, eh.user_id, eh.from_email, eh.to_email, eh.subject, eh.sent_at, eh.status, eh.error_message, eh.created_at,
                u.display_name as user_display_name
               FROM email_history eh
               LEFT JOIN users u ON eh.user_id = u.id
               ORDER BY eh.created_at DESC LIMIT 100`
            ).all()
          : db.prepare(
              `SELECT eh.id, eh.offer_id, eh.user_id, eh.from_email, eh.to_email, eh.subject, eh.sent_at, eh.status, eh.error_message, eh.created_at
               FROM email_history eh WHERE eh.user_id = ? ORDER BY eh.created_at DESC LIMIT 100`
            ).all(userId);
        return { ok: true, data: rows };
      }
      const rows = isAdmin
        ? db.prepare("SELECT * FROM emails ORDER BY created_at DESC LIMIT 100").all()
        : db.prepare("SELECT * FROM emails WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId);
      return { ok: true, data: rows };
    } catch (e) {
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
}
