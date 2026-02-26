import type { CennikRow, DodatkiRow, StandardRow } from "../api/types";

export interface GateInput {
  width: number;
  height: number;
  quantity: number;
}

export interface ManualSurchargeInput {
  description: string;
  amount: number;
}

export interface StandardSnapshotItem {
  element: string;
  ilosc: number;
  jednostka: string;
  wartoscRef: number;
  pricingMode: "INCLUDED_FREE" | "CHARGE_EXTRA";
  selected: boolean;
}

export interface PricingInput {
  variantHali: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  /** Dodatki wybrane przez użytkownika (nazwa + ilość; warunki z bazy dodatków) */
  selectedAdditions: Array<{ nazwa: string; ilosc: number }>;
  /** Obwód w mb – domyślnie 2*(width+length) dla standardu "za mb" */
  perimeterMb?: number;
  /** Auto system rynnowy: mb = 2*(widthM+lengthM) × stawka */
  rainGuttersAuto?: boolean;
  /** Bramy segmentowe */
  gates?: GateInput[];
  /** Auto dopłata za wysokość */
  heightSurchargeAuto?: boolean;
  /** Ręczne dopłaty */
  manualSurcharges?: ManualSurchargeInput[];
  /** Standardy: element → w cenie (INCLUDED_FREE) vs dolicz (CHARGE_EXTRA). Wystarczy element + pricingMode. */
  standardSnapshot?: Array<{ element: string; pricingMode?: "INCLUDED_FREE" | "CHARGE_EXTRA" }>;
}

/** Reason when price was resolved via fallback (area outside defined ranges). */
export type FallbackReason = "AREA_ABOVE_MAX" | "AREA_BELOW_MIN" | "AREA_GAP";

export interface BasePriceResult {
  matched: true;
  row: CennikRow;
  cenaPerM2: number;
  totalBase: number;
  areaM2: number;
  variantNazwa: string;
  /** True when area was outside all ranges and we used fallback range. */
  fallbackUsed?: boolean;
  fallbackReason?: FallbackReason;
  /** Chosen range when fallback was used (area_min_m2, area_max_m2). */
  fallbackInfo?: { area_min_m2: number; area_max_m2: number };
}

export interface BasePriceNoMatch {
  matched: false;
  reason: string;
  details?: { variantHali: string; areaM2: number; availableRanges?: string };
}

export type BasePriceResultType = BasePriceResult | BasePriceNoMatch;

export interface AdditionLine {
  nazwa: string;
  stawka: number;
  jednostka: string;
  ilosc: number;
  total: number;
  warunek?: string;
}

export type StandardPricingMode = "INCLUDED_FREE" | "CHARGE_EXTRA";

export interface StandardLine {
  element: string;
  ilosc: number;
  jednostka: string;
  wartoscRef: number;
  uwagi?: string;
  /** Wartość mb (np. obwód) gdy jednostka mb – do rozpiski */
  mbValue?: number;
  /** W cenie (domyślnie) vs dolicz */
  pricingMode?: StandardPricingMode;
  /** Wartość doliczana gdy pricingMode === "CHARGE_EXTRA" */
  total?: number;
}

export interface PricingResult {
  success: boolean;
  base: BasePriceResultType;
  additions: AdditionLine[];
  standardInPrice: StandardLine[];
  totalAdditions: number;
  totalPln: number;
  errorMessage?: string;
}

export type CennikRowNormalized = Omit<CennikRow, "area_min_m2" | "area_max_m2" | "cena"> & {
  area_min_m2: number;
  area_max_m2: number;
  cena: number;
};

export type DodatkiRowNormalized = Omit<DodatkiRow, "stawka" | "warunek_min" | "warunek_max"> & {
  stawka: number;
  warunek_min?: number;
  warunek_max?: number;
};

export type StandardRowNormalized = Omit<StandardRow, "ilosc" | "wartosc_ref"> & {
  ilosc: number;
  wartosc_ref: number;
};

export interface PricingCacheNormalized {
  cennik: CennikRowNormalized[];
  dodatki: DodatkiRowNormalized[];
  standard: StandardRowNormalized[];
}
