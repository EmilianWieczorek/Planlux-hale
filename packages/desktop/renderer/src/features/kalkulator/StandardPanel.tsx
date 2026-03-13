import * as React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { tokens } from "../../theme/tokens";
import { formatStandardLabel } from "./formatStandardLabel";

/** Parse decimal from input (accepts comma or dot). Returns NaN if invalid. */
function parseDecimal(value: string): number {
  const s = String(value ?? "").trim().replace(",", ".");
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Clamp dimension to (min, reasonable max). Used when committing to draft. */
function clampDimension(n: number, min: number, fallback: number): number {
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.max(min, Math.min(n, 50));
}

/** Clamp quantity to integer >= 1. */
function clampQuantity(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.floor(n));
}

const styles = {
  section: {
    marginBottom: tokens.space[4],
  },
  sectionTitle: {
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semiBold,
    color: tokens.color.navy,
    marginBottom: tokens.space[2],
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap" as const,
  },
};

export type StandardItem = {
  name: string;
  description: string;
  /** Extra params (e.g. segmental gate dimensions). Stored in draft. */
  widthM?: string;
  heightM?: string;
  qty?: number;
};

function isSegmentalGateStandard(name: string): boolean {
  const raw = String(name ?? "");
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.includes("brama segmentowa");
}

function formatGateDimsShort(widthM: string, heightM: string): string {
  const w = Number(String(widthM).replace(",", "."));
  const h = Number(String(heightM).replace(",", "."));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return "";
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(w)} × ${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(h)} m`;
}

export type SegmentGateStandardState = {
  selected: boolean;
  widthM: number;
  heightM: number;
  qty: number;
};

export function StandardPanel(props: {
  standardOptions: StandardItem[];
  selectedStandards: StandardItem[];
  onSelectedStandardsChange: (v: StandardItem[]) => void;
  segmentGateStandard: SegmentGateStandardState;
  onSegmentGateStandardChange: (v: SegmentGateStandardState) => void;
  gutter: {
    selected: boolean;
    pricingMode: "INCLUDED" | "ADD";
    calcMode: "BY_LENGTH" | "BY_WIDTH";
    sides: 1 | 2;
    mb: number;
    unitPrice: number | null;
    totalPrice: number;
  };
  onGutterChange: (next: { pricingMode: "INCLUDED" | "ADD"; calcMode: "BY_LENGTH" | "BY_WIDTH"; sides: 1 | 2 }) => void;
  schedulePreviewRefresh: (mode: "typing" | "commit") => void;
  previewDebounceModeRef: React.MutableRefObject<"typing" | "commit">;
}) {
  const {
    standardOptions,
    selectedStandards,
    onSelectedStandardsChange,
    segmentGateStandard,
    onSegmentGateStandardChange,
    gutter,
    onGutterChange,
    schedulePreviewRefresh,
    previewDebounceModeRef,
  } = props;
  const [gutterConfigOpen, setGutterConfigOpen] = React.useState<boolean>(true);

  const gateSelected = !!segmentGateStandard?.selected;
  const widthM = segmentGateStandard?.widthM ?? 4;
  const heightM = segmentGateStandard?.heightM ?? 4;

  React.useEffect(() => {
    if (gutter.selected) setGutterConfigOpen(true);
  }, [gutter.selected]);

  const normalizeName = React.useCallback((s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "), []);
  const isSelected = React.useCallback(
    (name: string) => {
      if (isSegmentalGateStandard(name)) return gateSelected;
      return selectedStandards.some((x) => x.name === name);
    },
    [gateSelected, selectedStandards]
  );
  const toggleStandard = React.useCallback(
    (opt: StandardItem) => {
      previewDebounceModeRef.current = "commit";
      const isGate = isSegmentalGateStandard(opt.name);
      if (isGate) {
        if (gateSelected) {
          onSegmentGateStandardChange({ ...segmentGateStandard, selected: false });
          onSelectedStandardsChange(selectedStandards.filter((x) => !isSegmentalGateStandard(x.name)));
        } else {
          // Preserve existing dimensions when re-selecting; otherwise defaults (handlowiec może wrócić do kafla i ma zachowane wartości).
          const prev = segmentGateStandard;
          const w = prev?.widthM != null && Number.isFinite(prev.widthM) && prev.widthM > 0 ? prev.widthM : 4;
          const h = prev?.heightM != null && Number.isFinite(prev.heightM) && prev.heightM > 0 ? prev.heightM : 4;
          const q = prev?.qty != null && Number.isFinite(prev.qty) && prev.qty >= 1 ? Math.max(1, Math.floor(prev.qty)) : 1;
          onSegmentGateStandardChange({
            selected: true,
            widthM: w,
            heightM: h,
            qty: q,
          });
          onSelectedStandardsChange([
            ...selectedStandards.filter((x) => !isSegmentalGateStandard(x.name)),
            { ...opt, widthM: String(w), heightM: String(h), qty: q },
          ]);
        }
      } else {
        if (isSelected(opt.name)) {
          onSelectedStandardsChange(selectedStandards.filter((x) => x.name !== opt.name));
        } else {
          onSelectedStandardsChange([...selectedStandards, opt]);
        }
      }
      schedulePreviewRefresh("commit");
    },
    [gateSelected, isSelected, onSelectedStandardsChange, onSegmentGateStandardChange, previewDebounceModeRef, schedulePreviewRefresh, segmentGateStandard, selectedStandards]
  );

  const updateSegmentGateDims = React.useCallback(
    (patch: { widthM?: number; heightM?: number; qty?: number }) => {
      previewDebounceModeRef.current = "commit";
      const next = { ...segmentGateStandard, ...patch };
      onSegmentGateStandardChange(next);
      const gateOpt = standardOptions.find((o) => isSegmentalGateStandard(o.name));
      if (gateOpt) {
        const others = selectedStandards.filter((x) => !isSegmentalGateStandard(x.name));
        onSelectedStandardsChange([
          ...others,
          {
            ...gateOpt,
            widthM: next.widthM != null ? String(next.widthM) : "4",
            heightM: next.heightM != null ? String(next.heightM) : "4",
            qty: next.qty ?? 1,
          },
        ]);
      }
      schedulePreviewRefresh("commit");
    },
    [onSelectedStandardsChange, onSegmentGateStandardChange, previewDebounceModeRef, schedulePreviewRefresh, segmentGateStandard, selectedStandards, standardOptions]
  );

  return (
    <div style={styles.section}>
      <Typography variant="subtitle2" sx={styles.sectionTitle}>
        STANDARD HALI
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 1.5,
          mt: 1,
          alignItems: "start",
        }}
      >
        {standardOptions.map((opt) => {
          const selected = isSelected(opt.name);
          const isGutter = normalizeName(opt.name) === "system rynnowy";
          const isGate = isSegmentalGateStandard(opt.name);

          const tileBorder = `1px solid ${selected ? tokens.color.primary : tokens.color.border}`;
          const tileBg = selected ? tokens.color.gray[50] : tokens.color.white;
          const tileSx = {
            textAlign: "left" as const,
            borderRadius: 2,
            border: tileBorder,
            background: tileBg,
            p: 1.5,
            transition: "border-color 120ms ease, background 120ms ease",
            "&:hover": {
              borderColor: selected ? tokens.color.primary : tokens.color.gray[400],
              background: selected ? tokens.color.gray[50] : tokens.color.gray[50],
            },
            overflow: "visible" as const,
          };

          if (isGate) {
            return (
              <Box
                key={opt.name}
                sx={{
                  border: gateSelected ? "1.5px solid #a32035" : "1px solid #d9dee7",
                  borderRadius: 3,
                  background: gateSelected ? "#fff8fa" : "#fff",
                  p: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                  overflow: "visible",
                }}
              >
                <Box
                  onClick={() => toggleStandard(opt)}
                  role="button"
                  aria-pressed={gateSelected}
                  sx={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 1,
                  }}
                >
                  <Box
                    sx={{
                      width: 18,
                      height: 18,
                      borderRadius: 0.75,
                      border: gateSelected ? "1.5px solid #a32035" : "1.5px solid #94a3b8",
                      background: gateSelected ? "#a32035" : "#fff",
                      mt: 0.2,
                      flexShrink: 0,
                    }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>
                      Brama Segmentowa
                    </Typography>

                    {!!opt.description && (
                      <Typography sx={{ mt: 0.25, fontSize: 12, color: "#64748b", lineHeight: 1.3 }}>
                        {opt.description}
                      </Typography>
                    )}

                    {gateSelected && (
                      <Typography sx={{ mt: 0.5, fontSize: 14, fontWeight: 600 }}>
                        {widthM} × {heightM} m
                      </Typography>
                    )}
                  </Box>
                </Box>

                {gateSelected && (
                  <Box
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                      borderTop: "1px solid #e5e7eb",
                      pt: 1.25,
                      display: "grid",
                      gap: 1,
                    }}
                  >
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Szerokość (m)</span>
                      <input
                        value={String(widthM ?? "")}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const n = parseDecimal(e.target.value);
                          updateSegmentGateDims({
                            widthM: Number.isFinite(n) ? clampDimension(n, 0.01, 4) : widthM,
                          });
                        }}
                        style={{
                          width: "100%",
                          minHeight: 36,
                          padding: "8px 10px",
                          border: "1px solid #cbd5e1",
                          borderRadius: "10px",
                          background: "#fff",
                          color: "#111827",
                        }}
                      />
                    </label>

                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Wysokość (m)</span>
                      <input
                        value={String(heightM ?? "")}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const n = parseDecimal(e.target.value);
                          updateSegmentGateDims({
                            heightM: Number.isFinite(n) ? clampDimension(n, 0.01, 4) : heightM,
                          });
                        }}
                        style={{
                          width: "100%",
                          minHeight: 36,
                          padding: "8px 10px",
                          border: "1px solid #cbd5e1",
                          borderRadius: "10px",
                          background: "#fff",
                          color: "#111827",
                        }}
                      />
                    </label>
                  </Box>
                )}
              </Box>
            );
          }

          return (
            <ButtonBase
              key={opt.name}
              onClick={() => toggleStandard(opt)}
              aria-pressed={selected}
              aria-label={`${selected ? "Odznacz" : "Zaznacz"}: ${formatStandardLabel(opt.name)}`}
              sx={{
                ...tileSx,
                textAlign: "left",
                alignItems: "stretch",
                display: "flex",
                gap: 1.25,
                "&:hover": {
                  ...tileSx["&:hover"],
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  transform: "translateY(0px)",
                },
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: 18,
                  height: 18,
                  borderRadius: "5px",
                  border: `2px solid ${selected ? tokens.color.primary : tokens.color.gray[400]}`,
                  background: selected ? tokens.color.primary : "transparent",
                  mt: "3px",
                  flex: "0 0 auto",
                }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                  <Typography sx={{ fontWeight: 700, color: tokens.color.navy, fontSize: 14, lineHeight: 1.2 }}>
                    {formatStandardLabel(opt.name)}
                  </Typography>
                  {isGutter && selected && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setGutterConfigOpen(true);
                      }}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: `1px solid ${tokens.color.border}`,
                        background: tokens.color.white,
                        color: tokens.color.navy,
                        cursor: "pointer",
                        fontSize: 12,
                        flex: "0 0 auto",
                      }}
                    >
                      Konfiguruj
                    </button>
                  )}
                </Box>
                {opt.description?.trim() && (
                  <Typography sx={{ color: tokens.color.textMuted, fontSize: 12, mt: 0.5, lineHeight: 1.25 }}>
                    {opt.description}
                  </Typography>
                )}
                {isGutter && selected && (
                  <Typography sx={{ color: tokens.color.textMuted, fontSize: 12, mt: 0.75 }}>
                    {gutter.pricingMode === "INCLUDED" ? "W cenie" : "Dolicz"} · {gutter.mb.toLocaleString("pl-PL")} mb ·{" "}
                    {gutter.sides === 1 ? "1 bok" : "2 boki"}
                  </Typography>
                )}
              </Box>
            </ButtonBase>
          );
        })}
      </Box>

      {/* System rynnowy – dodatkowa konfiguracja tylko gdy pozycja jest w standardach */}
      {gutter.selected && gutterConfigOpen && (
        <div style={{ marginTop: tokens.space[3], paddingTop: tokens.space[3], borderTop: `1px solid ${tokens.color.border}` }}>
          <Typography variant="subtitle2" sx={styles.sectionTitle}>
            System rynnowy
          </Typography>

          <div style={styles.row}>
            <span style={{ width: 160, color: tokens.color.textMuted, fontSize: 12 }}>Tryb ceny</span>
            <select
              value={gutter.pricingMode}
              onChange={(e) => {
                previewDebounceModeRef.current = "commit";
                onGutterChange({ pricingMode: e.target.value as "INCLUDED" | "ADD", calcMode: gutter.calcMode, sides: gutter.sides });
                schedulePreviewRefresh("commit");
              }}
              style={{ padding: 6 }}
            >
              <option value="INCLUDED">W CENIE</option>
              <option value="ADD">DOLICZ</option>
            </select>
          </div>

          <div style={styles.row}>
            <span style={{ width: 160, color: tokens.color.textMuted, fontSize: 12 }}>Liczenie mb</span>
            <select
              value={gutter.calcMode}
              onChange={(e) => {
                previewDebounceModeRef.current = "commit";
                onGutterChange({ pricingMode: gutter.pricingMode, calcMode: e.target.value as "BY_LENGTH" | "BY_WIDTH", sides: gutter.sides });
                schedulePreviewRefresh("commit");
              }}
              style={{ padding: 6 }}
            >
              <option value="BY_LENGTH">po długości hali</option>
              <option value="BY_WIDTH">po szerokości hali</option>
            </select>
          </div>

          <div style={styles.row}>
            <span style={{ width: 160, color: tokens.color.textMuted, fontSize: 12 }}>Liczba boków</span>
            <select
              value={String(gutter.sides)}
              onChange={(e) => {
                previewDebounceModeRef.current = "commit";
                onGutterChange({ pricingMode: gutter.pricingMode, calcMode: gutter.calcMode, sides: (parseInt(e.target.value, 10) as 1 | 2) || 2 });
                schedulePreviewRefresh("commit");
              }}
              style={{ padding: 6 }}
            >
              <option value="1">1 bok</option>
              <option value="2">2 boki</option>
            </select>
          </div>

          <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 8 }}>
            Obliczona długość: <span style={{ fontWeight: 700, color: tokens.color.navy }}>{gutter.mb.toLocaleString("pl-PL")} mb</span>
          </div>
          {gutter.pricingMode === "ADD" && (
            <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 6 }}>
              Cena:{" "}
              <span style={{ fontWeight: 700, color: tokens.color.primary }}>
                {gutter.totalPrice.toLocaleString("pl-PL")} zł
              </span>
              {gutter.unitPrice == null && (
                <span style={{ marginLeft: 8, color: tokens.color.warning }}>
                  Brak ceny za mb w bazie – użyto 0 zł/mb
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

