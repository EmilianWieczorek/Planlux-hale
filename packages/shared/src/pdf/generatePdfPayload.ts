/**
 * Jednolity typ wejściowy do generowania PDF (Planlux template).
 * Współdzielony przez renderer i main – jeden kontrakt.
 */

export interface GeneratePdfOffer {
  /** Legacy: pełna nazwa klienta (fallback gdy brak companyName/personName). */
  clientName: string;
  clientNip?: string;
  clientEmail?: string;
  clientPhone?: string;
  /** Nazwa firmy. */
  companyName?: string;
  /** Imię i nazwisko (osoba). */
  personName?: string;
  /** Adres klienta. */
  clientAddress?: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  variantNazwa: string;
  variantHali: string;
  /** Konstrukcja (PDF). Źródło: payload.technicalSpec (main process z pricing_surface). */
  construction_type?: string;
  /** Dach (PDF). Źródło: payload.technicalSpec (main process z pricing_surface). */
  roof_type?: string;
  /** Ściany (PDF). Źródło: payload.technicalSpec (main process z pricing_surface). */
  walls?: string;
}

export interface GeneratePdfPricingBase {
  totalBase: number;
  cenaPerM2?: number;
  row?: {
    Typ_Konstrukcji?: string;
    Typ_Dachu?: string;
    Dach?: string;
    Boki?: string;
  };
}

export interface GeneratePdfAddition {
  nazwa: string;
  stawka: number;
  jednostka: string;
  ilosc: number;
  total: number;
  warunek?: string;
}

export interface GeneratePdfStandardInPrice {
  element: string;
  ilosc: number;
  jednostka: string;
  wartoscRef: number;
  uwagi?: string;
}

export interface GeneratePdfPricing {
  base?: GeneratePdfPricingBase;
  additions?: GeneratePdfAddition[];
  standardInPrice?: GeneratePdfStandardInPrice[];
  totalPln: number;
}

/** Technical spec for PDF SPECYFIKACJA TECHNICZNA. Single source: main process resolver (pricing_surface). */
export interface GeneratePdfTechnicalSpec {
  construction_type: string;
  roof_type: string;
  walls: string;
}

/** Payload przekazywany do pdf:generate – dane oferty + wycena. */
export interface GeneratePdfPayload {
  userId?: string;
  offer: GeneratePdfOffer;
  pricing: GeneratePdfPricing;
  offerNumber: string;
  sellerName?: string;
  sellerEmail?: string;
  sellerPhone?: string;
  clientAddressOrInstall?: string;
  /** Technical spec (Konstrukcja, Dach, Ściany). Set by main process from pricing_surface; never from pricing.base.row. */
  technicalSpec?: GeneratePdfTechnicalSpec;
}
