/**
 * AddonsPanel – jeden ekran/sekcja ze wszystkimi dodatkami.
 * Grupy: Standardy, Bramy, System rynnowy, Pozostałe dodatki, Dopłaty.
 */

import { Typography } from "@mui/material";
import { tokens } from "../../theme/tokens";

const styles = {
  label: {
    display: "block" as const,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.medium,
    color: tokens.color.textMuted,
    marginBottom: tokens.space[1],
  },
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
  input: {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    fontSize: tokens.font.size.base,
    marginBottom: tokens.space[4],
  },
  buttonSecondary: {
    padding: "10px 20px",
    background: tokens.color.gray[200],
    color: tokens.color.navy,
    border: "none",
    borderRadius: tokens.radius.md,
    fontWeight: tokens.font.weight.medium,
    cursor: "pointer",
  } as React.CSSProperties,
};

interface StandardItem {
  element: string;
  ilosc: number;
  jednostka: string;
  wartoscRef: number;
  pricingMode?: string;
  total?: number;
}

interface Props {
  /** Dodatki opcjonalne (rynny, okna, drzwi, bramy itd.) – z cennika */
  groupedAddons: string[];
  addons: Array<{ nazwa: string; ilosc: number }>;
  toggleAddon: (nazwa: string, ilosc: number) => void;
  /** Standardy – w cenie vs dolicz */
  standardInPrice: StandardItem[];
  standardSnapshot: Array<{ element: string; pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA" }>;
  onStandardModeChange: (element: string, mode: "INCLUDED_FREE" | "CHARGE_EXTRA") => void;
  /** System rynnowy */
  rainGuttersAuto: boolean;
  onRainGuttersChange: (v: boolean) => void;
  /** Bramy segmentowe */
  gates: Array<{ width: number; height: number; quantity: number }>;
  onGatesChange: (v: Array<{ width: number; height: number; quantity: number }>) => void;
  /** Dopłata za wysokość (auto) */
  heightSurchargeAuto: boolean;
  onHeightSurchargeChange: (v: boolean) => void;
  heightM: string;
  heightSurchargeThreshold?: number;
  /** Ręczne dopłaty */
  manualSurcharges: Array<{ description: string; amount: number }>;
  onManualSurchargesChange: (v: Array<{ description: string; amount: number }>) => void;
  schedulePreviewRefresh: (mode: "typing" | "commit") => void;
  previewDebounceModeRef: React.MutableRefObject<"typing" | "commit">;
}

export function AddonsPanel({
  groupedAddons,
  addons,
  toggleAddon,
  standardInPrice,
  standardSnapshot,
  onStandardModeChange,
  rainGuttersAuto,
  onRainGuttersChange,
  gates,
  onGatesChange,
  heightSurchargeAuto,
  onHeightSurchargeChange,
  heightM,
  heightSurchargeThreshold,
  manualSurcharges,
  onManualSurchargesChange,
  schedulePreviewRefresh,
  previewDebounceModeRef,
}: Props) {
  const heightNum = parseFloat(heightM) || 0;
  const isHeightSurchargeActive = heightSurchargeAuto && heightNum > 0 && (heightSurchargeThreshold == null || heightNum > heightSurchargeThreshold);

  return (
    <div>
      {/* A) Standardy */}
      {standardInPrice.length > 0 && (
        <div style={styles.section}>
          <Typography variant="subtitle2" sx={styles.sectionTitle}>
            Standardy
          </Typography>
          {standardInPrice.map((s) => {
            const mode = standardSnapshot.find((sn) => sn.element === s.element)?.pricingMode ?? (s.pricingMode ?? "INCLUDED_FREE");
            return (
              <div key={s.element} style={styles.row}>
                <span style={{ flex: "1 1 180px", minWidth: 0 }}>{s.element}</span>
                <span style={{ fontSize: 12, color: tokens.color.textMuted }}>
                  {s.ilosc} {s.jednostka} · ref. {s.wartoscRef?.toLocaleString("pl-PL")} zł
                </span>
                <select
                  value={mode}
                  onChange={(e) => {
                    previewDebounceModeRef.current = "commit";
                    onStandardModeChange(s.element, e.target.value as "INCLUDED_FREE" | "CHARGE_EXTRA");
                    schedulePreviewRefresh("commit");
                  }}
                  style={{ width: 120, padding: 6 }}
                >
                  <option value="INCLUDED_FREE">w cenie</option>
                  <option value="CHARGE_EXTRA">dolicz</option>
                </select>
                {mode === "CHARGE_EXTRA" && s.total != null && (
                  <span style={{ fontWeight: 600, color: tokens.color.primary }}>+{s.total.toLocaleString("pl-PL")} zł</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* B) Bramy segmentowe */}
      <div style={styles.section}>
        <Typography variant="subtitle2" sx={styles.sectionTitle}>
          Bramy segmentowe
        </Typography>
        {gates.map((g, i) => (
          <div key={i} style={{ ...styles.row, flexWrap: "wrap" }}>
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Szer. m"
              value={g.width || ""}
              onChange={(e) => {
                const v = [...gates];
                v[i] = { ...g, width: parseFloat(e.target.value) || 0 };
                onGatesChange(v);
                previewDebounceModeRef.current = "typing";
              }}
              onBlur={() => schedulePreviewRefresh("commit")}
              style={{ width: 70, padding: 6 }}
            />
            <input
              type="number"
              min={0}
              step={0.1}
              placeholder="Wys. m"
              value={g.height || ""}
              onChange={(e) => {
                const v = [...gates];
                v[i] = { ...g, height: parseFloat(e.target.value) || 0 };
                onGatesChange(v);
                previewDebounceModeRef.current = "typing";
              }}
              onBlur={() => schedulePreviewRefresh("commit")}
              style={{ width: 70, padding: 6 }}
            />
            <input
              type="number"
              min={0}
              placeholder="szt"
              value={g.quantity || ""}
              onChange={(e) => {
                const v = [...gates];
                v[i] = { ...g, quantity: parseInt(e.target.value, 10) || 0 };
                onGatesChange(v);
                previewDebounceModeRef.current = "typing";
              }}
              onBlur={() => schedulePreviewRefresh("commit")}
              style={{ width: 50, padding: 6 }}
            />
            <button
              type="button"
              onClick={() => {
                previewDebounceModeRef.current = "commit";
                onGatesChange(gates.filter((_, j) => j !== i));
                schedulePreviewRefresh("commit");
              }}
              style={{ ...styles.buttonSecondary, padding: "6px 12px" }}
            >
              Usuń
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            previewDebounceModeRef.current = "commit";
            onGatesChange([...gates, { width: 0, height: 0, quantity: 1 }]);
            schedulePreviewRefresh("commit");
          }}
          style={styles.buttonSecondary}
        >
          + Dodaj bramę
        </button>
      </div>

      {/* C) System rynnowy */}
      <div style={styles.section}>
        <Typography variant="subtitle2" sx={styles.sectionTitle}>
          System rynnowy
        </Typography>
        <div style={styles.row}>
          <input
            type="checkbox"
            id="rainGutters"
            checked={rainGuttersAuto}
            onChange={(e) => {
              previewDebounceModeRef.current = "commit";
              onRainGuttersChange(e.target.checked);
              schedulePreviewRefresh("commit");
            }}
          />
          <label htmlFor="rainGutters">System rynnowy (obwód × stawka mb)</label>
        </div>
      </div>

      {/* D) Pozostałe dodatki (okna, drzwi, automaty, płyta 80/100) */}
      {groupedAddons.length > 0 && (
        <div style={styles.section}>
          <Typography variant="subtitle2" sx={styles.sectionTitle}>
            Dodatki opcjonalne
          </Typography>
          {groupedAddons.map((nazwa) => {
            const current = addons.find((a) => a.nazwa === nazwa);
            return (
              <div key={nazwa} style={styles.row}>
                <input
                  type="checkbox"
                  checked={(current?.ilosc ?? 0) > 0}
                  onChange={(e) => {
                    previewDebounceModeRef.current = "commit";
                    toggleAddon(nazwa, e.target.checked ? 1 : 0);
                    schedulePreviewRefresh("commit");
                  }}
                />
                <span style={{ flex: 1 }}>{nazwa}</span>
                <input
                  type="number"
                  min={0}
                  value={current?.ilosc ?? 0}
                  onChange={(e) => {
                    previewDebounceModeRef.current = "typing";
                    toggleAddon(nazwa, Math.max(0, parseInt(e.target.value, 10) || 0));
                  }}
                  onBlur={() => schedulePreviewRefresh("commit")}
                  style={{ width: 80, padding: 6 }}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* E) Dopłaty */}
      <div style={styles.section}>
        <Typography variant="subtitle2" sx={styles.sectionTitle}>
          Dopłaty
        </Typography>
        <div style={styles.row}>
          <input
            type="checkbox"
            id="heightSurcharge"
            checked={heightSurchargeAuto}
            onChange={(e) => {
              previewDebounceModeRef.current = "commit";
              onHeightSurchargeChange(e.target.checked);
              schedulePreviewRefresh("commit");
            }}
          />
          <label htmlFor="heightSurcharge">
            Dopłata za wysokość
            {isHeightSurchargeActive && heightSurchargeThreshold != null && (
              <span style={{ fontSize: 11, color: tokens.color.textMuted, marginLeft: 4 }}>
                (auto: {heightNum}m &gt; {heightSurchargeThreshold}m)
              </span>
            )}
            {isHeightSurchargeActive && heightSurchargeThreshold == null && (
              <span style={{ fontSize: 11, color: tokens.color.primary, marginLeft: 4 }}>auto</span>
            )}
          </label>
        </div>
        <label style={styles.label}>Ręczne dopłaty</label>
        {manualSurcharges.map((m, i) => (
          <div key={i} style={{ ...styles.row, flexWrap: "wrap" }}>
            <input
              placeholder="Opis"
              value={m.description}
              onChange={(e) => {
                const v = [...manualSurcharges];
                v[i] = { ...m, description: e.target.value };
                onManualSurchargesChange(v);
                previewDebounceModeRef.current = "typing";
              }}
              style={{ flex: 1, minWidth: 120, padding: 6 }}
            />
            <input
              type="number"
              min={0}
              placeholder="zł"
              value={m.amount || ""}
              onChange={(e) => {
                const v = [...manualSurcharges];
                v[i] = { ...m, amount: parseFloat(e.target.value) || 0 };
                onManualSurchargesChange(v);
                previewDebounceModeRef.current = "typing";
              }}
              style={{ width: 90, padding: 6 }}
            />
            <button
              type="button"
              onClick={() => {
                previewDebounceModeRef.current = "commit";
                onManualSurchargesChange(manualSurcharges.filter((_, j) => j !== i));
                schedulePreviewRefresh("commit");
              }}
              style={{ ...styles.buttonSecondary, padding: "6px 12px" }}
            >
              Usuń
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            previewDebounceModeRef.current = "commit";
            onManualSurchargesChange([...manualSurcharges, { description: "", amount: 0 }]);
            schedulePreviewRefresh("commit");
          }}
          style={styles.buttonSecondary}
        >
          + Dodaj dopłatę
        </button>
      </div>

      {groupedAddons.length === 0 && standardInPrice.length === 0 && (
        <p style={{ color: tokens.color.textMuted }}>Wybierz wariant hali i wprowadź wymiary.</p>
      )}
    </div>
  );
}
