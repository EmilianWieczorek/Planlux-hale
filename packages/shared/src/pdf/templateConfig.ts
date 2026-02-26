/**
 * Wspólny model konfiguracji szablonu PDF.
 * Źródło prawdy dla preview i finalnego PDF (Planlux-PDF template).
 * Rozszerzalne pod drag&drop i dalsze etapy.
 */

/** Widoczność sekcji na stronie oferty (meta box, ceny, specyfikacja, kontakt). */
export interface PdfSectionVisibility {
  showMetaBox: boolean;
  showPriceSection: boolean;
  showSpecsSection: boolean;
  showContactSection: boolean;
}

/** Teksty konfigurowalne w szablonie (hero, stopka, ważna informacja). */
export interface PdfCustomTexts {
  heroTitle: string;
  heroSubtitle: string;
  footerText: string;
  importantText: string;
}

/**
 * Identyfikatory elementów strony oferty, które mogą mieć pozycję (przyszły drag&drop).
 * Mapowanie: heroTitle → .hero__title, heroSubtitle → .hero__sub, metaBox → .hero__meta,
 * priceCard → .price-card, footer → .footer
 */
export type PdfElementPositionId =
  | "heroTitle"
  | "heroSubtitle"
  | "metaBox"
  | "priceCard"
  | "footer";

/** Pozycja i opcjonalny rozmiar elementu (px). Używane gdy elementPositions jest ustawione. */
export interface PdfElementPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/** Opcjonalne pozycje elementów. undefined = layout z CSS (domyślny). */
export type PdfElementPositions = Partial<Record<PdfElementPositionId, PdfElementPosition>>;

/**
 * Pełna konfiguracja szablonu PDF.
 * Pola tekstowe + widoczność sekcji + opcjonalny akcent, obrazek headera, gradient i pozycje elementów.
 */
export interface PdfTemplateConfig extends PdfCustomTexts, PdfSectionVisibility {
  /** Ścieżka/URL obrazka headera (hero). null = domyślny z template (np. hero-bg-print-safe.png). */
  headerImage: string | null;
  /** Kolor akcentu (hex). Opcjonalny – template ma własny w CSS. */
  accentColor?: string;
  /** Gradient headera (od). Gdy ustawione z headerGradientTo – nadpisuje tło hero. */
  headerGradientFrom?: string;
  /** Gradient headera (do). */
  headerGradientTo?: string;
  /** Czy pokazywać czerwone kropki przy pill (dodatki). Domyślnie false. */
  showRedDots?: boolean;
  /** Czy stopka ma pełną linię (border-top). true = krótsza/bez, false = pełna. Domyślnie true = krótsza. */
  shortFooterLine?: boolean;
  /**
   * Pozycje elementów (px). Gdy brak/undefined – używany jest domyślny layout z CSS.
   * Przygotowane pod przyszły drag&drop w edytorze.
   */
  elementPositions?: PdfElementPositions;
}

/** Domyślne wartości odzwierciedlające obecny wygląd Planlux-PDF (OFERTA HANDLOWA). */
export const DEFAULT_PDF_TEMPLATE_CONFIG: PdfTemplateConfig = {
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
export const DEFAULT_ELEMENT_POSITIONS: PdfElementPositions = {
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
export function mergePdfTemplateConfig(
  partial?: Partial<PdfTemplateConfig> | null
): PdfTemplateConfig {
  const base = { ...DEFAULT_PDF_TEMPLATE_CONFIG };
  if (partial == null || typeof partial !== "object") {
    return base;
  }
  const keys = Object.keys(partial) as (keyof PdfTemplateConfig)[];
  for (const key of keys) {
    const v = partial[key];
    if (v !== undefined) {
      if (key === "elementPositions" && v != null && typeof v === "object") {
        (base as Record<string, unknown>)[key] = { ...(base.elementPositions ?? {}), ...v };
      } else {
        (base as Record<string, unknown>)[key] = v;
      }
    }
  }
  return base;
}
