/**
 * OfferDraftStore – single source of truth dla Kalkulatora.
 * Stan wspólny: wymiary, klient, wariant, dodatki, pdfOverrides.
 * Persystencja: debounce 800ms → planlux:saveOfferDraft.
 */

import { mergePdfOverrides, type PdfOverrides } from "./pdfOverrides";
import type { GeneratePdfPayload } from "@planlux/shared";

export type OfferStatus = "DRAFT" | "READY_TO_SEND" | "SENT" | "ACCEPTED" | "REJECTED";

export interface OfferVersion {
  payload: Record<string, unknown>;
  overrides: PdfOverrides;
  timestamp: string;
}

export interface StatusHistoryEntry {
  status: OfferStatus;
  note?: string;
  timestamp: string;
}

export interface PdfHistoryEntry {
  fileName: string;
  createdAt: string;
}

export interface EmailHistoryEntry {
  to: string;
  subject: string;
  status: string;
  sentAt: string;
}

export interface OfferDraft {
  draftId: string;
  /** Kalkulator */
  variantHali: string;
  widthM: string;
  lengthM: string;
  heightM: string;
  clientName: string;
  clientNip: string;
  clientEmail: string;
  clientPhone: string;
  addons: Array<{ nazwa: string; ilosc: number }>;
  /** Standardy: element → w cenie (INCLUDED_FREE) vs dolicz (CHARGE_EXTRA) */
  standardSnapshot: Array<{ element: string; pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA" }>;
  /** Auto system rynnowy (obwód × stawka) */
  rainGuttersAuto?: boolean;
  /** Bramy segmentowe: width, height, quantity */
  gates?: Array<{ width: number; height: number; quantity: number }>;
  /** Auto dopłata za wysokość */
  heightSurchargeAuto?: boolean;
  /** Ręczne dopłaty */
  manualSurcharges?: Array<{ description: string; amount: number }>;
  /** PDF overrides (cena str.1, treści str.2) */
  pdfOverrides: PdfOverrides;
  /** Metadata */
  updatedAt: string;
  lastPreviewAt: string | null;
  /** Sprzedaż MVP */
  offerNumber?: string;
  offerNumberLocked?: boolean;
  status?: OfferStatus;
  statusNote?: string;
  versions?: OfferVersion[];
  statusHistory?: StatusHistoryEntry[];
  pdfHistory?: PdfHistoryEntry[];
  emailHistory?: EmailHistoryEntry[];
}

function createEmptyDraft(): OfferDraft {
  return {
    draftId: crypto.randomUUID(),
    variantHali: "T18_T35_DACH",
    widthM: "",
    lengthM: "",
    heightM: "",
    heightSurchargeAuto: true,
    clientName: "",
    clientNip: "",
    clientEmail: "",
    clientPhone: "",
    addons: [],
    standardSnapshot: [],
    pdfOverrides: {},
    updatedAt: new Date().toISOString(),
    lastPreviewAt: null,
  };
}

let state: OfferDraft = createEmptyDraft();
let syncingOfferNumber = false;
const listeners = new Set<() => void>();

/** Cached snapshot for useSyncExternalStore – only updated when state/syncingOfferNumber changes. */
export type OfferDraftSnapshot = OfferDraft & { syncingOfferNumber: boolean };
let cachedSnapshot: OfferDraftSnapshot = { ...state, syncingOfferNumber };

function refreshCachedSnapshot() {
  cachedSnapshot = { ...state, syncingOfferNumber };
}
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 10_000;
let syncErrorHandler: ((msg: string) => void) | null = null;

export function setSyncErrorHandler(fn: ((msg: string) => void) | null) {
  syncErrorHandler = fn;
}

/** Wywołaj sync TEMP→PLX (np. po powrocie online). Ustawia badge, aktualizuje numer. Zwraca nowy numer lub undefined. */
export function requestSyncTempNumbers(): Promise<string | undefined> {
  const invoke = (window as unknown as { planlux?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }).planlux?.invoke;
  if (!invoke || !state.offerNumber?.startsWith("TEMP-")) return Promise.resolve(undefined);
  setSyncingOfferNumber(true);
  return invoke("planlux:isOnline")
    .then((res: unknown) => (res as { online?: boolean })?.online)
    .then(async (online) => {
      if (!online) return undefined;
      const syncRes = (await invoke("planlux:syncTempOfferNumbers")) as {
        updated?: Array<{ offerId: string; newNumber: string }>;
        failed?: Array<{ offerId: string; error: string }>;
      };
      const u = syncRes?.updated?.find((x) => x.offerId === state.draftId);
      if (u?.newNumber) {
        state = { ...state, offerNumber: u.newNumber, updatedAt: new Date().toISOString() };
        refreshCachedSnapshot();
        notify();
        return u.newNumber;
      }
      if (syncRes?.failed?.length) {
        syncErrorHandler?.(syncRes.failed.find((f) => f.offerId === state.draftId)?.error ?? syncRes.failed[0]?.error ?? "Błąd sync");
      }
      return undefined;
    })
    .finally(() => setSyncingOfferNumber(false));
}

function setSyncingOfferNumber(v: boolean) {
  if (syncingOfferNumber !== v) {
    syncingOfferNumber = v;
    refreshCachedSnapshot();
    notify();
  }
}

function saveToBackend(): Promise<void> {
  const invoke = (window as unknown as { planlux?: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } }).planlux?.invoke;
  if (!invoke) return Promise.resolve();
  return invoke("planlux:saveOfferDraft", state)
    .then(async (res: unknown) => {
      const r = res as { ok?: boolean };
      if (!r?.ok) return;
      const offerNum = state.offerNumber ?? "";
      if (!offerNum.startsWith("TEMP-")) return;
      const onlineRes = (await invoke("planlux:isOnline")) as { online?: boolean };
      if (!onlineRes?.online) return;
      setSyncingOfferNumber(true);
      try {
        const syncRes = (await invoke("planlux:syncTempOfferNumbers")) as {
          ok?: boolean;
          updated?: Array<{ offerId: string; oldNumber: string; newNumber: string }>;
          failed?: Array<{ offerId: string; error: string }>;
        };
        const u = syncRes?.updated?.find((x) => x.offerId === state.draftId);
        if (u?.newNumber) {
          state = { ...state, offerNumber: u.newNumber, updatedAt: new Date().toISOString() };
          refreshCachedSnapshot();
          notify();
        } else if (syncRes?.failed?.some((f) => f.offerId === state.draftId) || (syncRes?.failed?.length ?? 0) > 0) {
          const err = syncRes.failed?.find((f) => f.offerId === state.draftId)?.error ?? syncRes.failed?.[0]?.error ?? "Nie udało się zsynchronizować numeru";
          syncErrorHandler?.(err);
        }
      } catch (e) {
        syncErrorHandler?.(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncingOfferNumber(false);
      }
    })
    .catch(() => {}) as Promise<void>;
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    saveToBackend();
  }, DEBOUNCE_MS);
}

/** Natychmiastowy zapis (przy blur, zmianie zakładki, zamknięciu). */
function flushSave(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  return saveToBackend();
}

function notify() {
  listeners.forEach((l) => l());
}

function setState(updater: (prev: OfferDraft) => OfferDraft) {
  state = { ...updater(state), updatedAt: new Date().toISOString() };
  refreshCachedSnapshot();
  scheduleSave();
  notify();
}

function getSnapshot(): OfferDraftSnapshot {
  return cachedSnapshot;
}

export const offerDraftStore = {
  getState: () => state,
  getSyncingOfferNumber: () => syncingOfferNumber,
  getSnapshot,
  flushSave,

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Kalkulator */
  setVariantHali: (v: string) => setState((s) => ({ ...s, variantHali: v })),
  setWidthM: (v: string) => setState((s) => ({ ...s, widthM: v })),
  setLengthM: (v: string) => setState((s) => ({ ...s, lengthM: v })),
  setHeightM: (v: string) => setState((s) => ({ ...s, heightM: v })),
  setClientName: (v: string) => setState((s) => ({ ...s, clientName: v })),
  setClientNip: (v: string) => setState((s) => ({ ...s, clientNip: v })),
  setClientEmail: (v: string) => setState((s) => ({ ...s, clientEmail: v })),
  setClientPhone: (v: string) => setState((s) => ({ ...s, clientPhone: v })),
  setAddons: (v: Array<{ nazwa: string; ilosc: number }>) => setState((s) => ({ ...s, addons: v })),
  setStandardSnapshot: (v: Array<{ element: string; pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA" }>) =>
    setState((s) => ({ ...s, standardSnapshot: v })),
  setRainGuttersAuto: (v: boolean) => setState((s) => ({ ...s, rainGuttersAuto: v })),
  setGates: (v: Array<{ width: number; height: number; quantity: number }>) => setState((s) => ({ ...s, gates: v })),
  setHeightSurchargeAuto: (v: boolean) => setState((s) => ({ ...s, heightSurchargeAuto: v })),
  setManualSurcharges: (v: Array<{ description: string; amount: number }>) => setState((s) => ({ ...s, manualSurcharges: v })),

  /** PDF overrides */
  setPdfOverrides: (v: PdfOverrides) =>
    setState((s) => ({ ...s, pdfOverrides: mergePdfOverrides(v) })),
  setLastPreviewAt: (v: string | null) => setState((s) => ({ ...s, lastPreviewAt: v })),

  /** Sprzedaż */
  setOfferNumber: (v: string) => setState((s) => ({ ...s, offerNumber: v })),
  setDraftId: (v: string) => setState((s) => ({ ...s, draftId: v })),
  lockOfferNumber: () => setState((s) => ({ ...s, offerNumberLocked: true })),
  setStatus: (v: OfferStatus) =>
    setState((s) => {
      const changed = s.status !== v;
      return {
        ...s,
        status: v,
        statusHistory: changed
          ? [...(s.statusHistory ?? []), { status: v, note: s.statusNote, timestamp: new Date().toISOString() }].slice(-20)
          : (s.statusHistory ?? []),
      };
    }),
  setStatusNote: (v: string) => setState((s) => ({ ...s, statusNote: v })),
  saveVersion: (payload: Record<string, unknown>, overrides: PdfOverrides) =>
    setState((s) => ({
      ...s,
      versions: [
        ...(s.versions ?? []),
        { payload, overrides, timestamp: new Date().toISOString() },
      ].slice(-50),
    })),
  addPdfHistory: (fileName: string) =>
    setState((s) => ({
      ...s,
      pdfHistory: [...(s.pdfHistory ?? []), { fileName, createdAt: new Date().toISOString() }].slice(-50),
    })),
  addEmailHistory: (entry: EmailHistoryEntry) =>
    setState((s) => ({
      ...s,
      emailHistory: [...(s.emailHistory ?? []), entry].slice(-50),
    })),
  restoreVersion: (v: OfferVersion) =>
    setState((s) => {
      const p = v.payload as { offer?: { clientName?: string; clientNip?: string; clientEmail?: string; clientPhone?: string; widthM?: number; lengthM?: number; heightM?: number; variantHali?: string }; offerNumber?: string };
      const o = p?.offer;
      return {
        ...s,
        ...(o && {
          clientName: o.clientName ?? s.clientName,
          clientNip: o.clientNip ?? s.clientNip,
          clientEmail: o.clientEmail ?? s.clientEmail,
          clientPhone: o.clientPhone ?? s.clientPhone,
          widthM: o.widthM != null ? String(o.widthM) : s.widthM,
          lengthM: o.lengthM != null ? String(o.lengthM) : s.lengthM,
          heightM: o.heightM != null ? String(o.heightM) : s.heightM,
          variantHali: o.variantHali ?? s.variantHali,
        }),
        ...(p?.offerNumber && { offerNumber: p.offerNumber }),
        pdfOverrides: mergePdfOverrides(v.overrides),
      };
    }),

  /** Hydracja z backendu */
  hydrate: (loaded: Partial<OfferDraft> & Record<string, unknown> | null) => {
    if (!loaded || typeof loaded !== "object") return;
    const { canvaLayout: _c, editorContent: _e, ...rest } = loaded;
    state = {
      ...createEmptyDraft(),
      ...rest,
      draftId: loaded.draftId ?? state.draftId,
      standardSnapshot: loaded.standardSnapshot ?? state.standardSnapshot,
      rainGuttersAuto: loaded.rainGuttersAuto ?? state.rainGuttersAuto,
      gates: loaded.gates ?? state.gates,
      heightSurchargeAuto: loaded.heightSurchargeAuto ?? state.heightSurchargeAuto,
      manualSurcharges: loaded.manualSurcharges ?? state.manualSurcharges,
      pdfOverrides: mergePdfOverrides(loaded.pdfOverrides ?? loaded.editorContent),
      offerNumber: loaded.offerNumber ?? state.offerNumber,
      offerNumberLocked: loaded.offerNumberLocked ?? state.offerNumberLocked,
      status: loaded.status ?? state.status,
      statusNote: loaded.statusNote ?? state.statusNote,
      versions: loaded.versions ?? state.versions,
      statusHistory: loaded.statusHistory ?? state.statusHistory,
      pdfHistory: loaded.pdfHistory ?? state.pdfHistory,
      emailHistory: loaded.emailHistory ?? state.emailHistory,
      updatedAt: state.updatedAt,
    };
    refreshCachedSnapshot();
    notify();
  },

  /** Reset global */
  resetGlobal: () => {
    state = createEmptyDraft();
    refreshCachedSnapshot();
    saveToBackend();
    notify();
  },

  /** Reset tylko edycję PDF */
  resetPdfOverrides: () => {
    setState((s) => ({ ...s, pdfOverrides: {} }));
  },
};

/** Buduje GeneratePdfPayload z draftu + pricing (z kalkulatora). */
export function buildPayloadFromDraft(
  userId: string,
  pricing: { totalPln: number; base?: { totalBase?: number }; additions?: unknown[]; standardInPrice?: unknown[] },
  opts?: { sellerName?: string }
): GeneratePdfPayload {
  const d = offerDraftStore.getState();
  const w = parseFloat(d.widthM) || 0;
  const l = parseFloat(d.lengthM) || 0;
  const h = d.heightM ? parseFloat(d.heightM) : undefined;
  const areaM2 = w * l;
  return {
    userId,
    offerNumber: d.offerNumber?.trim() || "—",
    sellerName: opts?.sellerName?.trim() || "Planlux",
    offer: {
      clientName: d.clientName || "Klient",
      clientNip: d.clientNip || undefined,
      clientEmail: d.clientEmail || undefined,
      clientPhone: d.clientPhone || undefined,
      widthM: w || 20,
      lengthM: l || 40,
      heightM: h,
      areaM2: areaM2 || 800,
      variantNazwa: d.variantHali,
      variantHali: d.variantHali,
    },
    pricing: {
      totalPln: pricing.totalPln,
      base: pricing.base,
      additions: pricing.additions,
      standardInPrice: pricing.standardInPrice,
    },
    clientAddressOrInstall: "Adres montażu – do uzupełnienia",
  };
}
