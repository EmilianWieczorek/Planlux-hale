/**
 * AddonsPanel – jeden ekran/sekcja ze wszystkimi dodatkami.
 * Grupy: Standardy, Bramy, System rynnowy, Pozostałe dodatki, Dopłaty.
 */

import * as React from "react";
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

export type StandardItem = { name: string; description: string };
export type AddonOption = { optionKey: string; name: string; price: number; unit?: string };
export type AddonItem = { name: string; price: number; unit?: string; quantity: number; optionKey?: string };
export type SectionalGateAddon = {
  type: "BRAMA_SEGMENTOWA";
  width: number;
  height: number;
  quantity: number;
  unitPricePerM2: number;
  areaOne: number;
  priceOne: number;
  totalPrice: number;
};

/** Dopłata za wysokość – automatyczna, tylko do wyświetlenia gdy aktywna */
export type HeightSurchargeDisplay = { label: string; amount: number } | null;

interface Props {
  /** DODATKI (płatne) – źródło: addons_surcharges */
  addonOptions: AddonOption[];
  selectedAddons: AddonItem[];
  onSelectedAddonsChange: (v: AddonItem[]) => void;
  /** System rynnowy (legacy) – sterowany w Standardach; tu zostaje tylko kompatybilność propsów. */
  rainGuttersAuto: boolean;
  onRainGuttersChange: (v: boolean) => void;
  /** Bramy segmentowe – pokazywane tylko gdy wariant ma ten dodatek w addons_surcharges */
  sectionalGateAvailable: boolean;
  gates: Array<{ width: number; height: number; quantity: number; unitPricePerM2?: number }>;
  onGatesChange: (v: Array<{ width: number; height: number; quantity: number; unitPricePerM2?: number }>) => void;
  gateUnitPricePerM2Default?: number | null;
  /** Dodatki specjalne: płyty 80/100 mm (T18_T35_DACH) */
  plate80Available?: boolean;
  plate100Available?: boolean;
  plate80Selected?: boolean;
  plate100Selected?: boolean;
  onPlate80Change?: (v: boolean) => void;
  onPlate100Change?: (v: boolean) => void;
  /** Dopłata za wysokość – gdy aktywna (wariant + próg), pokazana jako automatyczna */
  heightSurchargeDisplay?: HeightSurchargeDisplay;
  /** Ręczne dopłaty */
  manualSurcharges: Array<{ description: string; amount: number }>;
  onManualSurchargesChange: (v: Array<{ description: string; amount: number }>) => void;
  schedulePreviewRefresh: (mode: "typing" | "commit") => void;
  previewDebounceModeRef: React.MutableRefObject<"typing" | "commit">;
}

export function AddonsPanel({
  addonOptions,
  selectedAddons,
  onSelectedAddonsChange,
  rainGuttersAuto,
  onRainGuttersChange,
  sectionalGateAvailable,
  gates,
  onGatesChange,
  gateUnitPricePerM2Default,
  plate80Available,
  plate100Available,
  plate80Selected,
  plate100Selected,
  onPlate80Change,
  onPlate100Change,
  heightSurchargeDisplay,
  manualSurcharges,
  onManualSurchargesChange,
  schedulePreviewRefresh,
  previewDebounceModeRef,
}: Props) {
  const [addonSelect, setAddonSelect] = React.useState<string>("");
  const safeNum = React.useCallback((v: unknown) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : 0;
  }, []);
  const safeInt = React.useCallback((v: unknown) => {
    const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) ? n : 0;
  }, []);
  /** Cena za m² tylko z bazy (gateUnitPricePerM2Default). Nie ma ręcznej edycji. */
  const buildGateModel = React.useCallback(
    (g: { width: number; height: number; quantity: number }): SectionalGateAddon => {
      const width = Math.max(0, safeNum(g.width));
      const height = Math.max(0, safeNum(g.height));
      const quantity = Math.max(0, safeInt(g.quantity));
      const unitPricePerM2 = Math.max(0, safeNum(gateUnitPricePerM2Default ?? 0));
      const areaOne = width > 0 && height > 0 ? width * height : 0;
      const priceOne = areaOne > 0 && unitPricePerM2 > 0 ? areaOne * unitPricePerM2 : 0;
      const totalPrice = priceOne > 0 && quantity > 0 ? priceOne * quantity : 0;
      return { type: "BRAMA_SEGMENTOWA", width, height, quantity, unitPricePerM2, areaOne, priceOne, totalPrice };
    },
    [gateUnitPricePerM2Default, safeInt, safeNum]
  );

  const hasSpecialAddons =
    sectionalGateAvailable ||
    !!plate80Available ||
    !!plate100Available ||
    !!heightSurchargeDisplay;

  return (
    <div>
      {/* Sekcja DODATKI SPECJALNE: bramy segmentowe, płyty 80/100 mm, dopłata za wysokość */}
      {hasSpecialAddons && (
        <div style={styles.section}>
          <Typography variant="subtitle2" sx={styles.sectionTitle}>
            Dodatki specjalne
          </Typography>

          {/* A) Bramy segmentowe – tylko gdy wariant ma ten dodatek w addons_surcharges */}
          {sectionalGateAvailable && (
      <div style={styles.section}>
        <Typography variant="subtitle2" sx={styles.sectionTitle}>
          Bramy segmentowe
        </Typography>
        {gates.map((g, i) => (
          <div key={i} style={{ marginBottom: tokens.space[3] }}>
            <div style={{ ...styles.row, flexWrap: "wrap" }}>
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
            {gateUnitPricePerM2Default != null && gateUnitPricePerM2Default > 0 && (
              <span style={{ fontSize: 12, color: tokens.color.textMuted, alignSelf: "center" }}>
                Cena z bazy: {Math.round(gateUnitPricePerM2Default).toLocaleString("pl-PL")} zł/m²
              </span>
            )}
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
            {(() => {
              const m = buildGateModel({ width: g.width, height: g.height, quantity: g.quantity });
              const fmt = (n: number) => new Intl.NumberFormat("pl-PL").format(Math.round(n));
              const fmt2 = (n: number) => n.toLocaleString("pl-PL", { maximumFractionDigits: 2 });
              return (
                <div style={{ fontSize: 12, color: tokens.color.textMuted, marginTop: 6, paddingLeft: 2 }}>
                  <div>Powierzchnia 1 bramy: <strong style={{ color: tokens.color.navy }}>{fmt2(m.areaOne)} m²</strong></div>
                  <div>Cena 1 bramy: <strong style={{ color: tokens.color.navy }}>{fmt(m.priceOne)} zł</strong></div>
                  <div>Ilość: <strong style={{ color: tokens.color.navy }}>{m.quantity} szt</strong></div>
                  <div>Cena wszystkich bram: <strong style={{ color: tokens.color.primary }}>{fmt(m.totalPrice)} zł</strong></div>
                </div>
              );
            })()}
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
          )}

          {/* B) Dopłaty do płyt 80 mm / 100 mm – wybór ręczny */}
          {(plate80Available || plate100Available) && (
            <div style={{ marginBottom: tokens.space[3] }}>
              <label style={{ ...styles.label, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                {plate80Available && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!plate80Selected}
                      onChange={(e) => {
                        onPlate80Change?.(e.target.checked);
                        previewDebounceModeRef.current = "commit";
                        schedulePreviewRefresh("commit");
                      }}
                    />
                    <span>Dopłata do płyty 80 mm</span>
                  </label>
                )}
                {plate100Available && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!plate100Selected}
                      onChange={(e) => {
                        onPlate100Change?.(e.target.checked);
                        previewDebounceModeRef.current = "commit";
                        schedulePreviewRefresh("commit");
                      }}
                    />
                    <span>Dopłata do płyty 100 mm</span>
                  </label>
                )}
              </label>
            </div>
          )}

          {/* C) Dopłata za wysokość – automatyczna, tylko gdy warunek spełniony */}
          {heightSurchargeDisplay && (
            <div style={{ marginBottom: tokens.space[2], fontSize: tokens.font.size.sm, color: tokens.color.textMuted }}>
              <span>{heightSurchargeDisplay.label}</span>
              <strong style={{ marginLeft: 8, color: tokens.color.primary }}>
                {Math.round(heightSurchargeDisplay.amount).toLocaleString("pl-PL")} zł
              </strong>
              <span style={{ marginLeft: 6 }}>(automatycznie)</span>
            </div>
          )}
        </div>
      )}

      {/* System rynnowy: sterowany w sekcji Standardy (ukryty tutaj, żeby nie dublować) */}

      {/* C) DODATKI (płatne) */}
      <div style={styles.section}>
        <div style={styles.section}>
          <Typography variant="subtitle2" sx={styles.sectionTitle}>
            DODATKI
          </Typography>
          <select
            value={addonSelect}
            onChange={(e) => {
              previewDebounceModeRef.current = "commit";
              const name = e.target.value;
              setAddonSelect(name);
              const opt = addonOptions.find((a) => a.name === name);
              if (opt && !selectedAddons.some((x) => x.name === opt.name)) {
                onSelectedAddonsChange([...selectedAddons, { name: opt.name, price: opt.price, unit: opt.unit, quantity: 1, optionKey: opt.optionKey }]);
                schedulePreviewRefresh("commit");
              }
            }}
            style={styles.input}
          >
            <option value="">▼ Wybierz dodatek płatny</option>
            {/* addon_name is not unique across variants; use stable optionKey for React key */}
            {addonOptions.map((a) => (
              <option key={a.optionKey} value={a.name}>{a.name}</option>
            ))}
          </select>

          {selectedAddons.length > 0 && (
            <div style={{ marginTop: tokens.space[2] }}>
              {selectedAddons.map((a, i) => (
                <div key={a.optionKey ?? `addon-${i}`} style={styles.row}>
                  <span style={{ flex: 1 }}>{a.name}</span>
                  <span style={{ fontSize: 12, color: tokens.color.textMuted }}>
                    {a.price.toLocaleString("pl-PL")} zł{a.unit ? `/${a.unit}` : ""}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={a.quantity}
                    onChange={(e) => {
                      previewDebounceModeRef.current = "typing";
                      const q = Math.max(0, parseInt(e.target.value, 10) || 0);
                      onSelectedAddonsChange(selectedAddons.map((x) => (x.name === a.name ? { ...x, quantity: q } : x)));
                    }}
                    onBlur={() => schedulePreviewRefresh("commit")}
                    style={{ width: 80, padding: 6 }}
                  />
                  <span style={{ fontWeight: 600, color: tokens.color.primary }}>
                    {(a.price * (a.quantity || 0)).toLocaleString("pl-PL")} zł
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      previewDebounceModeRef.current = "commit";
                      onSelectedAddonsChange(selectedAddons.filter((x) => x.name !== a.name));
                      schedulePreviewRefresh("commit");
                    }}
                    style={{ ...styles.buttonSecondary, padding: "6px 12px" }}
                  >
                    Usuń
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* D) Dopłaty – dopłata za wysokość naliczana automatycznie z bazy (nie w dropdownie) */}
      <div style={styles.section}>
        <Typography variant="subtitle2" sx={styles.sectionTitle}>
          Dopłaty
        </Typography>
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

      {addonOptions.length === 0 && (
        <p style={{ color: tokens.color.textMuted }}>Wybierz wariant hali i wprowadź wymiary.</p>
      )}
    </div>
  );
}
