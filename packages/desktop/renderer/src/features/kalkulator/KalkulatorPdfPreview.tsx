import { useEffect, useRef, useState, useCallback } from "react";
import { Box, Paper, Typography, Button, Chip } from "@mui/material";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface KalkulatorPdfPreviewProps {
  previewPdfBase64?: string | null;
  error?: string | null;
  /** Czy dane są kompletne do generowania (variant + wymiary) */
  hasEnoughData?: boolean;
  /** Tryb jednej strony: activePage 1|2|3 */
  singlePageMode?: boolean;
  /** Sync: gdy użytkownik przełącza stronę w preview */
  onActivePageChange?: (page: 1 | 2 | 3) => void;
  /** Kontrolowany activePage z zewnątrz (opcjonalnie) */
  activePage?: 1 | 2 | 3;
}

const PADDING = 16;
const PDF_PAGE_WIDTH = 595;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 1.8;
const FIT_CLAMP_MIN = 1.05;
const FIT_CLAMP_MAX = 1.45;
const DPR_MAX = 2;
const QUALITY = 2;
const RESIZE_DEBOUNCE_MS = 150;
const ZOOM_DEBOUNCE_MS = 100;
const BG_COLOR = "#f5f6f8";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getFitScale(containerWidth: number): number {
  const availableWidth = containerWidth - 2 * PADDING;
  if (availableWidth <= 0) return 1;
  return clamp(availableWidth / PDF_PAGE_WIDTH, FIT_CLAMP_MIN, FIT_CLAMP_MAX);
}

interface PdfPageWithOverlayProps {
  pdfDoc: PDFDocumentProxy | null;
  pageNum: number;
  containerWidth: number;
  zoom: number;
  pageRef: (pageNum: number, el: HTMLDivElement | null) => void;
  onRenderError?: (msg: string) => void;
}

function PdfPageWithOverlay({
  pdfDoc,
  pageNum,
  containerWidth,
  zoom,
  pageRef,
  onRenderError,
}: PdfPageWithOverlayProps) {
  const canvasARef = useRef<HTMLCanvasElement | null>(null);
  const canvasBRef = useRef<HTMLCanvasElement | null>(null);
  const visibleRef = useRef<"A" | "B">("A");
  const [, forceUpdate] = useState(0);
  const renderTokenRef = useRef(0);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const availableWidth = containerWidth - 2 * PADDING;
    if (!pdfDoc || containerWidth <= 0 || availableWidth <= 0 || zoom <= 0) return;
    const token = ++renderTokenRef.current;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    const getCanvas = () => (visibleRef.current === "A" ? canvasBRef.current : canvasARef.current);

    (async () => {
      let page;
      try {
        page = await pdfDoc.getPage(pageNum);
      } catch (e) {
        if (token !== renderTokenRef.current) return;
        onRenderError?.(`Nie udało się załadować strony ${pageNum}`);
        return;
      }
      if (token !== renderTokenRef.current) return;

      const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
      const displayScale = zoom;
      const renderScale = displayScale * dpr * QUALITY;
      const viewportDisplay = page.getViewport({ scale: displayScale });
      const viewportRender = page.getViewport({ scale: renderScale });
      if (token !== renderTokenRef.current) return;

      const canvas = getCanvas();
      if (!canvas || token !== renderTokenRef.current) return;

      setViewport({ width: viewportDisplay.width, height: viewportDisplay.height });
      canvas.width = Math.floor(viewportRender.width);
      canvas.height = Math.floor(viewportRender.height);
      canvas.style.width = `${Math.floor(viewportDisplay.width)}px`;
      canvas.style.height = `${Math.floor(viewportDisplay.height)}px`;

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx || token !== renderTokenRef.current) return;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      try {
        const renderTask = page.render({ canvasContext: ctx, viewport: viewportRender });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (e) {
        if (token !== renderTokenRef.current) return;
        const err = e as { name?: string };
        if (err?.name === "RenderingCancelledException") return;
        try {
          const { RenderingCancelledException } = await import("pdfjs-dist");
          if (e instanceof RenderingCancelledException) return;
        } catch {
          /* ignore */
        }
        onRenderError?.("Nie udało się wyrenderować strony");
        return;
      } finally {
        if (renderTaskRef.current) {
          renderTaskRef.current = null;
        }
      }
      if (token !== renderTokenRef.current) return;
      visibleRef.current = visibleRef.current === "A" ? "B" : "A";
      forceUpdate((n) => n + 1);
    })();
    return () => {
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [pdfDoc, pageNum, containerWidth, zoom, onRenderError]);

  const pageLabel = pageNum <= 2 ? `Strona ${pageNum}` : `Strona ${pageNum} (zablokowana)`;
  const showA = visibleRef.current === "A";

  return (
    <Box
      ref={(el) => pageRef(pageNum, el)}
      sx={{
        position: "relative",
        display: "inline-block",
        mx: "auto",
        mb: 2,
        boxShadow: "none",
        border: "1px solid rgba(0,0,0,0.10)",
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: "white",
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5, textAlign: "center" }}>
        {pageLabel}
      </Typography>
      <Box sx={{ position: "relative", overflow: "hidden", borderRadius: 1, width: viewport?.width, height: viewport?.height }}>
        <canvas
          ref={canvasARef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            display: "block",
            width: viewport ? `${viewport.width}px` : undefined,
            height: viewport ? `${viewport.height}px` : undefined,
            visibility: showA ? "visible" : "hidden",
          }}
        />
        <canvas
          ref={canvasBRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            display: "block",
            width: viewport ? `${viewport.width}px` : undefined,
            height: viewport ? `${viewport.height}px` : undefined,
            visibility: showA ? "hidden" : "visible",
          }}
        />
      </Box>
    </Box>
  );
}

export function KalkulatorPdfPreview({
  previewPdfBase64,
  error = null,
  hasEnoughData = true,
  singlePageMode = true,
  onActivePageChange,
  activePage: controlledActivePage,
}: KalkulatorPdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(400);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pageRenderError, setPageRenderError] = useState<string | null>(null);
  const [internalActivePage, setInternalActivePage] = useState<1 | 2 | 3>(1);
  const activePage = controlledActivePage ?? internalActivePage;
  const [zoom, setZoomState] = useState(1);
  const [zoomDebounced, setZoomDebounced] = useState(1);
  const initialFitDoneRef = useRef(false);

  const pageRefCallback = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(pageNum, el);
    else pageRefs.current.delete(pageNum);
  }, []);

  const setPage = useCallback(
    (p: 1 | 2 | 3) => {
      if (controlledActivePage == null) setInternalActivePage(p);
      onActivePageChange?.(p);
    },
    [controlledActivePage, onActivePageChange]
  );

  const goPrev = useCallback(() => {
    const next = (activePage <= 1 ? 1 : (activePage - 1)) as 1 | 2 | 3;
    setPage(next);
  }, [activePage, setPage]);
  const goNext = useCallback(() => {
    const next = (activePage >= 3 ? 3 : (activePage + 1)) as 1 | 2 | 3;
    setPage(next);
  }, [activePage, setPage]);

  const handleZoomMinus = useCallback(() => setZoomState((z) => clamp(z - 0.15, ZOOM_MIN, ZOOM_MAX)), []);
  const handleZoom100 = useCallback(() => setZoomState(1), []);
  const handleZoomPlus = useCallback(() => setZoomState((z) => clamp(z + 0.15, ZOOM_MIN, ZOOM_MAX)), []);
  const handleZoomFit = useCallback(() => {
    const fit = getFitScale(containerWidth);
    setZoomState(clamp(fit, ZOOM_MIN, ZOOM_MAX));
  }, [containerWidth]);

  useEffect(() => {
    if (!initialFitDoneRef.current && containerWidth > 0 && previewPdfBase64) {
      initialFitDoneRef.current = true;
      setZoomState(getFitScale(containerWidth));
    }
  }, [containerWidth, previewPdfBase64]);

  useEffect(() => {
    const t = setTimeout(() => setZoomDebounced(zoom), ZOOM_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [zoom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const updateWidth = (w: number) => {
      if (w > 0) setContainerWidth(w);
    };
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        if (w > 0) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            updateWidth(w);
          }, RESIZE_DEBOUNCE_MS);
        }
      }
    });
    ro.observe(el);
    updateWidth(el.clientWidth || 400);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      ro.disconnect();
    };
  }, [previewPdfBase64]);

  const [blobFallbackUrl, setBlobFallbackUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!previewPdfBase64) {
      setPdfDoc(null);
      setNumPages(0);
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setBlobFallbackUrl(null);
      initialFitDoneRef.current = false;
      return;
    }
    setRenderError(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobFallbackUrl(null);
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        try {
          const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs?url");
          const workerUrl =
            typeof workerModule.default === "string"
              ? workerModule.default
              : (workerModule as { default: string }).default;
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        } catch {
          if (import.meta.env.DEV) {
            console.warn("[KalkulatorPdfPreview] pdfjs worker nie załadowany");
          }
        }
        const uint8 = new Uint8Array(
          atob(previewPdfBase64)
            .split("")
            .map((c) => c.charCodeAt(0))
        );
        const loadingTask = pdfjsLib.getDocument({ data: uint8 });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        setNumPages(pdf.numPages);
        setPdfDoc(pdf);
      } catch (e) {
        if (!cancelled) {
          const errMsg = e instanceof Error ? e.message : String(e);
          setRenderError(errMsg);
          if (import.meta.env.DEV) {
            console.error("[KalkulatorPdfPreview] pdfjs load failed, fallback do iframe", e);
          }
          try {
            const bytes = Uint8Array.from(atob(previewPdfBase64), (c) => c.charCodeAt(0));
            const blob = new Blob([bytes], { type: "application/pdf" });
            const url = URL.createObjectURL(blob);
            if (!cancelled) {
              blobUrlRef.current = url;
              setBlobFallbackUrl(url);
            } else {
              URL.revokeObjectURL(url);
            }
          } catch (blobErr) {
            if (!cancelled) setRenderError(`${errMsg} (blob: ${blobErr instanceof Error ? blobErr.message : String(blobErr)})`);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setBlobFallbackUrl(null);
    };
  }, [previewPdfBase64]);

  const handleRenderError = useCallback((msg: string) => setPageRenderError(msg), []);

  useEffect(() => {
    setPageRenderError(null);
  }, [activePage, pdfDoc]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleZoom100();
      } else if ((e.key === "=" || e.key === "+") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleZoomPlus();
      } else if ((e.key === "-" || e.key === "_") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleZoomMinus();
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [goPrev, goNext, handleZoom100, handleZoomPlus, handleZoomMinus]);

  const panelSx = {
    height: "100%",
    minHeight: 480,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    bgcolor: BG_COLOR,
  } as const;

  if (error) {
    return (
      <Paper variant="outlined" sx={panelSx}>
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, p: 3 }}>
          <Typography variant="body2" color="error">{error}</Typography>
          <Typography variant="caption" color="text.secondary">Nie udało się załadować PDF. Sprawdź konsolę (F12) lub spróbuj wygenerować ofertę ponownie.</Typography>
        </Box>
      </Paper>
    );
  }

  const hasPreview = Boolean(previewPdfBase64);

  if (!hasPreview) {
    return (
      <Paper variant="outlined" sx={panelSx}>
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, p: 3 }}>
          <Typography variant="body2" color="text.secondary">Podgląd PDF</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center" }}>
            {hasEnoughData ? "Brak PDF — wygeneruj ofertę (podgląd pojawi się automatycznie po uzupełnieniu wymiarów)." : "Uzupełnij dane (wariant, wymiary), aby wygenerować podgląd PDF."}
          </Typography>
        </Box>
      </Paper>
    );
  }

  const pagesToRender = singlePageMode ? [activePage] : Array.from({ length: numPages }, (_, i) => i + 1);

  if (blobFallbackUrl) {
    return (
      <Paper ref={panelRef} variant="outlined" sx={panelSx} tabIndex={0}>
        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary">Podgląd PDF (tryb iframe)</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 480, overflow: "hidden" }}>
          <iframe
            src={blobFallbackUrl}
            title="Podgląd PDF"
            style={{ width: "100%", height: "100%", minHeight: 480, border: "none" }}
          />
        </Box>
      </Paper>
    );
  }

  return (
    <Paper ref={panelRef} variant="outlined" sx={{ ...panelSx, bgcolor: BG_COLOR }} tabIndex={0}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
        <Button size="small" onClick={goPrev} disabled={activePage <= 1} sx={{ minWidth: 32 }}>◀</Button>
        <Button size="small" onClick={goNext} disabled={activePage >= 3} sx={{ minWidth: 32 }}>▶</Button>
        {[1, 2, 3].map((p) => (
          <Chip
            key={p}
            size="small"
            label={p === 3 ? "3 (zablokowana)" : p}
            onClick={() => setPage(p as 1 | 2 | 3)}
            color={activePage === p ? "primary" : "default"}
            sx={{ cursor: "pointer", fontSize: "0.75rem" }}
          />
        ))}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          Strona {activePage} / 3
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          Zoom:
        </Typography>
        <Button size="small" onClick={handleZoomMinus} sx={{ minWidth: 28 }}>–</Button>
        <Button size="small" onClick={handleZoom100} sx={{ minWidth: 40 }}>100%</Button>
        <Button size="small" onClick={handleZoomPlus} sx={{ minWidth: 28 }}>+</Button>
        <Button size="small" onClick={handleZoomFit} sx={{ minWidth: 60 }}>Dopasuj</Button>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {Math.round(zoom * 100)}%
        </Typography>
        <Box sx={{ flex: 1 }} />
      </Box>
      {(renderError || pageRenderError) && (
        <Box sx={{ p: 2, bgcolor: "error.light", color: "error.contrastText" }}>
          <Typography variant="body2">{pageRenderError ?? renderError}</Typography>
        </Box>
      )}
      <Box
        ref={containerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          p: 1.5,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
        }}
      >
        {pagesToRender.map((pageNum) => (
          <PdfPageWithOverlay
            key={pageNum}
            pdfDoc={pdfDoc}
            pageNum={pageNum}
            containerWidth={containerWidth}
            zoom={zoomDebounced}
            pageRef={pageRefCallback}
            onRenderError={handleRenderError}
          />
        ))}
      </Box>
    </Paper>
  );
}
