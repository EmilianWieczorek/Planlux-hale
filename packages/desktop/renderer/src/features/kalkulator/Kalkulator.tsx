import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useOfferDraft } from "../../state/useOfferDraft";
import { buildPayloadFromDraft, offerDraftStore, requestSyncTempNumbers, type OfferStatus } from "../../state/offerDraftStore";
import { buildPdfFileName as buildPdfFileNameFromShared } from "@planlux/shared";

/** Bezpieczne wywołanie – fallback gdy import nie zadziała (np. cache Vite). */
const buildPdfFileName =
  typeof buildPdfFileNameFromShared === "function"
    ? buildPdfFileNameFromShared
    : (params: { sellerName?: string; clientCompany?: string; offerNumber: string }) =>
        `PLANLUX-Oferta-${params.clientCompany || params.sellerName || "Handlowiec"}-${(params.offerNumber || "—").replace(/\//g, "-")}.pdf`;
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
  const clientName = draft.clientName;
  const clientEmail = draft.clientEmail;
  const clientNip = draft.clientNip;
  const clientPhone = draft.clientPhone;
  const variantHali = draft.variantHali;
  const widthM = draft.widthM;
  const lengthM = draft.lengthM;
  const heightM = draft.heightM;
  const addons = draft.addons;
  const standardSnapshot = draft.standardSnapshot ?? [];
  const rainGuttersAuto = draft.rainGuttersAuto ?? false;
  const gates = draft.gates ?? [];
  const heightSurchargeAuto = draft.heightSurchargeAuto ?? false;
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
  const [toast, setToast] = useState<string | null>(null);
  const [previewPdfBase64, setPreviewPdfBase64] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pdfPreviewPage, setPdfPreviewPage] = useState<1 | 2 | 3>(1);
  const [edycjaPdfExpanded, setEdycjaPdfExpanded] = useState(false);
  const [edycjaPdfTab, setEdycjaPdfTab] = useState<0 | 1 | 2>(0);
  const [overwriteOfferNumberDialog, setOverwriteOfferNumberDialog] = useState(false);
  const [autoGenerating, setAutoGenerating] = useState(false);
  const [duplicateModal, setDuplicateModal] = useState<{ open: boolean; duplicates: DuplicateOffer[] }>({ open: false, duplicates: [] });
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
    const r = (await api("planlux:getPricingCache")) as {
      ok: boolean;
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
    const hasData = clientName.trim().length > 0 && w > 0 && l > 0;
    if (!hasData || draft.offerNumber || draft.offerNumberLocked || createOfferRequestedRef.current) return;
    const invoke = (window as unknown as { planlux?: { invoke?: (c: string, ...a: unknown[]) => Promise<unknown> } }).planlux?.invoke;
    if (!invoke) return;
    createOfferRequestedRef.current = true;
    invoke("planlux:createOffer", userId, { clientName: clientName.trim(), widthM: w, lengthM: l })
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
  }, [clientName, widthM, lengthM, draft.offerNumber, draft.offerNumberLocked, userId, actions]);

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

  const recalcInputRef = useRef({ addons, standardSnapshot, gates, manualSurcharges });
  recalcInputRef.current = { addons, standardSnapshot, gates, manualSurcharges };

  const recalc = useCallback(async () => {
    const { addons: a, standardSnapshot: s, gates: g, manualSurcharges: m } = recalcInputRef.current;
    const w = parseFloat(widthM) || 0;
    const l = parseFloat(lengthM) || 0;
    const h = heightM ? parseFloat(heightM) : undefined;
    if (w <= 0 || l <= 0) {
      setResult(null);
      return;
    }
    try {
      const r = (await api("planlux:calculatePrice", {
        variantHali,
        widthM: w,
        lengthM: l,
        heightM: h,
        selectedAdditions: a,
        standardSnapshot: s,
        rainGuttersAuto,
        gates: g,
        heightSurchargeAuto,
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
  }, [api, variantHali, widthM, lengthM, heightM, rainGuttersAuto, heightSurchargeAuto]);

  const recalcTrigger = useMemo(
    () => JSON.stringify(addons) + JSON.stringify(standardSnapshot) + JSON.stringify(gates) + JSON.stringify(manualSurcharges),
    [addons, standardSnapshot, gates, manualSurcharges]
  );

  useEffect(() => {
    recalc();
  }, [recalc, recalcTrigger]);

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

  const availableAddons = (pricingData?.dodatki as Array<{ wariant_hali: string; nazwa: string }>)?.filter(
    (d) => d.wariant_hali === variantHali
  ) ?? [];
  const groupedAddons = [...new Set(availableAddons.map((a) => a.nazwa))];

  const heightSurchargeThreshold = (() => {
    const dodatki = pricingData?.dodatki as Array<{ wariant_hali: string; nazwa: string; warunek_min?: number | string }> | undefined;
    if (!Array.isArray(dodatki)) return undefined;
    const doplata = dodatki.find(
      (d) => d.wariant_hali === variantHali && /dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(d.nazwa)
    );
    if (!doplata?.warunek_min) return undefined;
    const v = typeof doplata.warunek_min === "number" ? doplata.warunek_min : parseFloat(String(doplata.warunek_min));
    return Number.isFinite(v) ? v : undefined;
  })();

  const toggleAddon = (nazwa: string, ilosc: number) => {
    if (ilosc <= 0) actions.setAddons(addons.filter((x) => x.nazwa !== nazwa));
    else {
      const idx = addons.findIndex((x) => x.nazwa === nazwa);
      if (idx >= 0) {
        const next = [...addons];
        next[idx] = { nazwa, ilosc };
        actions.setAddons(next);
      } else actions.setAddons([...addons, { nazwa, ilosc }]);
    }
  };

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
        selectedAdditions: addons,
        standardSnapshot,
        rainGuttersAuto,
        gates,
        heightSurchargeAuto,
        manualSurcharges,
      })) as { ok: boolean; result?: { totalPln?: number; base?: unknown; additions?: unknown[]; standardInPrice?: unknown[] } };
      if (token !== previewTokenRef.current) return;
      const pricing = r?.ok && r.result
        ? { totalPln: r.result.totalPln ?? 210_000, base: r.result.base, additions: r.result.additions ?? [], standardInPrice: r.result.standardInPrice ?? [] }
        : { totalPln: 210_000, base: {}, additions: [] as unknown[], standardInPrice: [] as unknown[] };
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
  }, [api, userId, userDisplayName, variantHali, widthM, lengthM, heightM, addons, standardSnapshot, rainGuttersAuto, gates, heightSurchargeAuto, manualSurcharges, draft.pdfOverrides, actions]);

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
  }, [variantHali, widthM, lengthM, heightM, addons, standardSnapshot, rainGuttersAuto, gates, heightSurchargeAuto, manualSurcharges, draft.pdfOverrides, draft.offerNumber, schedulePreviewRefresh]);

  useEffect(() => () => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    previewTokenRef.current += 1;
  }, []);

  const handleActivePageChange = useCallback((page: 1 | 2 | 3) => {
    setPdfPreviewPage(page);
    if (edycjaPdfExpandedRef.current) setEdycjaPdfTab((page - 1) as 0 | 1 | 2);
  }, []);

  const doGeneratePdf = async () => {
    if (!result?.success || !clientName.trim()) return;
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
      selectedAdditions: addons,
      standardSnapshot,
      rainGuttersAuto,
      gates,
      heightSurchargeAuto,
      manualSurcharges,
    })) as { ok: boolean; result?: { base?: { matched?: boolean }; additions?: unknown[]; standardInPrice?: unknown[]; totalPln?: number } };
    if (!r.ok || !r.result) throw new Error("Błąd wyceny");
    let offerNumber = draft.offerNumber?.trim();
    if (!offerNumber) {
      if (typeof window.planlux?.invoke === "function") {
        const res = (await api("planlux:getNextOfferNumber", userId)) as { ok: boolean; offerNumber?: string };
        if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
      }
      if (!offerNumber && typeof localStorage !== "undefined") {
        const initial = (userDisplayName?.trim().split(/\s+/)[0]?.[0] ?? "X").toUpperCase().replace(/[^A-Z]/, "X") || "X";
        const year = new Date().getFullYear();
        const key = `offerCounter:PLX-${initial}:${year}`;
        const nextSeq = parseInt(localStorage.getItem(key) ?? "1", 10);
        localStorage.setItem(key, String(nextSeq + 1));
        offerNumber = `PLX-${initial}${String(nextSeq).padStart(4, "0")}/${year}`;
      }
      if (!offerNumber) throw new Error("Nie udało się wygenerować numeru oferty. Spróbuj ponownie.");
      actions.setOfferNumber(offerNumber);
    }
    const payload = {
      userId,
      sellerName: userDisplayName?.trim() || "Planlux",
      offer: {
        clientName,
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
    const pdfRes = (await api("pdf:generate", payload, undefined, undefined, draft.pdfOverrides && Object.keys(draft.pdfOverrides).length > 0 ? draft.pdfOverrides : undefined)) as { ok: boolean; pdfId?: string; filePath?: string; fileName?: string; error?: string };
    if (pdfRes.ok) {
      if (pdfRes.filePath) setLastPdfPath(pdfRes.filePath);
      showToast(`PDF zapisany: ${pdfRes.fileName ?? ""}`);
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
      const err = (pdfRes as { error?: string }).error;
      const msg = err && err.length > 0 ? (err.length > 120 ? err.slice(0, 117) + "…" : err) : "Nie udało się wygenerować PDF. Spróbuj ponownie.";
      showToast(msg);
    }
  };

  const generatePdf = async () => {
    if (!result?.success || !clientName.trim()) {
      showToast("Uzupełnij klienta i upewnij się, że wycena jest poprawna");
      return;
    }
    setGenerating(true);
    try {
      const dupRes = (await api("planlux:findDuplicateOffers", userId, {
        clientName,
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
      const msg = e instanceof Error ? e.message : "Błąd generowania PDF";
      showToast(msg.length > 120 ? msg.slice(0, 117) + "…" : msg);
    } finally {
      setGenerating(false);
    }
  };

  const dimensionsPreview = [widthM, lengthM].filter(Boolean).join(" × ");
  const addonsCount = addons.reduce((s, a) => s + a.ilosc, 0);

  return (
    <div style={styles.grid}>
      <div style={{ overflow: "auto", minHeight: 0 }}>
        <Accordion defaultExpanded={false} sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Klient</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {clientName || "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <label style={styles.label}>Nazwa firmy / Imię i nazwisko</label>
            <input style={styles.input} value={clientName} onChange={(e) => actions.setClientName(e.target.value)} placeholder="np. Firma ABC Sp. z o.o." />
            <label style={styles.label}>NIP</label>
            <input style={styles.input} value={clientNip} onChange={(e) => actions.setClientNip(e.target.value)} placeholder="np. 123-456-78-90" />
            <label style={styles.label}>E-mail</label>
            <input style={styles.input} type="email" value={clientEmail} onChange={(e) => actions.setClientEmail(e.target.value)} placeholder="klient@firma.pl" />
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
            <select style={styles.input} value={variantHali} onChange={(e) => { previewDebounceModeRef.current = "commit"; actions.setVariantHali(e.target.value); actions.setAddons([]); actions.setStandardSnapshot([]); }}>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <div style={styles.row}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Szerokość (m)</label>
                <input style={styles.input} type="number" min={1} step={0.1} value={widthM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setWidthM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Długość (m)</label>
                <input style={styles.input} type="number" min={1} step={0.1} value={lengthM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setLengthM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} />
              </div>
            </div>
            <label style={styles.label}>Wysokość (m) – opcjonalnie</label>
            <input style={styles.input} type="number" min={0} step={0.01} value={heightM} onChange={(e) => { previewDebounceModeRef.current = "typing"; actions.setHeightM(e.target.value); }} onBlur={() => schedulePreviewRefresh("commit")} placeholder="np. 5.5" />
          </AccordionDetails>
        </Accordion>
        <Accordion defaultExpanded sx={{ "&:before": { display: "none" } }}>
          <AccordionSummary expandIcon={<span style={{ fontSize: 20 }}>▼</span>}>
            <Typography variant="subtitle2">Dodatki</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
              {addonsCount > 0 || [rainGuttersAuto, gates.length > 0, heightSurchargeAuto, manualSurcharges.length > 0].some(Boolean)
                ? `${addonsCount} szt.` + ([rainGuttersAuto, gates.length > 0, heightSurchargeAuto, manualSurcharges.length > 0].filter(Boolean).length > 0 ? " · zaawansowane" : "")
                : "—"}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <AddonsPanel
              groupedAddons={groupedAddons}
              addons={addons}
              toggleAddon={toggleAddon}
              standardInPrice={((result as { standardInPrice?: Array<{ element: string; ilosc: number; jednostka: string; wartoscRef: number; pricingMode?: string; total?: number }> })?.standardInPrice ?? [])}
              standardSnapshot={standardSnapshot}
              onStandardModeChange={(element, mode) => {
                const next = standardSnapshot.filter((sn) => sn.element !== element);
                next.push({ element, pricingMode: mode });
                actions.setStandardSnapshot(next);
              }}
              rainGuttersAuto={rainGuttersAuto}
              onRainGuttersChange={actions.setRainGuttersAuto}
              gates={gates}
              onGatesChange={actions.setGates}
              heightSurchargeAuto={heightSurchargeAuto}
              onHeightSurchargeChange={actions.setHeightSurchargeAuto}
              heightM={heightM}
              heightSurchargeThreshold={heightSurchargeThreshold}
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
              {draft.offerNumber || "—"}
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
                        const res = (await api("planlux:getNextOfferNumber", userId)) as { ok: boolean; offerNumber?: string };
                        if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
                      }
                      if (!offerNumber && typeof localStorage !== "undefined") {
                        const initial = (userDisplayName?.trim().split(/\s+/)[0]?.[0] ?? "X").toUpperCase().replace(/[^A-Z]/, "X") || "X";
                        const year = new Date().getFullYear();
                        const key = `offerCounter:PLX-${initial}:${year}`;
                        const nextSeq = parseInt(localStorage.getItem(key) ?? "1", 10);
                        localStorage.setItem(key, String(nextSeq + 1));
                        offerNumber = `PLX-${initial}${String(nextSeq).padStart(4, "0")}/${year}`;
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
                      const res = (await api("planlux:getNextOfferNumber", userId)) as { ok: boolean; offerNumber?: string };
                      if (res?.ok && res.offerNumber) offerNumber = res.offerNumber;
                    }
                    if (!offerNumber && typeof localStorage !== "undefined") {
                      const initial = (userDisplayName?.trim().split(/\s+/)[0]?.[0] ?? "X").toUpperCase().replace(/[^A-Z]/, "X") || "X";
                      const year = new Date().getFullYear();
                      const key = `offerCounter:PLX-${initial}:${year}`;
                      const nextSeq = parseInt(localStorage.getItem(key) ?? "1", 10);
                      localStorage.setItem(key, String(nextSeq + 1));
                      offerNumber = `PLX-${initial}${String(nextSeq).padStart(4, "0")}/${year}`;
                    }
                    if (offerNumber) actions.setOfferNumber(offerNumber);
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
            <button onClick={generatePdf} disabled={generating || !result?.success} style={styles.button}>
              {generating ? "Generowanie..." : "Generuj PDF"}
            </button>
            {lastPdfPath && (
              <>
                <button
                  onClick={() => api("shell:openPath", lastPdfPath)}
                  style={styles.buttonSecondary}
                >
                  Otwórz PDF
                </button>
                <button
                  onClick={() => api("shell:showItemInFolder", lastPdfPath)}
                  style={styles.buttonSecondary}
                >
                  Otwórz folder
                </button>
              </>
            )}
            <button style={styles.buttonSecondary} disabled>
              Wyślij e-mail (wkrótce)
            </button>
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
