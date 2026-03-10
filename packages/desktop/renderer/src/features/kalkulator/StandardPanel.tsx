import * as React from "react";
import { Box, ButtonBase, Typography } from "@mui/material";
import { tokens } from "../../theme/tokens";
import { formatStandardLabel } from "./formatStandardLabel";

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

export type StandardItem = { name: string; description: string };

export function StandardPanel(props: {
  standardOptions: StandardItem[];
  selectedStandards: StandardItem[];
  onSelectedStandardsChange: (v: StandardItem[]) => void;
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
  const { standardOptions, selectedStandards, onSelectedStandardsChange, gutter, onGutterChange, schedulePreviewRefresh, previewDebounceModeRef } = props;
  const [gutterConfigOpen, setGutterConfigOpen] = React.useState<boolean>(true);

  React.useEffect(() => {
    if (gutter.selected) setGutterConfigOpen(true);
  }, [gutter.selected]);

  const normalizeName = React.useCallback((s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " "), []);
  const isSelected = React.useCallback(
    (name: string) => selectedStandards.some((x) => x.name === name),
    [selectedStandards]
  );
  const toggleStandard = React.useCallback(
    (opt: StandardItem) => {
      previewDebounceModeRef.current = "commit";
      if (isSelected(opt.name)) {
        onSelectedStandardsChange(selectedStandards.filter((x) => x.name !== opt.name));
      } else {
        onSelectedStandardsChange([...selectedStandards, opt]);
      }
      schedulePreviewRefresh("commit");
    },
    [isSelected, onSelectedStandardsChange, previewDebounceModeRef, schedulePreviewRefresh, selectedStandards]
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
        }}
      >
        {standardOptions.map((opt) => {
          const selected = isSelected(opt.name);
          const isGutter = normalizeName(opt.name) === "system rynnowy";
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

