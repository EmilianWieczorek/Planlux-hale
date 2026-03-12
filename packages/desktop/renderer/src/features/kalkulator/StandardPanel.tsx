import * as React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { tokens } from "../../theme/tokens";
import { formatStandardLabel } from "./formatStandardLabel";
import { isRendererDebug } from "../../utils/env";

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
  return /brama\s*segmentowa/i.test(name);
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
  const isDebugLog = isRendererDebug();

  const gateSelected = !!segmentGateStandard?.selected;
  const widthM = segmentGateStandard?.widthM ?? 4;
  const heightM = segmentGateStandard?.heightM ?? 4;
  const qty = segmentGateStandard?.qty ?? 1;

  // eslint-disable-next-line no-console
  console.debug("[segment-gate-standard][render]", { gateSelected, segmentGateStandard });

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
          onSegmentGateStandardChange({
            selected: true,
            widthM: 4,
            heightM: 4,
            qty: 1,
          });
          onSelectedStandardsChange([
            ...selectedStandards.filter((x) => !isSegmentalGateStandard(x.name)),
            { ...opt, widthM: "4", heightM: "4", qty: 1 },
          ]);
        }
      } else {
        if (isSelected(opt.name)) {
          onSelectedStandardsChange(selectedStandards.filter((x) => x.name !== opt.name));
        } else {
          onSelectedStandardsChange([...selectedStandards, opt]);
        }
      }
      if (isDebugLog) {
        // eslint-disable-next-line no-console
        console.debug("[standards] calculator state updated", { action: isSelected(opt.name) ? "remove" : "add", name: opt.name, isGate });
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
      if (isDebugLog) {
        // eslint-disable-next-line no-console
        console.debug("[segment-gate-standard] updateGateDims", patch);
      }
      schedulePreviewRefresh("commit");
    },
    [isDebugLog, onSelectedStandardsChange, onSegmentGateStandardChange, previewDebounceModeRef, schedulePreviewRefresh, segmentGateStandard, selectedStandards, standardOptions]
  );

  const clampNum = React.useCallback((v: number, min: number, type: "w" | "h" | "qty"): number => {
    if (type === "qty") return Math.max(1, Math.floor(v));
    return Number.isFinite(v) && v > 0 ? Math.max(min, v) : min;
  }, []);

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
        }}
      >
        {standardOptions.map((opt) => {
          const selected = isSelected(opt.name);
          const isGutter = normalizeName(opt.name) === "system rynnowy";
          const isGate = isSegmentalGateStandard(opt.name);
          return (
            <ButtonBase
              key={opt.name}
              onClick={() => toggleStandard(opt)}
              aria-pressed={selected}
              aria-label={`${selected ? "Odznacz" : "Zaznacz"}: ${formatStandardLabel(opt.name)}`}
              sx={{
                textAlign: "left",
                alignItems: "stretch",
                borderRadius: 2,
                border: `1px solid ${selected ? tokens.color.primary : tokens.color.border}`,
                background: selected ? tokens.color.gray[50] : tokens.color.white,
                p: 1.5,
                transition: "border-color 120ms ease, background 120ms ease, transform 120ms ease",
                "&:hover": {
                  borderColor: selected ? tokens.color.primary : tokens.color.gray[400],
                  background: selected ? tokens.color.gray[50] : tokens.color.gray[50],
                  transform: "translateY(-1px)",
                },
                "&:active": {
                  transform: "translateY(0px)",
                },
                display: "flex",
                gap: 1.25,
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
                {isGate && selected && widthM > 0 && heightM > 0 && (
                  <Typography sx={{ color: tokens.color.textMuted, fontSize: 12, mt: 0.75 }}>
                    {formatGateDimsShort(String(widthM), String(heightM))} • {qty} szt
                  </Typography>
                )}
                {isGate && (
                  <>
                    {true && (
                      <div style={{ marginTop: 8, padding: 8, border: "2px solid red" }}>
                        TEST BRAMA SEGMENTOWA
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "red", marginTop: 4 }}>
                      gateSelected: {String(gateSelected)}
                    </div>
                  </>
                )}
                {isGate && gateSelected && (
                  <div
                    style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={widthM}
                      onChange={(e) =>
                        onSegmentGateStandardChange({
                          ...(segmentGateStandard ?? { selected: true, widthM: 4, heightM: 4, qty: 1 }),
                          widthM: Number(e.target.value) || 4,
                        })
                      }
                      placeholder="Szer. (m)"
                      style={{ padding: 6, width: 80 }}
                    />
                    <input
                      type="number"
                      min={0.01}
                      step={0.01}
                      value={heightM}
                      onChange={(e) =>
                        onSegmentGateStandardChange({
                          ...(segmentGateStandard ?? { selected: true, widthM: 4, heightM: 4, qty: 1 }),
                          heightM: Number(e.target.value) || 4,
                        })
                      }
                      placeholder="Wys. (m)"
                      style={{ padding: 6, width: 80 }}
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={qty}
                      onChange={(e) =>
                        onSegmentGateStandardChange({
                          ...(segmentGateStandard ?? { selected: true, widthM: 4, heightM: 4, qty: 1 }),
                          qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                        })
                      }
                      placeholder="szt"
                      style={{ padding: 6, width: 60 }}
                    />
                  </div>
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

