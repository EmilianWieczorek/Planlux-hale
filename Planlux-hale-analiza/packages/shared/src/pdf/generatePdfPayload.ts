/**
 * Jednolity typ wejściowy do generowania PDF (Planlux template).
 * Współdzielony przez renderer i main – jeden kontrakt.
 */

export interface GeneratePdfOffer {
  clientName: string;
  clientNip?: string;
  clientEmail?: string;
  clientPhone?: string;
  widthM: number;
  lengthM: number;
  heightM?: number;
  areaM2: number;
  variantNazwa: string;
  variantHali: string;
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
