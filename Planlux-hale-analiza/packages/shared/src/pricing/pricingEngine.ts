/**
 * Silnik wyceny: dopasowanie cennika po wariantcie i powierzchni (m²).
 * Brak logiki max_width – tylko zakresy area_min_m2 / area_max_m2.
 * Fallback: powierzchnia powyżej max → stawka z najwyższego progu; poniżej min → z najniższego.
 */

import type { CennikRow, DodatkiRow, StandardRow } from "../api/types";
import type {
  PricingInput,
  BasePriceResult,
  BasePriceNoMatch,
  AdditionLine,
  StandardLine,
  PricingResult,
  CennikRowNormalized,
  DodatkiRowNormalized,
  StandardRowNormalized,
  FallbackReason,
} from "./types";
import { toNumber, normalizeJednostka } from "./normalize";

function normalizeCennik(rows: CennikRow[]): CennikRowNormalized[] {
  return rows.map((r) => ({
    ...r,
    area_min_m2: toNumber(r.area_min_m2),
    area_max_m2: toNumber(r.area_max_m2),
    cena: toNumber(r.cena),
  }));
}

function normalizeDodatki(rows: DodatkiRow[]): DodatkiRowNormalized[] {
  return rows.map((r) => ({
    ...r,
    stawka: toNumber(r.stawka),
    warunek_min: r.warunek_min !== undefined && r.warunek_min !== "" ? toNumber(r.warunek_min) : undefined,
    warunek_max: r.warunek_max !== undefined && r.warunek_max !== "" ? toNumber(r.warunek_max) : undefined,
  }));
}

function normalizeStandard(rows: StandardRow[]): StandardRowNormalized[] {
  return rows
    .filter((r) => r?.wariant_hali && r?.element)
    .map((r) => ({
      ...r,
      ilosc: toNumber(r.ilosc) || 1,
      wartosc_ref: toNumber(r.wartosc_ref),
    }));
}

/**
 * Match base price for one variant by area only.
 * Inputs: variant, widthM, lengthM → areaM2 = widthM * lengthM.
 * Returns matched row or fallback (AREA_ABOVE_MAX / AREA_BELOW_MIN / AREA_GAP), or no-match when zero rows for variant.
 */
function matchBaseRow(
  cennik: CennikRowNormalized[],
  variantHali: string,
  areaM2: number
): BasePriceResult | BasePriceNoMatch {
  const rows = cennik.filter((r) => r.wariant_hali === variantHali);

  if (rows.length === 0) {
    return {
      matched: false,
      reason: "Brak ceny – brak wariantu w cenniku",
      details: {
        variantHali: variantHali,
        areaM2: areaM2,
        availableRanges: "brak wariantu w cenniku",
      },
    };
  }

  // Normal match: area_min_m2 <= areaM2 <= area_max_m2
  const normalMatches = rows.filter(
    (r) => areaM2 >= r.area_min_m2 && areaM2 <= r.area_max_m2
  );

  if (normalMatches.length > 0) {
    // Multiple matches: choose tightest range (smallest span), then smallest area_max_m2
    const sorted = [...normalMatches].sort((a, b) => {
      const spanA = a.area_max_m2 - a.area_min_m2;
      const spanB = b.area_max_m2 - b.area_min_m2;
      if (spanA !== spanB) return spanA - spanB;
      return a.area_max_m2 - b.area_max_m2;
    });
    const row = sorted[0];
    const totalBase = row.cena * areaM2;
    return {
      matched: true,
      row,
      cenaPerM2: row.cena,
      totalBase,
      areaM2,
      variantNazwa: row.Nazwa ?? variantHali,
    };
  }

  // No normal match: fallback by position vs ranges
  const sortedByMax = [...rows].sort((a, b) => a.area_max_m2 - b.area_max_m2);
  const sortedByMin = [...rows].sort((a, b) => a.area_min_m2 - b.area_min_m2);
  const maxAreaMax = sortedByMax[sortedByMax.length - 1].area_max_m2;
  const minAreaMin = sortedByMin[0].area_min_m2;

  let chosenRow: CennikRowNormalized;
  let fallbackReason: FallbackReason;
  let fallbackInfo: { area_min_m2: number; area_max_m2: number };

  if (areaM2 > maxAreaMax) {
    chosenRow = sortedByMax[sortedByMax.length - 1];
    fallbackReason = "AREA_ABOVE_MAX";
    fallbackInfo = { area_min_m2: chosenRow.area_min_m2, area_max_m2: chosenRow.area_max_m2 };
  } else if (areaM2 < minAreaMin) {
    chosenRow = sortedByMin[0];
    fallbackReason = "AREA_BELOW_MIN";
    fallbackInfo = { area_min_m2: chosenRow.area_min_m2, area_max_m2: chosenRow.area_max_m2 };
  } else {
    // Area in a gap between ranges: pick row with nearest boundary
    let best = rows[0];
    let bestDist = Infinity;
    for (const r of rows) {
      const distToMax = Math.abs(areaM2 - r.area_max_m2);
      const distToMin = Math.abs(areaM2 - r.area_min_m2);
      const d = Math.min(distToMax, distToMin);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    chosenRow = best;
    fallbackReason = "AREA_GAP";
    fallbackInfo = { area_min_m2: chosenRow.area_min_m2, area_max_m2: chosenRow.area_max_m2 };
  }

  const totalBase = chosenRow.cena * areaM2;
  return {
    matched: true,
    row: chosenRow,
    cenaPerM2: chosenRow.cena,
    totalBase,
    areaM2,
    variantNazwa: chosenRow.Nazwa ?? variantHali,
    fallbackUsed: true,
    fallbackReason,
    fallbackInfo,
  };
}

function satisfiesCondition(
  warunekType: string | undefined,
  warunekMin: number | undefined,
  warunekMax: number | undefined,
  heightM: number | undefined
): boolean {
  if (!warunekType || heightM == null) return true;
  const h = heightM;
  if (warunekType === "HEIGHT_RANGE" || warunekType === "RANGE") {
    if (warunekMin != null && warunekMax != null) return h >= warunekMin && h <= warunekMax;
    if (warunekMin != null) return h >= warunekMin;
    if (warunekMax != null) return h <= warunekMax;
  }
  return true;
}

function computeAdditions(
  dodatki: DodatkiRowNormalized[],
  variantHali: string,
  input: PricingInput,
  areaM2: number
): AdditionLine[] {
  const lines: AdditionLine[] = [];
  const forVariant = dodatki.filter((d) => d.wariant_hali === variantHali);

  for (const sel of input.selectedAdditions) {
    const candidates = forVariant.filter((d) => d.nazwa === sel.nazwa);
    const def = candidates.find((d) =>
      satisfiesCondition(d.warunek_type, d.warunek_min, d.warunek_max, input.heightM)
    ) ?? candidates.find((d) => !d.warunek_type);
    if (!def) continue;

    let total = 0;
    const stawka = def.stawka;
    const j = normalizeJednostka(def.jednostka);

    if (j === "m2") total = stawka * (sel.ilosc > 0 ? sel.ilosc : areaM2);
    else if (j === "mb") total = stawka * sel.ilosc;
    else if (j === "kpl") total = stawka * (sel.ilosc > 0 ? sel.ilosc : 1);
    else total = stawka * (sel.ilosc > 0 ? sel.ilosc : 1);

    lines.push({
      nazwa: def.nazwa,
      stawka,
      jednostka: def.jednostka,
      ilosc: sel.ilosc > 0 ? sel.ilosc : (j === "m2" ? areaM2 : 1),
      total,
      warunek: def.warunek,
    });
  }

  return lines;
}

/** Rynny mb, bramy segmentowe, dopłata za wysokość, ręczne dopłaty. */
function computeAdvancedAdditions(
  dodatki: DodatkiRowNormalized[],
  variantHali: string,
  input: PricingInput,
  perimeterMb: number
): AdditionLine[] {
  const lines: AdditionLine[] = [];
  const forVariant = dodatki.filter((d) => d.wariant_hali === variantHali);

  if (input.rainGuttersAuto) {
    const rynny = forVariant.find(
      (d) => /rynny|system\s*rynnowy/i.test(d.nazwa) && normalizeJednostka(d.jednostka) === "mb"
    );
    if (rynny) {
      lines.push({
        nazwa: rynny.nazwa,
        stawka: rynny.stawka,
        jednostka: "mb",
        ilosc: perimeterMb,
        total: rynny.stawka * perimeterMb,
        warunek: rynny.warunek,
      });
    }
  }

  if (input.gates?.length) {
    const bramy = forVariant.find(
      (d) => /bramy\s*segmentowe|brama\s*segmentowa/i.test(d.nazwa)
    );
    if (bramy) {
      const stawka = bramy.stawka;
      for (const g of input.gates) {
        if (g.quantity > 0 && g.width > 0 && g.height > 0) {
          const areaM2 = g.width * g.height;
          const total = stawka * areaM2 * g.quantity;
          lines.push({
            nazwa: `${bramy.nazwa} ${g.width}×${g.height} m`,
            stawka,
            jednostka: "m²",
            ilosc: areaM2 * g.quantity,
            total,
            warunek: bramy.warunek,
          });
        }
      }
    }
  }

  /** Dopłata za wysokość: auto gdy wysokość spełnia warunek. heightSurchargeAuto=false wyłącza (override). */
  if (input.heightSurchargeAuto !== false && input.heightM != null) {
    const doplata = forVariant.find(
      (d) => /dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(d.nazwa) &&
        satisfiesCondition(d.warunek_type, d.warunek_min, d.warunek_max, input.heightM)
    );
    if (doplata) {
      lines.push({
        nazwa: doplata.nazwa,
        stawka: doplata.stawka,
        jednostka: doplata.jednostka ?? "szt",
        ilosc: 1,
        total: doplata.stawka,
        warunek: doplata.warunek,
      });
    }
  }

  for (const m of input.manualSurcharges ?? []) {
    if (m.amount > 0 && m.description?.trim()) {
      lines.push({
        nazwa: m.description.trim(),
        stawka: m.amount,
        jednostka: "szt",
        ilosc: 1,
        total: m.amount,
      });
    }
  }

  return lines;
}

function getStandardInPrice(
  standard: StandardRowNormalized[],
  variantHali: string,
  perimeterMb?: number,
  standardSnapshot?: Array<{ element: string; pricingMode?: "INCLUDED_FREE" | "CHARGE_EXTRA" }>
): StandardLine[] {
  const jmb = (s: StandardRowNormalized) =>
    ((s.Jednostka ?? s.jednostka ?? "szt") as string).toLowerCase() === "mb";
  return standard
    .filter((s) => s.wariant_hali === variantHali)
    .map((s) => {
      const jednostka = (s.Jednostka ?? s.jednostka ?? "szt") as string;
      const ilosc = s.ilosc ?? 1;
      const mbValue = jmb(s) && perimeterMb != null ? perimeterMb : undefined;
      const pricingMode = standardSnapshot?.find((sn) => sn.element === s.element)?.pricingMode ?? "INCLUDED_FREE";
      const qty = mbValue != null ? mbValue : ilosc;
      const total = pricingMode === "CHARGE_EXTRA" ? (s.wartosc_ref ?? 0) * qty : undefined;
      return {
        element: s.element,
        ilosc,
        jednostka,
        wartoscRef: s.wartosc_ref,
        uwagi: s.uwagi,
        mbValue,
        pricingMode,
        total,
      };
    });
}

/** Build user-friendly error message for no-match (no raw JSON). */
function formatNoMatchMessage(base: BasePriceNoMatch): string {
  const msg = base.reason;
  if (base.details?.availableRanges && base.details.availableRanges !== "brak wariantu w cenniku") {
    return `${msg} Dostępne progi: ${base.details.availableRanges}.`;
  }
  return msg;
}

export interface PricingEngineData {
  cennik: CennikRow[];
  dodatki: DodatkiRow[];
  standard: StandardRow[];
}

export function calculatePrice(
  data: PricingEngineData,
  input: PricingInput
): PricingResult {
  const cennik = normalizeCennik(data.cennik);
  const dodatki = normalizeDodatki(data.dodatki);
  const standard = normalizeStandard(data.standard);

  const base = matchBaseRow(cennik, input.variantHali, input.areaM2);

  if (!base.matched) {
    return {
      success: false,
      base,
      additions: [],
      standardInPrice: [],
      totalAdditions: 0,
      totalPln: 0,
      errorMessage: formatNoMatchMessage(base),
    };
  }

  const perimeterMb = input.perimeterMb ?? 2 * (input.widthM + input.lengthM);
  const additions = [
    ...computeAdditions(dodatki, input.variantHali, input, input.areaM2),
    ...computeAdvancedAdditions(dodatki, input.variantHali, input, perimeterMb),
  ];
  const standardSnapshot = input.standardSnapshot?.map((sn) => ({
    element: sn.element,
    pricingMode: sn.pricingMode ?? "INCLUDED_FREE",
  }));
  const standardInPrice = getStandardInPrice(standard, input.variantHali, perimeterMb, standardSnapshot);
  const standardChargeExtra = standardInPrice.filter((s) => s.pricingMode === "CHARGE_EXTRA" && s.total != null);
  const totalAdditions =
    additions.reduce((sum, a) => sum + a.total, 0) +
    standardChargeExtra.reduce((sum, s) => sum + (s.total ?? 0), 0);
  const totalPln = base.totalBase + totalAdditions;

  return {
    success: true,
    base,
    additions,
    standardInPrice,
    totalAdditions,
    totalPln,
  };
}

/**
 * Self-test: run with node after build, e.g.
 * node -e "require('@planlux/shared').runPricingSelfTest()"
 */
export function runPricingSelfTest(): boolean {
  const cennik: CennikRow[] = [
    { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 100, area_max_m2: 500, cena: 100 },
    { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 501, area_max_m2: 1000, cena: 90 },
    { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 1001, area_max_m2: 2000, cena: 80 },
  ];
  const data: PricingEngineData = { cennik, dodatki: [], standard: [] };

  // Within range -> normal match
  const r1 = calculatePrice(data, {
    variantHali: "V1",
    widthM: 20,
    lengthM: 25,
    areaM2: 500,
    selectedAdditions: [],
  });
  if (!r1.success || r1.base.matched !== true || (r1.base as BasePriceResult).fallbackUsed) {
    console.error("Self-test fail: within range should be normal match", r1);
    return false;
  }
  if ((r1.base as BasePriceResult).cenaPerM2 !== 100 || r1.base.totalBase !== 50000) {
    console.error("Self-test fail: wrong price for 500 m²", r1);
    return false;
  }

  // Area above max -> fallback to largest range
  const r2 = calculatePrice(data, {
    variantHali: "V1",
    widthM: 50,
    lengthM: 50,
    areaM2: 2500,
    selectedAdditions: [],
  });
  if (!r2.success || !r2.base.matched) {
    console.error("Self-test fail: above max should still succeed with fallback", r2);
    return false;
  }
  const base2 = r2.base as BasePriceResult;
  if (!base2.fallbackUsed || base2.fallbackReason !== "AREA_ABOVE_MAX") {
    console.error("Self-test fail: expected fallback AREA_ABOVE_MAX", r2);
    return false;
  }
  if (base2.fallbackInfo?.area_max_m2 !== 2000 || base2.cenaPerM2 !== 80) {
    console.error("Self-test fail: should use 80 zł/m² from 1001–2000 range", r2);
    return false;
  }

  // Area below min -> fallback to smallest range
  const r3 = calculatePrice(data, {
    variantHali: "V1",
    widthM: 5,
    lengthM: 10,
    areaM2: 50,
    selectedAdditions: [],
  });
  if (!r3.success || !r3.base.matched) {
    console.error("Self-test fail: below min should still succeed with fallback", r3);
    return false;
  }
  const base3 = r3.base as BasePriceResult;
  if (!base3.fallbackUsed || base3.fallbackReason !== "AREA_BELOW_MIN") {
    console.error("Self-test fail: expected fallback AREA_BELOW_MIN", r3);
    return false;
  }
  if (base3.fallbackInfo?.area_min_m2 !== 100 || base3.cenaPerM2 !== 100) {
    console.error("Self-test fail: should use 100 zł/m² from 100–500 range", r3);
    return false;
  }

  // Zero rows for variant -> no match
  const r4 = calculatePrice(data, {
    variantHali: "UNKNOWN",
    widthM: 10,
    lengthM: 10,
    areaM2: 100,
    selectedAdditions: [],
  });
  if (r4.success || r4.base.matched) {
    console.error("Self-test fail: unknown variant should not match", r4);
    return false;
  }

  // Area in gap between ranges -> fallback AREA_GAP
  const cennikGap: CennikRow[] = [
    { wariant_hali: "VG", Nazwa: "VG", area_min_m2: 100, area_max_m2: 500, cena: 100 },
    { wariant_hali: "VG", Nazwa: "VG", area_min_m2: 701, area_max_m2: 1000, cena: 90 },
  ];
  const dataGap: PricingEngineData = { cennik: cennikGap, dodatki: [], standard: [] };
  const r5 = calculatePrice(dataGap, {
    variantHali: "VG",
    widthM: 26,
    lengthM: 26,
    areaM2: 676,
    selectedAdditions: [],
  });
  if (!r5.success || !r5.base.matched) {
    console.error("Self-test fail: gap should succeed with fallback", r5);
    return false;
  }
  const base5 = r5.base as BasePriceResult;
  if (!base5.fallbackUsed || base5.fallbackReason !== "AREA_GAP") {
    console.error("Self-test fail: expected fallback AREA_GAP", r5);
    return false;
  }

  // Stawki as string "4 000zł" -> normalized to number
  const cennikStr: CennikRow[] = [
    { wariant_hali: "VS", Nazwa: "VS", area_min_m2: 50, area_max_m2: 200, cena: "4 000zł" as unknown as number },
  ];
  const dataStr: PricingEngineData = { cennik: cennikStr, dodatki: [], standard: [] };
  const r6 = calculatePrice(dataStr, {
    variantHali: "VS",
    widthM: 10,
    lengthM: 10,
    areaM2: 100,
    selectedAdditions: [],
  });
  if (!r6.success || !r6.base.matched) {
    console.error("Self-test fail: string cena should match", r6);
    return false;
  }
  if ((r6.base as BasePriceResult).cenaPerM2 !== 4000 || (r6.base as BasePriceResult).totalBase !== 400_000) {
    console.error("Self-test fail: string cena 4000 * 100 = 400000", r6);
    return false;
  }

  console.log("Pricing self-test OK");
  return true;
}
