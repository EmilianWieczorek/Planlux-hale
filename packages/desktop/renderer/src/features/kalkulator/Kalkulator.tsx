import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useOfferDraft } from "../../state/useOfferDraft";
import { buildPayloadFromDraft, offerDraftStore, requestSyncTempNumbers, type OfferStatus } from "../../state/offerDraftStore";
import { buildPdfFileName as buildPdfFileNameFromShared, normalizeErrorMessage as normalizeErrorMessageFromShared } from "@planlux/shared";

/** Bezpieczne wywołanie – fallback gdy import nie zadziała (np. cache Vite). */
const buildPdfFileName =
  typeof buildPdfFileNameFromShared === "function"
    ? buildPdfFileNameFromShared
    : (params: { sellerName?: string; clientCompany?: string; offerNumber: string }) =>
        `PLANLUX-Oferta-${params.clientCompany || params.sellerName || "Handlowiec"}-${(params.offerNumber || "—").replace(/\//g, "-")}.pdf`;

/** W rendererze (Vite) nie ma globalnego process – używamy import.meta.env. */
const isDebugLog = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

/** Normalizacja błędu do tekstu; fallback gdy import z @planlux/shared nie jest funkcją (runtime/bundling). */
function safeNormalizeError(error: unknown): string {
  if (typeof normalizeErrorMessageFromShared === "function") return normalizeErrorMessageFromShared(error);
  if (error == null) return "Nieznany błąd";
  if (typeof error === "string") return error.trim() || "Nieznany błąd";
  if (error instanceof Error) return error.message.trim() || "Nieznany błąd";
  if (typeof error === "object") {
    const o = error as Record<string, unknown>;
    if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
    if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
    if (typeof o.details === "string" && o.details.trim()) return o.details.trim();
    if (typeof o.code === "string" && o.code.trim()) return `Błąd: ${o.code}`;
  }
  const s = String(error);
  return s === "[object Object]" ? "Nieznany błąd" : s;
}
import { mergePdfOverrides } from "../../state/pdfOverrides";
import { tokens } from "../../theme/tokens";
import { KalkulatorPdfPreview } from "./KalkulatorPdfPreview";
import { EdycjaPdfSection } from "./EdycjaPdfSection";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  IconButton,
  Tooltip,
} from "@mui/material";
import { ContentCopy, Lock } from "@mui/icons-material";
import { DuplicateOffersModal, type DuplicateOffer } from "./DuplicateOffersModal";
import { AddonsPanel } from "./AddonsPanel";
import { StandardPanel } from "./StandardPanel";
import { formatStandardLabel } from "./formatStandardLabel";
import { EmailComposer } from "../oferty/EmailComposer";

const defaultVariants = [
  { id: "T18_T35_DACH", name: "Hala T-18 + T-35 dach" },
  { id: "TERM_60_PNEU", name: "Hala Termiczna płyta 60 mm – dach pneumatyczny" },
  { id: "PLYTA_WARSTWOWA", name: "Hala całość z płyty warstwowej" },
  { id: "PLANDEKA_T18", name: "Hala Plandeka boki blacha T-18" },
  { id: "PLANDEKA", name: "Hala Plandeka boki Plandeka" },
];

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: tokens.space[6],
    minHeight: 0,
  } as React.CSSProperties,
  card: {
    background: tokens.color.white,
    borderRadius: tokens.radius.lg,
    boxShadow: tokens.shadow.md,
    padding: tokens.space[5],
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  label: {
    display: "block",
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.medium,
    color: tokens.color.textMuted,
    marginBottom: tokens.space[1],
  } as React.CSSProperties,
  input: {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    fontSize: tokens.font.size.base,
    marginBottom: tokens.space[4],
  } as React.CSSProperties,
  row: {
    display: "flex",
    gap: tokens.space[4],
  } as React.CSSProperties,
  button: {
    padding: "10px 20px",
    background: tokens.color.primary,
    color: tokens.color.white,
    border: "none",
    borderRadius: tokens.radius.md,
    fontWeight: tokens.font.weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,
  buttonSecondary: {
    ...({} as React.CSSProperties),
    padding: "10px 20px",
    background: tokens.color.gray[200],
    color: tokens.color.navy,
    border: "none",
    borderRadius: tokens.radius.md,
    fontWeight: tokens.font.weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,
  total: {
    fontSize: tokens.font.size.xl,
    fontWeight: tokens.font.weight.semiBold,
    color: tokens.color.primary,
    marginTop: tokens.space[4],
  } as React.CSSProperties,
  diag: {
    background: tokens.color.warning + "20",
    color: tokens.color.warning,
    padding: tokens.space[4],
    borderRadius: tokens.radius.md,
    fontSize: tokens.font.size.sm,
    marginTop: tokens.space[4],
  } as React.CSSProperties,
};

interface Props {
  api: (channel: string, ...args: unknown[]) => Promise<unknown>;
  userId: string;
  userDisplayName?: string;
  online?: boolean;
  /** Otwórz ofertę (np. po wyborze z listy duplikatów) – przełącza na Kalkulator i ładuje ofertę */
  onOpenOffer?: (offerId: string) => void;
}

export function Kalkulator({ api, userId, userDisplayName, online, onOpenOffer }: Props) {
  const draft = useOfferDraft();
  const { actions } = draft;
  const clientName = draft.personName || draft.companyName || draft.clientName;
  const companyName = draft.companyName;
  const personName = draft.personName;
  const clientAddress = draft.clientAddress;
  const clientEmail = draft.clientEmail;
  const clientNip = draft.clientNip;
  const clientPhone = draft.clientPhone;
  const variantHali = draft.variantHali;
  const widthM = draft.widthM;
  const lengthM = draft.lengthM;
  const heightM = draft.heightM;
  const selectedStandards = (draft.selectedStandards ?? []) as Array<{ name: string; description: string }>;
  const selectedAddons = (draft.selectedAddons ?? []) as Array<{ name: string; price: number; unit?: string; quantity: number }>;
  const gutterStandard = (draft.gutterStandard ?? { pricingMode: "INCLUDED", calcMode: "BY_LENGTH", sides: 2 }) as {
    pricingMode: "INCLUDED" | "ADD";
    calcMode: "BY_LENGTH" | "BY_WIDTH";
    sides: 1 | 2;
    addonName?: string;
  };
  const normalizeName = useCallback((s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "), []);
  const actualSelectedStandards = (selectedStandards ?? []).filter(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { name?: unknown }).name != null &&
      String((item as { name?: unknown }).name).trim() !== "" &&
      String((item as { name?: unknown }).name) !== "Wybierz standard (w cenie, informacyjnie)"
  );
  const gutterSelected = actualSelectedStandards.some((s) => normalizeName(s?.name) === "system rynnowy");
  const rainGuttersAuto = draft.rainGuttersAuto ?? false;
  const gates = (draft.gates ?? []) as Array<{ width: number; height: number; quantity: number; unitPricePerM2?: number }>;
  const plate80 = draft.plate80 ?? false;
  const plate100 = draft.plate100 ?? false;
  const manualSurcharges = draft.manualSurcharges ?? [];
  const [pricingData, setPricingData] = useState<{
    version?: number;
    lastUpdated?: string;
    cennik: unknown[];
    dodatki: unknown[];
    standard: unknown[];
  } | null>(null);
  const [result, setResult] = useState<{
    success: boolean;
    totalPln?: number;
    totalAdditions?: number;
    errorMessage?: string;
    base?: {
      matched: boolean;
      totalBase?: number;
      fallbackUsed?: boolean;
      fallbackReason?: "AREA_ABOVE_MAX" | "AREA_BELOW_MIN" | "AREA_GAP";
      fallbackInfo?: { area_min_m2: number; area_max_m2: number };
    };
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"offline" | "synced" | "unchanged" | "error" | null>(null);
  const [lastPdfPath, setLastPdfPath] = useState<string | null>(null);
  const [lastPdfFileName, setLastPdfFileName] = useState<string | null>(null);
  const [emailComposerOpen, setEmailComposerOpen] = useState(false);
  const [emailPreview, setEmailPreview] = useState<{ subject: string; body: string; officeCcDefault: boolean; officeCcEmail: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [previewPdfBase64, setPreviewPdfBase64] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfPreviewPage, setPdfPreviewPage] = useState<1 | 2 | 3>(1);
  const [edycjaPdfExpanded, setEdycjaPdfExpanded] = useState(false);
  const [edycjaPdfTab, setEdycjaPdfTab] = useState<0 | 1 | 2>(0);
  const [overwriteOfferNumberDialog, setOverwriteOfferNumberDialog] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState<{ open: boolean; duplicates: DuplicateOffer[] }>({ open: false, duplicates: [] });
  /** E2E/UX: visible status during and after PDF generate (Generowanie… / Wygenerowano / Błąd PDF: …). */
  const [pdfStatusMessage, setPdfStatusMessage] = useState<string | null>(null);
  const pendingPdfGenerateRef = useRef<(() => Promise<void>) | null>(null);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTokenRef = useRef(0);
  const edycjaPdfExpandedRef = useRef(false);
  const generatingRef = useRef(false);
  edycjaPdfExpandedRef.current = edycjaPdfExpanded;
  generatingRef.current = generating;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  /** Sync TEMP→PLX (używa store – pokazuje badge „Rezerwuję numer…”, Snackbar przy błędzie). */
  const runSyncOfferNumber = useCallback(async () => {
    if (!draft.offerNumber?.startsWith("TEMP-")) return;
    const newNum = await requestSyncTempNumbers();
    if (newNum) showToast(`Numer zsynchronizowany: ${newNum}`);
  }, [showToast]);

  const loadPricing = useCallback(async () => {
    const r = ((await api("planlux:getPricingCache")) ?? {}) as {
      ok?: boolean;
      data?: { version?: number; lastUpdated?: string; cennik: unknown[]; dodatki: unknown[]; standard: unknown[] };
    };
    if (r.ok && r.data) setPricingData(r.data);
  }, [api]);

  useEffect(() => {
    loadPricing();
  }, [loadPricing]);

  /** Gdy użytkownik ma dane klienta + wymiary, a brak numeru – utwórz ofertę (createOffer). */
  const createOfferRequestedRef = useRef(false);
  useEffect(() => {
    const w = parseFloat(widthM) || 0;
    const l = parseFloat(lengthM) || 0;
    const hasData = ((companyName ?? "").trim() || (personName ?? "").trim() || (draft.clientName ?? "").trim()).length > 0 && w > 0 && l > 0;
    if (!hasData || draft.offerNumber || draft.offerNumberLocked || createOfferRequestedRef.current) return;
    const invoke = (window as unknown as { planlux?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> } }).planlux?.invoke;
    if (!invoke) return;
    createOfferRequestedRef.current = true;
    const createClientName = ((personName ?? "").trim() || (companyName ?? "").trim() || (draft.clientName ?? "").trim()) || "Klient";
    invoke("planlux:createOffer", { clientName: createClientName, widthM: w, lengthM: l })
      .then((res: unknown) => {
        const r = res as { ok?: boolean; offerId?: string; offerNumber?: string };
        if (r?.ok && r?.offerId && r?.offerNumber) {
          actions.setDraftId(r.offerId);
          actions.setOfferNumber(r.offerNumber);
        } else {
          createOfferRequestedRef.current = false;
        }
      })
      .catch(() => {
        createOfferRequestedRef.current = false;
      });
  }, [companyName, personName, draft.clientName, widthM, lengthM, draft.offerNumber, draft.offerNumberLocked, userId, actions]);

  const prevOnlineRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const wasOffline = prevOnlineRef.current === false;
    prevOnlineRef.current = online;
    if (wasOffline && online && draft.offerNumber?.startsWith("TEMP-")) {
      runSyncOfferNumber();
    }
  }, [online, draft.offerNumber, runSyncOfferNumber]);

  useEffect(() => {
    const autoSync = async () => {
      setSyncing(true);
      try {
        const r = (await api("base:sync")) as {
          ok: boolean;
          status: "synced" | "offline" | "unchanged" | "error";
          version?: number;
          lastUpdated?: string;
          data?: { version?: number; lastUpdated?: string; cennik: unknown[]; dodatki: unknown[]; standard: unknown[] };
          error?: string;
        };
        setSyncStatus(r.status ?? null);
        if (r.ok && r.data) setPricingData(r.data);
      } catch {
        setSyncStatus("error");
      } finally {
        setSyncing(false);
      }
    };
    autoSync();
  }, [api]);

  const syncPricing = async () => {
    setSyncing(true);
    try {
      const r = (await api("base:sync")) as {
        ok: boolean;
        status: "synced" | "offline" | "unchanged" | "error";
        version?: number;
        lastUpdated?: string;
        data?: { version?: number; lastUpdated?: string; cennik: unknown[]; dodatki: unknown[]; standard: unknown[] };
        error?: string;
      };
      setSyncStatus(r.status ?? null);
      if (r.ok && r.data) setPricingData(r.data);
      if (r.status === "synced") showToast("Baza zaktualizowana");
      else if (r.status === "unchanged") showToast("Baza aktualna");
      else if (r.status === "offline") showToast("Offline – używam lokalnej bazy");
      else if (r.status === "error") showToast(r.error ?? "Błąd synchronizacji");
    } catch (e) {
      setSyncStatus("error");
      showToast(e instanceof Error ? e.message : "Błąd sync");
    } finally {
      setSyncing(false);
    }
  };

  const variants =
    pricingData?.cennik &&
    Array.isArray(pricingData.cennik) &&
    (pricingData.cennik as Array<{ wariant_hali: string; Nazwa?: string }>).length > 0
      ? [
          ...new Map(
            (pricingData.cennik as Array<{ wariant_hali: string; Nazwa?: string }>).map((r) => [
              r.wariant_hali,
              { id: r.wariant_hali, name: r.Nazwa ?? r.wariant_hali },
            ])
          ).values(),
        ]
      : defaultVariants;

  const standardOptions =
    (pricingData?.standard as Array<{ wariant_hali: string; element: string; uwagi?: string }> | undefined)
      ?.filter((s) => s?.wariant_hali === variantHali)
      .map((s) => ({ name: String(s.element), description: String(s.uwagi ?? "") }))
      .filter((s) => s.name.trim() !== "") ?? [];

  const rawAddonsForVariant =
    (pricingData?.dodatki as Array<{ wariant_hali: string; nazwa: string; stawka?: number | string; jednostka?: string }> | undefined)
      ?.filter((d) => d?.wariant_hali === variantHali) ?? [];

  const sectionalGateRow = rawAddonsForVariant.find((d) =>
    /dodatkowa\s*brama\s*segmentowa|bramy\s*segmentowe|brama\s*segmentowa/i.test(String(d.nazwa ?? ""))
  );
  const sectionalGateUnitPricePerM2Default =
    sectionalGateRow != null
      ? (typeof sectionalGateRow.stawka === "number" ? sectionalGateRow.stawka : parseFloat(String(sectionalGateRow.stawka ?? 0)) || 0)
      : null;

  // gutterSelected is computed early (above) to avoid TDZ runtime errors.
  const gutterAddonRow = rawAddonsForVariant.find(
    (d) => /rynnowy|rynny/i.test(String(d.nazwa ?? "")) && /mb/i.test(String(d.jednostka ?? ""))
  );
  const gutterAddonName = gutterAddonRow?.nazwa ? String(gutterAddonRow.nazwa) : (gutterStandard.addonName ?? "System rynnowy");
  const gutterUnitPrice =
    gutterAddonRow != null
      ? (typeof gutterAddonRow.stawka === "number" ? gutterAddonRow.stawka : parseFloat(String(gutterAddonRow.stawka ?? 0)) || 0)
      : null;

  const plate80Row = rawAddonsForVariant.find((d) =>
    /dopłata\s*do\s*płyty\s*80\s*mm|doplata\s*do\s*plyty\s*80/i.test(String(d.nazwa ?? ""))
  );
  const plate100Row = rawAddonsForVariant.find((d) =>
    /dopłata\s*do\s*płyty\s*100\s*mm|doplata\s*do\s*plyty\s*100/i.test(String(d.nazwa ?? ""))
  );

  const wNum = parseFloat(widthM) || 0;
  const lNum = parseFloat(lengthM) || 0;
  const gutterBase = gutterStandard.calcMode === "BY_LENGTH" ? lNum : wNum;
  const gutterMb = Math.max(0, gutterBase * (gutterStandard.sides ?? 2));
  const gutterTotalPrice = gutterStandard.pricingMode === "ADD" ? Math.round((gutterUnitPrice ?? 0) * gutterMb) : 0;

  // addon_name is not unique across variants; use stable composite key for React key
  const addonOptions =
    rawAddonsForVariant
      .map((d, idx) => {
        const row = d as { nazwa?: string; stawka?: number | string; jednostka?: string; wariant_hali?: string; Nr?: number };
        return {
          optionKey: `${row.wariant_hali ?? variantHali}-${row.Nr ?? idx}-${String(row.nazwa ?? "")}`,
          name: String(row.nazwa),
          price: typeof row.stawka === "number" ? row.stawka : parseFloat(String(row.stawka ?? 0)) || 0,
          unit: row.jednostka ? String(row.jednostka) : undefined,
        };
      })
      .filter((a) => a.name.trim() !== "")
      .filter((a) => !/dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(a.name))
      .filter((a) => !gutterSelected || a.name !== gutterAddonName)
      // Poza dropdownem – obsługiwane w sekcji „Dodatki specjalne”: płyty 80/100 mm, dopłata za wysokość, bramy segmentowe
      .filter((a) => !/dopłata\s*do\s*płyty\s*80\s*mm|doplata\s*do\s*plyty\s*80/i.test(a.name))
      .filter((a) => !/dopłata\s*do\s*płyty\s*100\s*mm|doplata\s*do\s*plyty\s*100/i.test(a.name))
      .filter((a) => !/dodatkowa\s*brama\s*segmentowa|bramy\s*segmentowe|brama\s*segmentowa/i.test(a.name));

  /** Standardy pokazywane w sekcji "W cenie standardowej" – bez rynien w trybie DOLICZ (te idą do dodatków płatnych). */
  const standardsIncluded = actualSelectedStandards.filter((s) => {
    if (normalizeName((s as { name?: string }).name) === "system rynnowy") return gutterStandard.pricingMode === "INCLUDED";
    return true;
  });

  /** Dodatki płatne do wyświetlenia: tylko dodatki dostępne dla wariantu, z quantity > 0, + rynny w trybie DOLICZ. */
  const availableAddonNamesSet = useMemo(() => new Set(addonOptions.map((o) => o.name)), [addonOptions]);
  const actualPaidAddons = (() => {
    const list: Array<{ label: string; quantity: number; unit: string; price: number; lineTotal: number }> = (selectedAddons ?? [])
      .filter((a) => availableAddonNamesSet.has(a.name) && (a.quantity ?? 0) > 0)
      .map((a) => ({
        label: formatStandardLabel(a.name),
        quantity: a.quantity,
        unit: (a.unit && String(a.unit).trim() ? String(a.unit).trim() : "szt") as string,
        price: a.price ?? 0,
        lineTotal: Math.round((a.price ?? 0) * (a.quantity ?? 0)),
      }));

    // Bramy segmentowe – cena za m² tylko z bazy (sectionalGateUnitPricePerM2Default)
    const unitPriceM2 = sectionalGateUnitPricePerM2Default ?? 0;
    for (const g of gates ?? []) {
      const width = Number.isFinite(g.width) ? g.width : 0;
      const height = Number.isFinite(g.height) ? g.height : 0;
      const qty = Number.isFinite(g.quantity) ? g.quantity : 0;
      if (qty > 0 && width > 0 && height > 0 && unitPriceM2 > 0) {
        const areaOne = width * height;
        const priceOne = areaOne * unitPriceM2;
        const total = Math.round(priceOne * qty);
        list.push({
          label: `Brama segmentowa ${width} × ${height}`,
          quantity: qty,
          unit: "szt",
          price: Math.round(priceOne),
          lineTotal: total,
        });
      }
    }

    if (gutterSelected && gutterStandard.pricingMode === "ADD" && gutterMb > 0) {
      list.push({
        label: formatStandardLabel(gutterAddonName),
        quantity: gutterMb,
        unit: "mb",
        price: gutterUnitPrice ?? 0,
        lineTotal: gutterTotalPrice,
      });
    }
    for (const a of result?.additions ?? []) {
      const nazwa = String((a as { nazwa?: string }).nazwa ?? "");
      if (/dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(nazwa)) {
        const line = a as { nazwa?: string; ilosc?: number; jednostka?: string; stawka?: number; total?: number };
        const qty = line.ilosc ?? 0;
        const total = line.total ?? 0;
        list.push({
          label: "Dopłata za wysokość",
          quantity: qty,
          unit: "mkw",
          price: line.stawka ?? 0,
          lineTotal: total,
        });
      }
      if (/dopłata\s*do\s*płyty\s*80|doplata\s*do\s*plyty\s*80/i.test(nazwa)) {
        const line = a as { nazwa?: string; ilosc?: number; jednostka?: string; stawka?: number; total?: number };
        list.push({
          label: nazwa,
          quantity: line.ilosc ?? 1,
          unit: (line.jednostka && String(line.jednostka).trim()) ? String(line.jednostka).trim() : "szt",
          price: line.stawka ?? 0,
          lineTotal: line.total ?? 0,
        });
      }
      if (/dopłata\s*do\s*płyty\s*100|doplata\s*do\s*plyty\s*100/i.test(nazwa)) {
        const line = a as { nazwa?: string; ilosc?: number; jednostka?: string; stawka?: number; total?: number };
        list.push({
          label: nazwa,
          quantity: line.ilosc ?? 1,
          unit: (line.jednostka && String(line.jednostka).trim()) ? String(line.jednostka).trim() : "szt",
          price: line.stawka ?? 0,
          lineTotal: line.total ?? 0,
        });
      }
    }
    return list;
  })();

  /** Dopłata za wysokość – do wyświetlenia w sekcji „Dodatki specjalne” tylko dla T18_T35_DACH gdy aktywna */
  const heightSurchargeDisplay =
    variantHali === "T18_T35_DACH"
      ? (() => {
          const line = (result?.additions ?? []).find((a) =>
            /dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(String((a as { nazwa?: string }).nazwa ?? ""))
          ) as { nazwa?: string; total?: number } | undefined;
          return line != null && line.total != null && line.total > 0
            ? { label: "Dopłata za wysokość", amount: line.total }
            : null;
        })()
      : null;

  /** Po zmianie wariantu: zostaw tylko dodatki/standardy dostępne dla tego wariantu; wyczyść bramy jeśli wariant nie ma bramy segmentowej. */
  useEffect(() => {
    if (!pricingData) return;
    const d = offerDraftStore.getState();
    const currentAddons = (d.selectedAddons ?? []) as Array<{ name: string }>;
    const currentStandards = (d.selectedStandards ?? []) as Array<{ name: string }>;
    const currentGates = d.gates ?? [];
    const availableAddonNames = new Set(addonOptions.map((o) => o.name));
    const availableStandardNames = new Set(standardOptions.map((o) => o.name));
    const nextAddons = currentAddons.filter((a) => availableAddonNames.has(a.name));
    const nextStandards = currentStandards.filter((s) => availableStandardNames.has((s as { name?: string }).name ?? ""));
    if (nextAddons.length !== currentAddons.length || nextAddons.some((a, i) => a.name !== currentAddons[i]?.name)) {
      actions.setSelectedAddons(nextAddons as Array<{ name: string; price: number; unit?: string; quantity: number; optionKey?: string }>);
    }
    if (nextStandards.length !== currentStandards.length || nextStandards.some((s, i) => (s as { name?: string }).name !== (currentStandards[i] as { name?: string })?.name)) {
      actions.setSelectedStandards(nextStandards as Array<{ name: string; description: string }>);
    }
    if (!sectionalGateRow && currentGates.length > 0) {
      actions.setGates([]);
    }
    if (variantHali !== "T18_T35_DACH" && (d.plate80 || d.plate100)) {
      actions.setPlate80(false);
      actions.setPlate100(false);
    }
    if (nextAddons.length !== currentAddons.length || nextStandards.length !== currentStandards.length || (!sectionalGateRow && currentGates.length > 0)) {
      schedulePreviewRefresh("commit");
    }
  }, [variantHali, pricingData]);

  const recalcInputRef = useRef({
    selectedAddons,
    gates,
    manualSurcharges,
    gutterSelected,
    gutterStandard,
    gutterAddonName,
    gutterMb,
    plate80,
    plate100,
    plate80Name: plate80Row?.nazwa,
    plate100Name: plate100Row?.nazwa,
  });
  recalcInputRef.current = {
    selectedAddons,
    gates,
    manualSurcharges,
    gutterSelected,
    gutterStandard,
    gutterAddonName,
    gutterMb,
    plate80,
    plate100,
    plate80Name: plate80Row?.nazwa,
    plate100Name: plate100Row?.nazwa,
  };

  const recalc = useCallback(async () => {
    const {
      selectedAddons: a,
      gates: g,
      manualSurcharges: m,
      gutterSelected: gs,
      gutterStandard: gc,
      gutterAddonName: gan,
      gutterMb: gmb,
      plate80: p80,
      plate100: p100,
      plate80Name: name80,
      plate100Name: name100,
    } = recalcInputRef.current;
    const w = parseFloat(widthM) || 0;
    const l = parseFloat(lengthM) || 0;
    const h = heightM ? parseFloat(heightM) : undefined;
    if (w <= 0 || l <= 0) {
      setResult(null);
      return;
    }
    try {
      const additions = a.map((x) => ({ nazwa: x.name, ilosc: x.quantity }));
      if (gs && gc.pricingMode === "ADD") {
        additions.push({ nazwa: gan, ilosc: gmb });
      }
      if (p80 && name80) additions.push({ nazwa: String(name80), ilosc: 1 });
      if (p100 && name100) additions.push({ nazwa: String(name100), ilosc: 1 });
      const r = (await api("planlux:calculatePrice", {
        variantHali,
        widthM: w,
        lengthM: l,
        heightM: h,
        selectedAdditions: additions,
        rainGuttersAuto,
        gates: g,
        heightSurchargeAuto: true,
        manualSurcharges: m,
      })) as {
        ok: boolean;
        result?: {
          success: boolean;
          totalPln?: number;
          totalAdditions?: number;
          errorMessage?: string;
          base?: {
            matched: boolean;
            totalBase?: number;
            fallbackUsed?: boolean;
            fallbackReason?: "AREA_ABOVE_MAX" | "AREA_BELOW_MIN" | "AREA_GAP";
            fallbackInfo?: { area_min_m2: number; area_max_m2: number };
          };
        };
      };
      if (r.ok && r.result) setResult(r.result);
    } catch (e) {
      setResult({ success: false, errorMessage: String(e) });
    }
  }, [api, variantHali, widthM, lengthM, heightM, rainGuttersAuto]);

  const recalcTrigger = useMemo(
    () =>
      JSON.stringify(selectedAddons) +
      JSON.stringify(gates) +
      JSON.stringify(manualSurcharges) +
      JSON.stringify(selectedStandards) +
      JSON.stringify(gutterStandard) +
      String(plate80) +
      String(plate100) +
      (plate80Row?.nazwa ?? "") +
      (plate100Row?.nazwa ?? ""),
    [selectedAddons, gates, manualSurcharges, selectedStandards, gutterStandard, plate80, plate100, plate80Row?.nazwa, plate100Row?.nazwa]
  );

  useEffect(() => {
    recalc();
  }, [recalc, recalcTrigger]);

  // selectedAddons is the only source for paid addons. Keep legacy `addons` in sync via store setter.
  const setSelectedAddons = (v: Array<{ name: string; price: number; unit?: string; quantity: number }>) => actions.setSelectedAddons(v);

  const refreshPdfPreview = useCallback(async () => {
    const w = parseFloat(widthM) || 0;
    const l = parseFloat(lengthM) || 0;
    const h = heightM ? parseFloat(heightM) : undefined;
    if (w <= 0 || l <= 0) {
      setPreviewError(null);
      setPreviewPdfBase64(null);
      return;
    }
    const token = ++previewTokenRef.current;
    setPreviewError(null);
    try {
      const r = (await api("planlux:calculatePrice", {
        variantHali,
        widthM: w,
        lengthM: l,
        heightM: h,
        selectedAdditions: (() => {
          const additions = selectedAddons.map((x) => ({ nazwa: x.name, ilosc: x.quantity }));
          if (gutterSelected && gutterStandard.pricingMode === "ADD") additions.push({ nazwa: gutterAddonName, ilosc: gutterMb });
          if (plate80 && plate80Row?.nazwa) additions.push({ nazwa: String(plate80Row.nazwa), ilosc: 1 });
          if (plate100 && plate100Row?.nazwa) additions.push({ nazwa: String(plate100Row.nazwa), ilosc: 1 });
          return additions;
        })(),
        rainGuttersAuto,
        gates,
        heightSurchargeAuto: true,
        manualSurcharges,
      })) as { ok: boolean; result?: { totalPln?: number; base?: unknown; additions?: unknown[]; standardInPrice?: unknown[] } };
      if (token !== previewTokenRef.current) return;
      const pricing = r?.ok && r.result
        ? { totalPln: r.result.totalPln ?? 210_000, base: r.result.base, additions: r.result.additions ?? [], standardInPrice: r.result.standardInPrice ?? [] }
        : { totalPln: 210_000, base: {}, additions: [] as unknown[], standardInPrice: [] as unknown[] };
      if (isDebugLog) {
        console.debug("[Kalkulator] PDF preview – technicalSpec resolved by main (pricing_surface)");
      }
      const payload = buildPayloadFromDraft(userId, pricing, { sellerName: userDisplayName });
      const res = (await api("planlux:generatePdfPreview", payload, draft.pdfOverrides)) as { ok: boolean; base64Pdf?: string; error?: string };
      if (token !== previewTokenRef.current) return;
      if (res?.ok && res.base64Pdf) {
        setPreviewPdfBase64(res.base64Pdf);
        setPreviewError(null);
        actions.setLastPreviewAt(new Date().toISOString());
      } else {
        setPreviewError(res?.error ?? "Błąd generowania podglądu");
        setPreviewPdfBase64(null);
      }
    } catch (e) {
      if (token !== previewTokenRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setPreviewError(msg);
      setPreviewPdfBase64(null);
    } finally {
      /* no loading state - keep showing old preview until new one arrives */
    }
  }, [api, userId, userDisplayName, variantHali, widthM, lengthM, heightM, selectedAddons, rainGuttersAuto, gates, manualSurcharges, plate80, plate100, plate80Row?.nazwa, plate100Row?.nazwa, draft.pdfOverrides, actions]);

  const hasEnoughDataForPreview = parseFloat(widthM) > 0 && parseFloat(lengthM) > 0;
  const DEBOUNCE_TYPING_MS = 450;
  const DEBOUNCE_COMMIT_MS = 120;
  const previewDebounceModeRef = useRef<"typing" | "commit">("typing");

  const schedulePreviewRefresh = useCallback((mode: "typing" | "commit" = "typing") => {
    previewDebounceModeRef.current = mode;
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    const ms = mode === "commit" ? DEBOUNCE_COMMIT_MS : DEBOUNCE_TYPING_MS;
    refreshDebounceRef.current = setTimeout(() => {
      refreshDebounceRef.current = null;
      if (!generatingRef.current && hasEnoughDataForPreview) refreshPdfPreview();
    }, ms);
  }, [refreshPdfPreview, hasEnoughDataForPreview]);

  const hasMountedRef = useRef(false);
  const isFirstChangeEffectRef = useRef(true);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (hasEnoughDataForPreview && !generating) refreshPdfPreview();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    if (isFirstChangeEffectRef.current) {
      isFirstChangeEffectRef.current = false;
      return;
    }
    schedulePreviewRefresh(previewDebounceModeRef.current);
    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, [variantHali, widthM, lengthM, heightM, selectedAddons, selectedStandards, rainGuttersAuto, gates, manualSurcharges, draft.pdfOverrides, draft.offerNumber, schedulePreviewRefresh]);

  useEffect(() => () => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    previewTokenRef.current += 1;
  }, []);

  const handleActivePageChange = useCallback((page: 1 | 2 | 3) => {
    setPdfPreviewPage(page);
    if (edycjaPdfExpandedRef.current) setEdycjaPdfTab((page - 1) as 0 | 1 | 2);
  }, []);

  const doGeneratePdf = async () => {
    if (!result?.success || !(companyName.trim() || personName.trim() || draft.clientName.trim())) return;
    const w = parseFloat(widthM) || 0;
    const l = parseFloat(lengthM) || 0;
    const h = heightM ? parseFloat(heightM) : undefined;
    const areaM2 = w * l;
    const variantNazwa =
      (Array.isArray(variants) ? variants.find((v) => v.id === variantHali)?.name : undefined) ?? variantHali;
    const r = (await api("planlux:calculatePrice", {
      variantHali,
      widthM: w,
      lengthM: l,
      heightM: h,
      selectedAdditions: (() => {
        const additions = selectedAddons.map((x) => ({ nazwa: x.name, ilosc: x.quantity }));
        if (gutterSelected && gutterStandard.pricingMode === "ADD") additions.push({ nazwa: gutterAddonName, ilosc: gutterMb });
        if (plate80 && plate80Row?.nazwa) additions.push({ nazwa: String(plate80Row.nazwa), ilosc: 1 });
        if (plate100 && plate100Row?.nazwa) additions.push({ nazwa: String(plate100Row.nazwa), ilosc: 1 });
        return additions;
      })(),
      rainGuttersAuto,
      gates,
      heightSurchargeAuto: true,
      manualSurcharges,
    })) as { ok: boolean; result?: { base?: { matched?: boolean }; additions?: unknown[]; standardInPrice?: unknown[]; totalPln?: number } };
    if (!r.ok || !r.result) throw new Error("Błąd wyceny");
    if (isDebugLog) {
      console.debug("[Kalkulator] pdf:generate – technicalSpec will be resolved by main (pricing_surface)");
    }
    let offerNumber = draft.offerNumber?.trim();
    if (!offerNumber) {
      if (typeof window.planlux?.invoke === "function") {
        const res = (await api("planlux:getNextOfferNumber")) as { ok: boolean; offerNumber?: string };
        if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
      }
      if (!offerNumber) throw new Error("Nie udało się wygenerować numeru oferty. Użyj IPC (main). Spróbuj ponownie.");
      actions.setOfferNumber(offerNumber);
    }

    // Save offer to Supabase before generating PDF (cloud CRM requirement).
    if (!userId) {
      throw new Error("Zaloguj się, aby zapisać ofertę w chmurze.");
    }
    if (isDebugLog) console.debug("[Kalkulator] saveOffer start");
    const saveRes = (await api("planlux:saveOfferToSupabase", {
      userId,
      clientName: clientName || "Klient",
      clientEmail: clientEmail || undefined,
      clientPhone: clientPhone || undefined,
      clientCompany: companyName || undefined,
      clientAddress: clientAddress || undefined,
      variant: variantHali,
      width: w,
      length: l,
      height: h,
      area: areaM2,
      totalPrice: r.result.totalPln ?? 0,
    })) as { ok: boolean; offer?: { id: string }; error?: unknown };
    if (!saveRes?.ok || !saveRes.offer?.id) {
      if (isDebugLog) console.debug("[Kalkulator] saveOffer fail");
      const msg = safeNormalizeError(saveRes?.error) || "Nie udało się zapisać oferty w Supabase.";
      const short = msg.length > 160 ? msg.slice(0, 157) + "…" : msg;
      setPdfStatusMessage(`Zapis oferty nie powiódł się: ${short}`);
      showToast(short);
      return;
    }
    if (isDebugLog) console.debug("[Kalkulator] saveOffer success", { id: saveRes.offer.id });
    const payload = {
      userId,
      sellerName: userDisplayName?.trim() || "Planlux",
      offer: {
        clientName: clientName || "Klient",
        companyName: companyName || undefined,
        personName: personName || undefined,
        clientAddress: clientAddress || undefined,
        clientNip: clientNip || undefined,
        clientEmail: clientEmail || undefined,
        clientPhone: clientPhone || undefined,
        widthM: w,
        lengthM: l,
        heightM: h,
        areaM2,
        variantNazwa,
        variantHali,
      },
      pricing: r.result,
      offerNumber,
    };
    if (isDebugLog) console.debug("[Kalkulator] pdf:generate start");
    const pdfRes = (await api("pdf:generate", payload, undefined, undefined, draft.pdfOverrides && Object.keys(draft.pdfOverrides).length > 0 ? draft.pdfOverrides : undefined)) as {
      ok: boolean;
      pdfId?: string;
      filePath?: string;
      fileName?: string;
      error?: unknown;
      stage?: string;
      persistenceError?: string;
    };
    if (pdfRes.ok) {
      if (isDebugLog) console.debug("[Kalkulator] pdf:generate success", { fileName: pdfRes.fileName });
      if (pdfRes.stage === "PERSISTENCE_FAILED") {
        const persistMsg = safeNormalizeError(pdfRes.persistenceError) || "Nie udało się zapisać wpisu w historii PDF.";
        setPdfStatusMessage(null);
        showToast(`PDF zapisany: ${pdfRes.fileName ?? ""}. Uwaga: ${persistMsg}`);
      } else {
        setPdfStatusMessage(null);
        showToast(`PDF zapisany: ${pdfRes.fileName ?? ""}`);
      }
      if (pdfRes.filePath) setLastPdfPath(pdfRes.filePath);
      if (pdfRes.fileName) setLastPdfFileName(pdfRes.fileName);
      actions.addPdfHistory(pdfRes.fileName ?? "oferta.pdf");
      actions.lockOfferNumber();
      actions.saveVersion(payload, draft.pdfOverrides ?? {});
      try {
        await offerDraftStore.flushSave();
        runSyncOfferNumber();
      } catch (e) {
        console.error("[Kalkulator] flushSave po generowaniu PDF", e);
      }
    } else {
      if (isDebugLog) console.debug("[Kalkulator] pdf:generate fail", { error: pdfRes.error });
      const msg = safeNormalizeError(pdfRes.error) || "Nie udało się wygenerować PDF. Spróbuj ponownie.";
      const short = msg.length > 120 ? msg.slice(0, 117) + "…" : msg;
      setPdfStatusMessage(`Błąd PDF: ${short}`);
      showToast(short);
    }
  };

  const generatePdf = async () => {
    if (!result?.success || !(companyName.trim() || personName.trim() || draft.clientName.trim())) {
      showToast("Uzupełnij klienta i upewnij się, że wycena jest poprawna");
      return;
    }
    if (isDebugLog) console.debug("[Kalkulator] generatePdf start, generating=true");
    setGenerating(true);
    setPdfStatusMessage("Generowanie...");
    try {
      const dupRes = (await api("planlux:findDuplicateOffers", {
        clientName: clientName || undefined,
        companyName: companyName || undefined,
        personName: personName || undefined,
        nip: clientNip || undefined,
        phone: clientPhone || undefined,
        email: clientEmail || undefined,
      })) as { ok: boolean; duplicates?: DuplicateOffer[] };
      const duplicates = dupRes?.ok && dupRes.duplicates ? dupRes.duplicates : [];
      if (duplicates.length > 0) {
        setDuplicateModal({ open: true, duplicates });
        pendingPdfGenerateRef.current = async () => {
          await doGeneratePdf();
          pendingPdfGenerateRef.current = null;
        };
        return;
      }
      await doGeneratePdf();
    } catch (e) {
      const msg = safeNormalizeError(e) || "Błąd generowania oferty lub PDF.";
      const short = msg.length > 120 ? msg.slice(0, 117) + "…" : msg;
      setPdfStatusMessage(short);
      showToast(short);
    } finally {
      if (isDebugLog) console.debug("[Kalkulator] generatePdf end, generating=false");
      setGenerating(false);
    }
  };

  const dimensionsPreview = [widthM, lengthM, heightM].filter((x) => String(x ?? "").trim() !== "").join(" × ");
  const addonsCount = selectedAddons.reduce((s, a) => s + (a.quantity || 0), 0);
  const standardsCount = actualSelectedStandards.length;
  const salesPriceCaption =
    result?.success && typeof result.totalPln === "number"
      ? `${Math.round(result.totalPln).toLocaleString("pl-PL")} zł`
      : "—";
  const pdfOverrideCount = draft.pdfOverrides && typeof draft.pdfOverrides === "object" ? Object.keys(draft.pdfOverrides).length : 0;
  const pdfEditCaption = pdfOverrideCount > 0 ? "Zmieniono" : "Brak zmian";
  /** Shown only after PDF generation succeeds (doGeneratePdf sets lastPdfPath). */
  const hasGeneratedPdf = Boolean(lastPdfPath?.trim());

  return (
    <div style={styles.grid}>
      <div style={{ overflow: "auto", minHeight: 0 }}>
        <Accordion defaultExpanded={false} sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Klient</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {clientName || companyName || "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <label style={styles.label}>Nazwa firmy</label>
            <input style={styles.input} value={companyName} onChange={(e) => actions.setCompanyName(e.target.value)} placeholder="np. Firma ABC Sp. z o.o." data-testid="client-company" />
            <label style={styles.label}>Imię i nazwisko</label>
            <input style={styles.input} value={personName} onChange={(e) => actions.setPersonName(e.target.value)} placeholder="np. Jan Kowalski" data-testid="client-firstName" />
            <label style={styles.label}>Adres</label>
            <input style={styles.input} value={clientAddress} onChange={(e) => actions.setClientAddress(e.target.value)} placeholder="ul. Przykładowa 1, 00-001 Warszawa" />
            <label style={styles.label}>NIP</label>
            <input style={styles.input} value={clientNip} onChange={(e) => actions.setClientNip(e.target.value)} placeholder="np. 123-456-78-90" />
            <label style={styles.label}>E-mail</label>
            <input style={styles.input} type="email" value={clientEmail} onChange={(e) => actions.setClientEmail(e.target.value)} placeholder="klient@firma.pl" data-testid="client-email" />
            <label style={styles.label}>Telefon</label>
            <input style={styles.input} value={clientPhone} onChange={(e) => actions.setClientPhone(e.target.value)} placeholder="+48 123 456 789" />
          </AccordionDetails>
        </Accordion>
        <Accordion defaultExpanded sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Konfiguracja hali</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {dimensionsPreview || "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <label style={styles.label}>Wariant hali</label>
            <select style={styles.input} value={variantHali} onChange={(e) => { previewDebounceModeRef.current = "commit"; actions.setVariantHali(e.target.value); }} data-testid="hall-variant">
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <div style={styles.row}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Szerokość (m)</label>
                <input style={styles.input} type="number" min={1} step={0.1} value={widthM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setWidthM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} data-testid="hall-width" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Długość (m)</label>
                <input style={styles.input} type="number" min={1} step={0.1} value={lengthM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setLengthM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} data-testid="hall-length" />
              </div>
            </div>
            <label style={styles.label}>Wysokość (m) – opcjonalnie</label>
            <input style={styles.input} type="number" min={0} step={0.01} value={heightM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setHeightM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} placeholder="np. 5.5" data-testid="hall-height" />
          </AccordionDetails>
        </Accordion>

        {/* 3. Standardy */}
        <Accordion defaultExpanded sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Standardy</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {standardsCount > 0 ? `${standardsCount} elementy` : "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <StandardPanel
              standardOptions={standardOptions}
              selectedStandards={selectedStandards}
              onSelectedStandardsChange={(v) => actions.setSelectedStandards(v)}
              gutter={{
                selected: gutterSelected,
                pricingMode: gutterStandard.pricingMode,
                calcMode: gutterStandard.calcMode,
                sides: gutterStandard.sides,
                mb: gutterMb,
                unitPrice: gutterUnitPrice == null ? null : gutterUnitPrice,
                totalPrice: gutterTotalPrice,
              }}
              onGutterChange={(next) => {
                actions.setGutterStandard({ ...gutterStandard, ...next, addonName: gutterAddonName });
              }}
              schedulePreviewRefresh={schedulePreviewRefresh}
              previewDebounceModeRef={previewDebounceModeRef}
            />
          </AccordionDetails>
        </Accordion>

        <Accordion defaultExpanded sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Dodatki</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {addonsCount > 0 || [rainGuttersAuto, gates.length > 0, manualSurcharges.length > 0].some(Boolean)
                ? `${addonsCount} szt.` + ([rainGuttersAuto, gates.length > 0, manualSurcharges.length > 0].filter(Boolean).length > 0 ? " · zaawansowane" : "")
                : "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <AddonsPanel
              addonOptions={addonOptions}
              selectedAddons={selectedAddons}
              onSelectedAddonsChange={(v) => setSelectedAddons(v)}
              rainGuttersAuto={rainGuttersAuto}
              onRainGuttersChange={actions.setRainGuttersAuto}
              sectionalGateAvailable={sectionalGateRow != null}
              gates={gates}
              onGatesChange={actions.setGates}
              gateUnitPricePerM2Default={sectionalGateUnitPricePerM2Default}
              plate80Available={!!plate80Row}
              plate100Available={!!plate100Row}
              plate80Selected={plate80}
              plate100Selected={plate100}
              onPlate80Change={actions.setPlate80}
              onPlate100Change={actions.setPlate100}
              heightSurchargeDisplay={heightSurchargeDisplay}
              manualSurcharges={manualSurcharges}
              onManualSurchargesChange={actions.setManualSurcharges}
              schedulePreviewRefresh={schedulePreviewRefresh}
              previewDebounceModeRef={previewDebounceModeRef}
            />
          </AccordionDetails>
        </Accordion>
        <Accordion defaultExpanded={false} sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Sprzedaż</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {salesPriceCaption}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <label style={styles.label}>Numer oferty</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
              {(draft as { syncingOfferNumber?: boolean }).syncingOfferNumber && (
                <span style={{ fontSize: 11, color: tokens.color.warning, marginRight: 4 }}>Rezerwuję numer…</span>
              )}
              {draft.offerNumberLocked && (
                <Tooltip title="Numer zablokowany po wygenerowaniu PDF">
                  <Lock fontSize="small" sx={{ color: "text.secondary", mr: -0.5 }} />
                </Tooltip>
              )}
              <input
                style={{ ...styles.input, marginBottom: 0, flex: 1 }}
                value={draft.offerNumber ?? ""}
                onChange={(e) => actions.setOfferNumber(e.target.value)}
                placeholder="np. PLX-E0001/2026"
                disabled={draft.offerNumberLocked}
              />
              <button
                onClick={async () => {
                  const current = draft.offerNumber?.trim();
                  if (!current) {
                    setAutoGenerating(true);
                    try {
                      let offerNumber: string | null = null;
                      if (typeof window.planlux?.invoke === "function") {
                        const res = (await api("planlux:getNextOfferNumber")) as { ok: boolean; offerNumber?: string };
                        if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
                      }
                      if (offerNumber) actions.setOfferNumber(offerNumber);
                      else showToast("Nie udało się wygenerować numeru. Spróbuj ponownie.");
                    } finally {
                      setAutoGenerating(false);
                    }
                  } else {
                    setOverwriteOfferNumberDialog(true);
                  }
                }}
                style={styles.buttonSecondary}
                disabled={draft.offerNumberLocked || autoGenerating}
              >
                {autoGenerating ? "..." : "Auto"}
              </button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => runSyncOfferNumber()}
                disabled={!draft.offerNumber?.startsWith("TEMP-") || draft.offerNumberLocked}
                sx={{ ml: 0.5 }}
              >
                Zsynchronizuj numer
              </Button>
              <IconButton
                size="small"
                title="Kopiuj numer"
                onClick={() => {
                  const num = draft.offerNumber?.trim();
                  if (num) {
                    navigator.clipboard.writeText(num).then(
                      () => showToast("Skopiowano do schowka"),
                      () => showToast("Nie udało się skopiować")
                    );
                  }
                }}
                disabled={!draft.offerNumber?.trim() || draft.offerNumberLocked}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </div>
            <Dialog open={overwriteOfferNumberDialog} onClose={() => setOverwriteOfferNumberDialog(false)}>
              <DialogTitle>
                {/^OF-\d{8}-/.test(draft.offerNumber ?? "") ? "Numer w starym formacie" : "Nadpisać istniejący numer?"}
              </DialogTitle>
              <DialogContent>
                <DialogContentText>
                  {/^OF-\d{8}-/.test(draft.offerNumber ?? "")
                    ? "Masz numer w starym formacie (OF-...). Zastąpić na nowy PLX-…?"
                    : "Numer oferty jest już ustawiony. Czy chcesz wygenerować nowy numer i nadpisać go?"}
                </DialogContentText>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setOverwriteOfferNumberDialog(false)}>Nie</Button>
                <Button
                  color="primary"
                  variant="contained"
                  onClick={async () => {
                    setOverwriteOfferNumberDialog(false);
                    let offerNumber: string | null = null;
                    if (typeof window.planlux?.invoke === "function") {
                      const res = (await api("planlux:getNextOfferNumber")) as { ok: boolean; offerNumber?: string };
                      if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
                    }
                    if (offerNumber) actions.setOfferNumber(offerNumber);
                    else showToast("Nie udało się wygenerować numeru. Spróbuj ponownie.");
                  }}
                >
                  Tak
                </Button>
              </DialogActions>
            </Dialog>
            <label style={styles.label}>Status</label>
            <select
              style={styles.input}
              value={draft.status ?? "DRAFT"}
              onChange={(e) => actions.setStatus(e.target.value as OfferStatus)}
            >
              <option value="DRAFT">DRAFT</option>
              <option value="READY_TO_SEND">READY_TO_SEND</option>
              <option value="SENT">SENT</option>
              <option value="ACCEPTED">ACCEPTED</option>
              <option value="REJECTED">REJECTED</option>
            </select>
            <label style={styles.label}>Notatka statusu</label>
            <input
              style={styles.input}
              value={draft.statusNote ?? ""}
              onChange={(e) => actions.setStatusNote(e.target.value)}
              placeholder="Opcjonalna notatka"
            />
            <button
              onClick={async () => {
                const pricing = result?.success
                  ? { totalPln: result.totalPln ?? 0, base: result.base, additions: (result as { additions?: unknown[] }).additions ?? [], standardInPrice: (result as { standardInPrice?: unknown[] }).standardInPrice ?? [] }
                  : { totalPln: 0 };
                const payload = buildPayloadFromDraft(userId, pricing, { sellerName: userDisplayName });
                actions.saveVersion(payload as unknown as Record<string, unknown>, draft.pdfOverrides ?? {});
                try {
                  await offerDraftStore.flushSave();
                  runSyncOfferNumber();
                } catch (e) {
                  console.error("[Kalkulator] flushSave po Zapisz wersję", e);
                }
              }}
              style={styles.buttonSecondary}
            >
              Zapisz wersję
            </button>
            {(draft.versions?.length ?? 0) > 0 && (
              <>
                <label style={styles.label}>Wersje</label>
                <div style={{ maxHeight: 120, overflow: "auto", marginBottom: 8 }}>
                  {[...(draft.versions ?? [])].reverse().slice(0, 10).map((v, i) => (
                    <div
                      key={i}
                      onClick={() => actions.restoreVersion(v)}
                      style={{ padding: "6px 8px", cursor: "pointer", fontSize: 12, borderBottom: `1px solid ${tokens.color.border}` }}
                    >
                      v{((draft.versions?.length ?? 0) - i)} – {new Date(v.timestamp).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" })}
                    </div>
                  ))}
                </div>
              </>
            )}
            {(draft.statusHistory?.length ?? 0) > 0 && (
              <>
                <label style={styles.label}>Timeline statusów</label>
                <div style={{ maxHeight: 80, overflow: "auto", fontSize: 11, color: tokens.color.textMuted }}>
                  {[...(draft.statusHistory ?? [])].reverse().slice(0, 5).map((h, i) => (
                    <div key={i}>
                      {h.status} – {new Date(h.timestamp).toLocaleString("pl-PL")} {h.note ? `(${h.note})` : ""}
                    </div>
                  ))}
                </div>
              </>
            )}
          </AccordionDetails>
        </Accordion>
        {/* 6. Edycja PDF */}
        <Accordion defaultExpanded={false} sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Edycja PDF</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {pdfEditCaption}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <EdycjaPdfSection
              pdfOverrides={draft.pdfOverrides}
              onPdfOverridesChange={(next) => actions.setPdfOverrides(mergePdfOverrides(next))}
              calculatorPriceNet={result?.success ? result.totalPln : undefined}
              calculatorPriceGross={result?.success ? (result.totalPln ?? 0) * 1.23 : undefined}
              onDirtyChange={(mode) => schedulePreviewRefresh(mode ?? "typing")}
              expanded={edycjaPdfExpanded}
              onExpandedChange={setEdycjaPdfExpanded}
              activeTab={edycjaPdfTab}
              onActiveTabChange={(t) => {
                setEdycjaPdfTab(t);
                setPdfPreviewPage((t + 1) as 1 | 2 | 3);
              }}
            />
          </AccordionDetails>
        </Accordion>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: tokens.space[4], minHeight: 0 }}>
        <div style={{ ...styles.card, marginBottom: 0, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Typography variant="h6" sx={{ m: 0 }}>Podsumowanie</Typography>
            <button onClick={syncPricing} disabled={syncing || !pricingData} style={styles.buttonSecondary}>
              {syncing ? "Sync..." : "Synchronizuj bazę"}
            </button>
          </div>
          {draft.offerNumber && (
            <p style={{ fontSize: tokens.font.size.sm, color: tokens.color.textMuted, marginBottom: 8 }}>
              Nr oferty: <strong style={{ color: tokens.color.text }}>{draft.offerNumber}</strong>
            </p>
          )}
          <p style={{ fontSize: tokens.font.size.sm, color: tokens.color.textMuted, marginBottom: 8 }}>
            Nazwa pliku PDF:{" "}
            <span style={{ fontFamily: "monospace", fontSize: 11 }}>
              {buildPdfFileName({
                sellerName: userDisplayName,
                clientCompany: clientName,
                offerNumber: draft.offerNumber ?? "—",
              })}
            </span>
          </p>
          {syncStatus === "offline" && pricingData?.version != null && (
            <p style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 8 }}>
              Offline – używam lokalnej bazy v{pricingData.version}
            </p>
          )}
          {syncStatus === "synced" && pricingData?.version != null && (
            <p style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 8 }}>
              Zsynchronizowano bazę v{pricingData.version}
              {pricingData.lastUpdated ? ` (${pricingData.lastUpdated})` : ""}
            </p>
          )}
          {syncStatus === "unchanged" && pricingData?.version != null && (
            <p style={{ fontSize: 12, color: tokens.color.textMuted, marginBottom: 8 }}>
              Zsynchronizowano bazę v{pricingData.version}
              {pricingData.lastUpdated ? ` (${pricingData.lastUpdated})` : ""}
            </p>
          )}
          {syncStatus === "error" && pricingData?.version != null && (
            <p style={{ fontSize: 12, color: tokens.color.warning, marginBottom: 8 }}>
              Błąd synchronizacji (ale aplikacja działa na lokalnej bazie v{pricingData.version})
            </p>
          )}
          {result?.success && (
            <>
              {result.base?.matched && result.base?.fallbackUsed && result.base?.fallbackInfo && (
                <div style={styles.diag}>
                  {result.base.fallbackReason === "AREA_ABOVE_MAX" &&
                    `Uwaga: powierzchnia przekracza zakres cennika. Zastosowano stawkę z najwyższego progu (do ${result.base.fallbackInfo.area_max_m2} m²).`}
                  {result.base.fallbackReason === "AREA_BELOW_MIN" &&
                    `Uwaga: powierzchnia jest poniżej zakresu cennika. Zastosowano stawkę z najniższego progu (od ${result.base.fallbackInfo.area_min_m2} m²).`}
                  {result.base.fallbackReason === "AREA_GAP" &&
                    `Uwaga: powierzchnia w lukach cennika. Zastosowano najbliższy próg (${result.base.fallbackInfo.area_min_m2}–${result.base.fallbackInfo.area_max_m2} m²).`}
                </div>
              )}
              {(result.base?.matched && (result.base.totalBase != null || (result.totalAdditions ?? 0) > 0)) && (
                <div style={{ fontSize: tokens.font.size.sm, color: tokens.color.textMuted, marginTop: 8 }}>
                  {result.base.totalBase != null && (
                    <div>Cena bazowa: {new Intl.NumberFormat("pl-PL").format(result.base.totalBase)} zł</div>
                  )}
                  {(result.totalAdditions ?? 0) > 0 && (
                    <div>Dodatki: {new Intl.NumberFormat("pl-PL").format(result.totalAdditions)} zł</div>
                  )}
                </div>
              )}
              <div style={{ fontSize: tokens.font.size.sm, color: tokens.color.textMuted, marginTop: 8 }}>
                <div style={{ fontWeight: tokens.font.weight.medium, marginBottom: 4 }}>W cenie standardowej:</div>
                {standardsIncluded.length === 0 ? (
                  <div>Brak wybranych standardów</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {standardsIncluded.map((s, i) => {
                      const isGutter =
                        normalizeName((s as { name?: string }).name) === "system rynnowy" &&
                        gutterStandard.pricingMode === "INCLUDED";
                      const label = formatStandardLabel((s as { name?: string }).name);
                      const detail = isGutter
                        ? `${gutterMb} mb, ${gutterStandard.sides === 1 ? "1 bok" : "2 boki"}, w cenie`
                        : "1 szt";
                      return (
                        <li key={i}>
                          {label} – {detail}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div style={{ fontSize: tokens.font.size.sm, color: tokens.color.textMuted, marginTop: 12 }}>
                <div style={{ fontWeight: tokens.font.weight.medium, marginBottom: 4 }}>Dodatki płatne:</div>
                {actualPaidAddons.length === 0 ? (
                  <div>Brak dodatków płatnych</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {actualPaidAddons.map((item, i) => {
                      const isHeightSurcharge = item.label === "Dopłata za wysokość";
                      if (isHeightSurcharge) {
                        return (
                          <li key={i}>
                            {item.label} – {item.quantity} mkw × {new Intl.NumberFormat("pl-PL").format(item.price)} zł ={" "}
                            {new Intl.NumberFormat("pl-PL").format(item.lineTotal)} zł
                          </li>
                        );
                      }
                      return (
                        <li key={i}>
                          {item.label} – {item.quantity} {item.unit} – {new Intl.NumberFormat("pl-PL").format(item.lineTotal)} zł
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <p style={styles.total}>{new Intl.NumberFormat("pl-PL").format(result.totalPln ?? 0)} zł netto</p>
            </>
          )}
          {result && !result.success && (
            <div style={styles.diag}>{result.errorMessage ?? "Brak dopasowania ceny"}</div>
          )}
          {!pricingData && (
            <p style={{ color: tokens.color.textMuted }}>Brak bazy cennika. Kliknij „Synchronizuj bazę” (wymaga internetu).</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            <button onClick={generatePdf} disabled={generating || !result?.success} style={styles.button} data-testid="offer-generate-pdf">
              {generating ? "Generowanie..." : "Generuj PDF"}
            </button>
            {(generating || hasGeneratedPdf || pdfStatusMessage) && (
              <span data-testid="pdf-status">
                {generating && "Generowanie..."}
                {hasGeneratedPdf && !generating && (
                  <>
                    Wygenerowano{" "}
                    <button
                    onClick={() => api("shell:openPath", lastPdfPath!)}
                    style={styles.buttonSecondary}
                  >
                    Otwórz PDF
                  </button>
                  <button
                    onClick={() => api("shell:showItemInFolder", lastPdfPath!)}
                    style={styles.buttonSecondary}
                  >
                    Otwórz folder
                  </button>
                  {draft.draftId && (
                    <button
                      data-testid="offer-send-email"
                      onClick={async () => {
                      setEmailComposerOpen(true);
                      const prev = (await api("planlux:email:getOfferEmailPreview", draft.draftId)) as {
                        ok: boolean;
                        subject?: string;
                        bodyHtml?: string;
                        bodyText?: string;
                        officeCcDefault?: boolean;
                        officeCcEmail?: string;
                      };
                      if (prev.ok) {
                        setEmailPreview({
                          subject: prev.subject ?? `Oferta Planlux – ${draft.offerNumber ?? ""}`,
                          body: (prev.bodyText ?? prev.bodyHtml ?? "").replace(/<[^>]+>/g, "\n"),
                          officeCcDefault: prev.officeCcDefault ?? true,
                          officeCcEmail: prev.officeCcEmail ?? "biuro@planlux.pl",
                        });
                      } else {
                        setEmailPreview({
                          subject: `Oferta Planlux – ${draft.offerNumber ?? ""}`,
                          body: `Szanowni Państwo,\n\nW załączeniu przesyłam ofertę ${draft.offerNumber ?? ""}.\n\nPozdrawiam`,
                          officeCcDefault: true,
                          officeCcEmail: "biuro@planlux.pl",
                        });
                      }
                    }}
                    style={styles.buttonSecondary}
                  >
                    Wyślij e-mail
                  </button>
                  )}
                  </>
                )}
                {pdfStatusMessage && !generating && !hasGeneratedPdf && pdfStatusMessage}
              </span>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 480 }}>
          <KalkulatorPdfPreview
            previewPdfBase64={previewPdfBase64}
            error={previewError}
            activePage={pdfPreviewPage}
            onActivePageChange={handleActivePageChange}
            hasEnoughData={hasEnoughDataForPreview}
          />
        </div>
      </div>
      <DuplicateOffersModal
        open={duplicateModal.open}
        duplicates={duplicateModal.duplicates}
        onContinue={async () => {
          setDuplicateModal({ open: false, duplicates: [] });
          setGenerating(true);
          try {
            if (pendingPdfGenerateRef.current) await pendingPdfGenerateRef.current();
          } finally {
            setGenerating(false);
          }
        }}
        onOpenOffer={(id) => {
          setDuplicateModal({ open: false, duplicates: [] });
          pendingPdfGenerateRef.current = null;
          onOpenOffer?.(id);
        }}
        onCancel={() => {
          setDuplicateModal({ open: false, duplicates: [] });
          pendingPdfGenerateRef.current = null;
        }}
      />
      <EmailComposer
        open={emailComposerOpen}
        onClose={() => setEmailComposerOpen(false)}
        defaultTo={clientEmail ?? ""}
        defaultSubject={emailPreview?.subject ?? `Oferta Planlux – ${draft.offerNumber ?? ""}`}
        defaultBody={emailPreview?.body ?? `Szanowni Państwo,\n\nW załączeniu przesyłam ofertę ${draft.offerNumber ?? ""}.\n\nPozdrawiam`}
        officeCcDefault={emailPreview?.officeCcDefault ?? true}
        officeCcEmail={emailPreview?.officeCcEmail ?? "biuro@planlux.pl"}
        pdfPath={lastPdfPath}
        pdfFileName={lastPdfFileName ?? undefined}
        onSend={async (p) => {
          const res = (await api("planlux:email:sendOfferEmail", {
            offerId: draft.draftId,
            to: p.to,
            ccOfficeEnabled: p.ccOfficeEnabled,
            subjectOverride: p.subject || undefined,
            bodyOverride: p.body ? p.body.replace(/\n/g, "<br>") : undefined,
          })) as {
            ok: boolean;
            sent?: boolean;
            queued?: boolean;
            error?: string;
            code?: string;
            message?: string;
            sheetsError?: { code?: string; message: string; details?: unknown };
          };
          if (res.ok) showToast(res.queued ? "E-mail dodany do kolejki." : "E-mail wysłany.");
          const messageByCode: Record<string, string> = {
            ERR_NO_TO: "Podaj adres e-mail odbiorcy.",
            ERR_NO_USER: "Brak użytkownika (user_id) – nie można zapisać historii e-mail.",
            ERR_NO_ATTACHMENT: "Brak załącznika PDF. Wygeneruj PDF oferty przed wysłaniem.",
            ERR_AUTH: "Błąd autoryzacji SMTP. Sprawdź ustawienia konta e-mail w Panelu admina.",
            ERR_TIMEOUT: "Przekroczono limit czasu połączenia. Sprawdź internet i spróbuj ponownie.",
            ERR_HISTORY_WRITE: "E-mail został wysłany, ale nie zapisano go w historii. Sprawdź logi i bazę.",
          };
          const friendlyError = !res.ok
            ? ((res as { message?: string }).message ?? (res.code && messageByCode[res.code] ? messageByCode[res.code] : res.error))
            : undefined;
          return { ...res, error: friendlyError };
        }}
      />
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            background: tokens.color.navy,
            color: tokens.color.white,
            padding: "12px 20px",
            borderRadius: tokens.radius.md,
            boxShadow: tokens.shadow.lg,
            zIndex: 9999,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
