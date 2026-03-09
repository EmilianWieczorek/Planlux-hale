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
  /** Konstrukcja (PDF: SPECYFIKACJA TECHNICZNA). Źródło: pricing.base.row.Typ_Konstrukcji lub variant. */
  construction_type?: string;
  /** Dach (PDF: SPECYFIKACJA TECHNICZNA). Źródło: pricing.base.row.Typ_Dachu/Dach lub variant. */
  roof_type?: string;
  /** Ściany (PDF: SPECYFIKACJA TECHNICZNA). Źródło: pricing.base.row.Boki lub variant. */
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
}
