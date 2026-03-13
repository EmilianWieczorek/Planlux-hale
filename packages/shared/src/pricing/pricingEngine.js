"use strict";
/**
 * Silnik wyceny: dopasowanie cennika po wariantcie i powierzchni (m²).
 * Brak logiki max_width – tylko zakresy area_min_m2 / area_max_m2.
 * Fallback: powierzchnia powyżej max → stawka z najwyższego progu; poniżej min → z najniższego.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePrice = calculatePrice;
exports.runPricingSelfTest = runPricingSelfTest;
const normalize_1 = require("./normalize");
const parseHeightCondition_1 = require("./parseHeightCondition");
function normalizeCennik(rows) {
    return rows.map((r) => ({
        ...r,
        area_min_m2: (0, normalize_1.toNumber)(r.area_min_m2),
        area_max_m2: (0, normalize_1.toNumber)(r.area_max_m2),
        cena: (0, normalize_1.toNumber)(r.cena),
    }));
}
function normalizeDodatki(rows) {
    return rows.map((r) => ({
        ...r,
        stawka: (0, normalize_1.toNumber)(r.stawka),
        warunek_min: r.warunek_min !== undefined && r.warunek_min !== "" ? (0, normalize_1.toNumber)(r.warunek_min) : undefined,
        warunek_max: r.warunek_max !== undefined && r.warunek_max !== "" ? (0, normalize_1.toNumber)(r.warunek_max) : undefined,
    }));
}
function normalizeStandard(rows) {
    return rows
        .filter((r) => r?.wariant_hali && r?.element)
        .map((r) => ({
        ...r,
        ilosc: (0, normalize_1.toNumber)(r.ilosc) || 1,
        wartosc_ref: (0, normalize_1.toNumber)(r.wartosc_ref),
    }));
}
/**
 * Najwyższy dostępny próg powierzchni (area_max_m2) dla wariantu w cenniku.
 * Używane do ograniczenia pricingArea: cena bazowa nie jest liczona od powierzchni większej niż ten próg.
 */
function getMaxSupportedArea(cennik, variantHali) {
    const rows = cennik.filter((r) => r.wariant_hali === variantHali);
    if (rows.length === 0)
        return 0;
    let max = 0;
    for (const r of rows) {
        if (r.area_max_m2 > max)
            max = r.area_max_m2;
    }
    return max;
}
/**
 * Match base price for one variant by area only.
 * Inputs: variant, widthM, lengthM → areaM2 = widthM * lengthM.
 * Returns matched row or fallback (AREA_ABOVE_MAX / AREA_BELOW_MIN / AREA_GAP), or no-match when zero rows for variant.
 */
function matchBaseRow(cennik, variantHali, areaM2) {
    const rows = cennik.filter((r) => r.wariant_hali === variantHali);
    const debug = process.env.LOG_LEVEL === "debug";
    if (rows.length === 0) {
        if (debug) {
            // eslint-disable-next-line no-console
            console.debug("[pricing] no base rows for variant", { variantHali, areaM2 });
        }
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
    const normalMatches = rows.filter((r) => areaM2 >= r.area_min_m2 && areaM2 <= r.area_max_m2);
    if (normalMatches.length > 0) {
        // Multiple matches: choose tightest range (smallest span), then smallest area_max_m2
        const sorted = [...normalMatches].sort((a, b) => {
            const spanA = a.area_max_m2 - a.area_min_m2;
            const spanB = b.area_max_m2 - b.area_min_m2;
            if (spanA !== spanB)
                return spanA - spanB;
            return a.area_max_m2 - b.area_max_m2;
        });
        const row = sorted[0];
        const totalBase = row.cena * areaM2;
        if (debug) {
            // eslint-disable-next-line no-console
            console.debug("[pricing] base tier matched", {
                variantHali,
                areaM2,
                tier: { areaMin: row.area_min_m2, areaMax: row.area_max_m2, cenaPerM2: row.cena, unit: row.stawka_jednostka },
                label: row.Nazwa ?? variantHali,
                sourceRowKeys: Object.keys(row).slice(0, 30),
            });
        }
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
    let chosenRow;
    let fallbackReason;
    let fallbackInfo;
    if (areaM2 > maxAreaMax) {
        chosenRow = sortedByMax[sortedByMax.length - 1];
        fallbackReason = "AREA_ABOVE_MAX";
        fallbackInfo = { area_min_m2: chosenRow.area_min_m2, area_max_m2: chosenRow.area_max_m2 };
    }
    else if (areaM2 < minAreaMin) {
        chosenRow = sortedByMin[0];
        fallbackReason = "AREA_BELOW_MIN";
        fallbackInfo = { area_min_m2: chosenRow.area_min_m2, area_max_m2: chosenRow.area_max_m2 };
    }
    else {
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
    if (debug) {
        // eslint-disable-next-line no-console
        console.debug("[pricing] base tier fallback matched", {
            variantHali,
            areaM2,
            fallbackReason,
            tier: { areaMin: chosenRow.area_min_m2, areaMax: chosenRow.area_max_m2, cenaPerM2: chosenRow.cena, unit: chosenRow.stawka_jednostka },
            label: chosenRow.Nazwa ?? variantHali,
            sourceRowKeys: Object.keys(chosenRow).slice(0, 30),
        });
    }
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
function satisfiesCondition(warunekType, warunekMin, warunekMax, heightM) {
    if (!warunekType || heightM == null)
        return true;
    const h = heightM;
    if (warunekType === "HEIGHT_RANGE" || warunekType === "RANGE") {
        if (warunekMin != null && warunekMax != null)
            return h >= warunekMin && h <= warunekMax;
        if (warunekMin != null)
            return h >= warunekMin;
        if (warunekMax != null)
            return h <= warunekMax;
    }
    return true;
}
function computeAdditions(dodatki, variantHali, input, areaM2) {
    const lines = [];
    const forVariant = dodatki.filter((d) => d.wariant_hali === variantHali);
    for (const sel of input.selectedAdditions) {
        // Dopłata za wysokość jest liczona per variant w computeAdvancedAdditions z addons_surcharges. Nie dublować z selectedAdditions.
        if (isHeightSurchargeAddonName(sel.nazwa ?? ""))
            continue;
        const candidates = forVariant.filter((d) => d.nazwa === sel.nazwa);
        const def = candidates.find((d) => satisfiesCondition(d.warunek_type, d.warunek_min, d.warunek_max, input.heightM)) ?? candidates.find((d) => !d.warunek_type);
        if (!def)
            continue;
        let total = 0;
        const stawka = def.stawka;
        const j = (0, normalize_1.normalizeJednostka)(def.jednostka);
        if (j === "m2")
            total = stawka * (sel.ilosc > 0 ? sel.ilosc : areaM2);
        else if (j === "mb")
            total = stawka * sel.ilosc;
        else if (j === "kpl")
            total = stawka * (sel.ilosc > 0 ? sel.ilosc : 1);
        else
            total = stawka * (sel.ilosc > 0 ? sel.ilosc : 1);
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
/**
 * Czy nazwa addona odpowiada dopłacie za wysokość ściany bocznej (addons_surcharges).
 * Nie hardcodujemy jednej nazwy – dopasowujemy typowe z bazy, np. "Dopłata za wysokość", "Dopłata ściana boczna".
 */
function isHeightSurchargeAddonName(nazwa) {
    if (!nazwa || typeof nazwa !== "string")
        return false;
    const n = nazwa.trim().toLowerCase();
    return (/dopłata\s*za\s*wysokość|doplata\s*za\s*wysokosc/i.test(nazwa) ||
        /dopłata\s*ściana\s*boczna|doplata\s*sciana\s*boczna/i.test(nazwa) ||
        /dopłata\s*za\s*wysokość\s*ściany|doplata\s*za\s*wysokosc\s*sciany/i.test(nazwa));
}
/**
 * Dla dopłaty za wysokość: zwraca zakres { min, max } z addona (warunek lub warunek_min/max).
 */
function getHeightAddonRange(d) {
    if (d.warunek_min != null && d.warunek_max != null && Number.isFinite(d.warunek_min) && Number.isFinite(d.warunek_max)) {
        return { min: d.warunek_min, max: d.warunek_max };
    }
    const parsed = (0, parseHeightCondition_1.parseHeightCondition)(d.warunek ?? "");
    if (parsed?.min != null && parsed?.max != null)
        return { min: parsed.min, max: parsed.max };
    return null;
}
/**
 * Wybiera addon dopłaty za wysokość: dopasowanie do przedziału lub ostatni próg jako otwarty powyżej.
 * Jeśli height > max górnej granicy wszystkich progów, używana jest stawka z ostatniego progu.
 */
function selectHeightSurchargeAddon(heightAddons, heightM) {
    if (heightAddons.length === 0 || heightM == null || !Number.isFinite(heightM))
        return null;
    const withRange = heightAddons
        .map((d) => ({ addon: d, range: getHeightAddonRange(d) }))
        .filter((x) => x.range != null);
    if (withRange.length === 0)
        return null;
    const sorted = [...withRange].sort((a, b) => a.range.max - b.range.max);
    const minOfAll = Math.min(...sorted.map((x) => x.range.min));
    if (heightM < minOfAll)
        return null;
    const match = sorted.find((x) => heightM >= x.range.min && heightM <= x.range.max);
    if (match)
        return { addon: match.addon, fallbackToLastRange: false };
    const maxOfAll = sorted[sorted.length - 1].range.max;
    if (heightM > maxOfAll)
        return { addon: sorted[sorted.length - 1].addon, fallbackToLastRange: true };
    return null;
}
/**
 * Znajduje rekord dopłaty za wysokość dla danego wariantu i wysokości.
 * Tylko rekordy z addons_surcharges dla tego variant i addon_name = dopłata ściana boczna / za wysokość.
 * Jeśli brak rekordów dla wariantu – zwraca null (brak dopłaty).
 */
function findHeightSurchargeForVariantAndHeight(dodatki, variantHali, heightM) {
    const forVariant = dodatki.filter((d) => d.wariant_hali === variantHali);
    const heightAddons = forVariant.filter((d) => isHeightSurchargeAddonName(d.nazwa));
    return selectHeightSurchargeAddon(heightAddons, heightM);
}
/** Rynny mb, bramy segmentowe, dopłata za wysokość, ręczne dopłaty. */
function computeAdvancedAdditions(dodatki, variantHali, input, perimeterMb) {
    const lines = [];
    const forVariant = dodatki.filter((d) => d.wariant_hali === variantHali);
    if (input.rainGuttersAuto) {
        const rynny = forVariant.find((d) => /rynny|system\s*rynnowy/i.test(d.nazwa) && (0, normalize_1.normalizeJednostka)(d.jednostka) === "mb");
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
        const bramy = forVariant.find((d) => /dodatkowa\s*brama\s*segmentowa|bramy\s*segmentowe|brama\s*segmentowa/i.test(d.nazwa));
        if (bramy) {
            const stawkaM2 = bramy.stawka;
            for (const g of input.gates) {
                const width = Number.isFinite(g.width) ? g.width : 0;
                const height = Number.isFinite(g.height) ? g.height : 0;
                const qty = Number.isFinite(g.quantity) ? g.quantity : 0;
                if (qty > 0 && width > 0 && height > 0) {
                    const areaM2 = width * height;
                    const total = stawkaM2 * areaM2 * qty;
                    lines.push({
                        nazwa: `Brama segmentowa ${width} × ${height} – ${qty} szt`,
                        stawka: stawkaM2,
                        jednostka: "m²",
                        ilosc: areaM2 * qty,
                        total,
                        warunek: bramy.warunek,
                    });
                }
            }
        }
    }
    /** Dopłata za wysokość: wyłącznie z addons_surcharges dla aktualnego variant; ostatni próg open-ended. */
    if (input.heightM != null && input.areaM2 != null && input.areaM2 > 0) {
        const selected = findHeightSurchargeForVariantAndHeight(dodatki, variantHali, input.heightM);
        if (selected) {
            const { addon: doplata, fallbackToLastRange } = selected;
            const stawka = doplata.stawka;
            const j = (0, normalize_1.normalizeJednostka)(doplata.jednostka ?? "");
            const hallAreaM2 = input.areaM2;
            const isMkw = j === "m2" || /mkw|m\s*²/i.test(String(doplata.jednostka ?? ""));
            const ilosc = isMkw ? hallAreaM2 : 1;
            const total = isMkw ? Math.round(hallAreaM2 * stawka) : Math.round(stawka);
            const jednostka = isMkw ? "m²" : (doplata.jednostka ?? "szt");
            const warunekDisplay = fallbackToLastRange ? `> ${getHeightAddonRange(doplata)?.max ?? "?"} m` : (doplata.warunek ?? "");
            if (process.env.LOG_LEVEL === "debug") {
                // eslint-disable-next-line no-console
                console.debug("[pricing][height] height surcharge (per variant)", {
                    variant: variantHali,
                    height: input.heightM,
                    matchedAddonName: doplata.nazwa,
                    matchedCondition: doplata.warunek ?? "",
                    matchedRate: stawka,
                    fallbackToLastRange,
                    surchargeTotal: total,
                });
            }
            lines.push({
                nazwa: doplata.nazwa,
                stawka,
                jednostka,
                ilosc,
                total,
                warunek: warunekDisplay || doplata.warunek,
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
function getStandardInPrice(standard, variantHali, perimeterMb, standardSnapshot) {
    const jmb = (s) => (s.Jednostka ?? s.jednostka ?? "szt").toLowerCase() === "mb";
    return standard
        .filter((s) => s.wariant_hali === variantHali)
        .map((s) => {
        const jednostka = (s.Jednostka ?? s.jednostka ?? "szt");
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
function formatNoMatchMessage(base) {
    const msg = base.reason;
    if (base.details?.availableRanges && base.details.availableRanges !== "brak wariantu w cenniku") {
        return `${msg} Dostępne progi: ${base.details.availableRanges}.`;
    }
    return msg;
}
function calculatePrice(data, input) {
    const cennik = normalizeCennik(data.cennik);
    const dodatki = normalizeDodatki(data.dodatki);
    const standard = normalizeStandard(data.standard);
    const realArea = input.areaM2;
    const maxSupportedArea = getMaxSupportedArea(cennik, input.variantHali);
    const pricingArea = maxSupportedArea > 0 ? Math.min(realArea, maxSupportedArea) : realArea;
    const areaPricingCapped = realArea > pricingArea;
    const areaPricingCapValue = areaPricingCapped ? maxSupportedArea : undefined;
    if (process.env.LOG_LEVEL === "debug") {
        // eslint-disable-next-line no-console
        console.debug("[pricing][calculate] area diagnostics", {
            realArea,
            maxSupportedArea,
            pricingArea,
            areaPricingCapped,
        });
        if (areaPricingCapped) {
            // eslint-disable-next-line no-console
            console.debug("[pricing][calculate] capped area applied", {
                areaM2Actual: realArea,
                areaM2Pricing: pricingArea,
                areaPricingCapValue,
            });
        }
    }
    if (maxSupportedArea === 0 && cennik.filter((r) => r.wariant_hali === input.variantHali).length === 0) {
        // eslint-disable-next-line no-console
        console.warn("[pricing][calculate] no rows for variant, cannot determine maxSupportedArea", {
            variantHali: input.variantHali,
        });
    }
    const base = matchBaseRow(cennik, input.variantHali, pricingArea);
    if (process.env.LOG_LEVEL === "debug" && base.matched) {
        const br = base;
        // eslint-disable-next-line no-console
        console.debug("[pricing][calculate] selected pricing threshold", {
            areaM2Pricing: pricingArea,
            tier: br.row ? { areaMin: br.row.area_min_m2, areaMax: br.row.area_max_m2, cenaPerM2: br.cenaPerM2 } : undefined,
        });
    }
    if (!base.matched) {
        return {
            success: false,
            base,
            additions: [],
            standardInPrice: [],
            totalAdditions: 0,
            totalPln: 0,
            areaM2Actual: realArea,
            areaM2Pricing: pricingArea,
            areaPricingCapped: areaPricingCapped || undefined,
            areaPricingCapValue,
            errorMessage: formatNoMatchMessage(base),
        };
    }
    const br = base;
    /** Dla area > maxSupportedArea: stawka za m² z progu (np. 1200), ale cena bazowa = realArea × ta stawka (nie cap powierzchni). */
    const effectiveTotalBase = areaPricingCapped ? Math.round(realArea * br.cenaPerM2) : base.totalBase;
    const baseUnitPriceApplied = br.cenaPerM2;
    if (process.env.LOG_LEVEL === "debug") {
        const basePriceForSourceArea = areaPricingCapped ? pricingArea * br.cenaPerM2 : base.totalBase;
        // eslint-disable-next-line no-console
        console.debug("[pricing][calculate] base price computation", {
            realArea,
            sourceAreaForRate: pricingArea,
            basePriceForSourceArea,
            unitPriceAt1200: br.cenaPerM2,
            computedBasePrice: effectiveTotalBase,
            areaPricingCapped,
        });
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
    const totalAdditions = additions.reduce((sum, a) => sum + a.total, 0) +
        standardChargeExtra.reduce((sum, s) => sum + (s.total ?? 0), 0);
    let totalPln = effectiveTotalBase + totalAdditions;
    /** Automatyczne dopłaty (np. za wysokość) – z addons, ostatni próg otwarty powyżej; prezentacja w UI. */
    const automaticSurcharges = [];
    const heightAddon = additions.find((a) => isHeightSurchargeAddonName(a.nazwa));
    if (heightAddon) {
        const areaM2 = heightAddon.jednostka === "m²" || /mkw|m\s*²/i.test(heightAddon.jednostka) ? heightAddon.ilosc : input.areaM2;
        automaticSurcharges.push({
            name: heightAddon.nazwa,
            condition: (heightAddon.warunek ?? "").trim() || "wysokość w zakresie",
            areaM2,
            ratePerM2: heightAddon.stawka,
            total: heightAddon.total,
        });
    }
    if (process.env.LOG_LEVEL === "debug") {
        // eslint-disable-next-line no-console
        console.debug("[pricing] result", {
            areaM2: input.areaM2,
            pricingArea,
            effectiveBasePrice: effectiveTotalBase,
            totalPrice: totalPln,
            automaticSurchargesCount: automaticSurcharges.length,
        });
    }
    const baseForResult = areaPricingCapped ? { ...base, totalBase: effectiveTotalBase } : base;
    return {
        success: true,
        base: baseForResult,
        additions,
        standardInPrice,
        totalAdditions,
        totalPln,
        automaticSurcharges: automaticSurcharges.length > 0 ? automaticSurcharges : undefined,
        areaM2Actual: realArea,
        areaM2Pricing: pricingArea,
        areaPricingCapped: areaPricingCapped || undefined,
        areaPricingCapValue,
        baseUnitPriceApplied,
    };
}
/**
 * Self-test: run with node after build, e.g.
 * node -e "require('@planlux/shared').runPricingSelfTest()"
 */
function runPricingSelfTest() {
    const cennik = [
        { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 100, area_max_m2: 500, cena: 100 },
        { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 501, area_max_m2: 1000, cena: 90 },
        { wariant_hali: "V1", Nazwa: "V1", area_min_m2: 1001, area_max_m2: 2000, cena: 80 },
    ];
    const data = { cennik, dodatki: [], standard: [] };
    // Within range -> normal match
    const r1 = calculatePrice(data, {
        variantHali: "V1",
        widthM: 20,
        lengthM: 25,
        areaM2: 500,
        selectedAdditions: [],
    });
    if (!r1.success || r1.base.matched !== true || r1.base.fallbackUsed) {
        console.error("Self-test fail: within range should be normal match", r1);
        return false;
    }
    if (r1.base.cenaPerM2 !== 100 || r1.base.totalBase !== 50000) {
        console.error("Self-test fail: wrong price for 500 m²", r1);
        return false;
    }
    // Area above max: stawka z progu 2000 m² (80 zł/m²), cena bazowa = realArea * 80 = 2500 * 80 = 200000
    const r2 = calculatePrice(data, {
        variantHali: "V1",
        widthM: 50,
        lengthM: 50,
        areaM2: 2500,
        selectedAdditions: [],
    });
    if (!r2.success || !r2.base.matched) {
        console.error("Self-test fail: 2500 m² above max tier should succeed", r2);
        return false;
    }
    const base2 = r2.base;
    if (base2.cenaPerM2 !== 80 || base2.totalBase !== 200000) {
        console.error("Self-test fail: unit rate from 2000 m² tier (80 zł/m²), totalBase = 2500*80=200000", r2);
        return false;
    }
    if (!r2.areaPricingCapped || r2.areaM2Actual !== 2500 || r2.areaM2Pricing !== 2000 || r2.areaPricingCapValue !== 2000) {
        console.error("Self-test fail: area diagnostics for capped case", r2);
        return false;
    }
    if (r2.baseUnitPriceApplied !== 80) {
        console.error("Self-test fail: baseUnitPriceApplied should be 80", r2);
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
    const base3 = r3.base;
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
    const cennikGap = [
        { wariant_hali: "VG", Nazwa: "VG", area_min_m2: 100, area_max_m2: 500, cena: 100 },
        { wariant_hali: "VG", Nazwa: "VG", area_min_m2: 701, area_max_m2: 1000, cena: 90 },
    ];
    const dataGap = { cennik: cennikGap, dodatki: [], standard: [] };
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
    const base5 = r5.base;
    if (!base5.fallbackUsed || base5.fallbackReason !== "AREA_GAP") {
        console.error("Self-test fail: expected fallback AREA_GAP", r5);
        return false;
    }
    // Stawki as string "4 000zł" -> normalized to number
    const cennikStr = [
        { wariant_hali: "VS", Nazwa: "VS", area_min_m2: 50, area_max_m2: 200, cena: "4 000zł" },
    ];
    const dataStr = { cennik: cennikStr, dodatki: [], standard: [] };
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
    if (r6.base.cenaPerM2 !== 4000 || r6.base.totalBase !== 400000) {
        console.error("Self-test fail: string cena 4000 * 100 = 400000", r6);
        return false;
    }
    // Height surcharge: last tier open-ended (height 7 > 6 → use rate from 5.01–6 m tier)
    const dodatkiHeight = [
        { wariant_hali: "V1", nazwa: "Dopłata za wysokość", stawka: 15, jednostka: "mkw", warunek: "4,61–5 m" },
        { wariant_hali: "V1", nazwa: "Dopłata za wysokość", stawka: 40, jednostka: "mkw", warunek: "wysokość 5,01-6 m" },
    ];
    const dataHeight = { cennik: data.cennik, dodatki: dodatkiHeight, standard: [] };
    const r7 = calculatePrice(dataHeight, {
        variantHali: "V1",
        widthM: 25,
        lengthM: 40,
        areaM2: 1000,
        heightM: 7,
        selectedAdditions: [],
    });
    if (!r7.success || !r7.base.matched) {
        console.error("Self-test fail: height surcharge case should succeed", r7);
        return false;
    }
    const expectedBase = 90 * 1000;
    const expectedSurcharge = 1000 * 40;
    const heightAddition = r7.additions.find((a) => isHeightSurchargeAddonName(a.nazwa));
    if (r7.base.totalBase !== expectedBase || !heightAddition || heightAddition.total !== expectedSurcharge) {
        console.error("Self-test fail: base 90*1000, height addon with 40 zł/m² for 1000 m²", r7);
        return false;
    }
    if (r7.totalPln !== expectedBase + expectedSurcharge) {
        console.error("Self-test fail: totalPln should be base + 40000 surcharge", { totalPln: r7.totalPln, expected: expectedBase + expectedSurcharge });
        return false;
    }
    console.log("Pricing self-test OK");
    return true;
}
