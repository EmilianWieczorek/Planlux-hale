"use strict";
/**
 * Wspólny model konfiguracji szablonu PDF.
 * Źródło prawdy dla preview i finalnego PDF (Planlux-PDF template).
 * Rozszerzalne pod drag&drop i dalsze etapy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ELEMENT_POSITIONS = exports.DEFAULT_PDF_TEMPLATE_CONFIG = void 0;
exports.mergePdfTemplateConfig = mergePdfTemplateConfig;
/** Domyślne wartości odzwierciedlające obecny wygląd Planlux-PDF (OFERTA HANDLOWA). */
exports.DEFAULT_PDF_TEMPLATE_CONFIG = {
    headerImage: null,
    heroTitle: "OFERTA HANDLOWA",
    heroSubtitle: "Oferta przygotowana indywidualnie pod Twoją konfigurację",
    footerText: "PLANLUX • Oferta handlowa",
    importantText: "Cena końcowa zależy od dodatków i warunków montażu.",
    accentColor: "#A80F0F",
    showMetaBox: true,
    showPriceSection: true,
    showSpecsSection: true,
    showContactSection: true,
    headerGradientFrom: undefined,
    headerGradientTo: undefined,
    showRedDots: false,
    shortFooterLine: true,
    elementPositions: undefined,
};
/**
 * Domyślne pozycje elementów zgodne z obecnym layoutem (px, strona 794×1123).
 * Używane jako referencja / reset przy drag&drop. Gdy elementPositions w config jest
 * undefined, template używa wyłącznie CSS (bez tych wartości).
 */
exports.DEFAULT_ELEMENT_POSITIONS = {
    heroTitle: { x: 36, y: 98 },
    heroSubtitle: { x: 36, y: 132 },
    metaBox: { x: 488, y: 22, width: 270 },
    priceCard: { x: 53, y: 260 },
    footer: { x: 36, y: 1083 },
};
/**
 * Bezpieczny merge konfiguracji z domyślnymi.
 * Niezdefiniowane pola w `partial` są uzupełniane z DEFAULT_PDF_TEMPLATE_CONFIG.
 * Nie nadpisuje defaults wartościami undefined – tylko jawne (w tym null).
 */
function mergePdfTemplateConfig(partial) {
    const base = { ...exports.DEFAULT_PDF_TEMPLATE_CONFIG };
    if (partial == null || typeof partial !== "object") {
        return base;
    }
    const keys = Object.keys(partial);
    for (const key of keys) {
        const v = partial[key];
        if (v !== undefined) {
            if (key === "elementPositions" && v != null && typeof v === "object") {
                base[key] = { ...(base.elementPositions ?? {}), ...v };
            }
            else {
                base[key] = v;
            }
        }
    }
    return base;
}
