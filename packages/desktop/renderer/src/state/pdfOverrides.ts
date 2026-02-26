/**
 * pdfOverrides – minimalne nadpisania PDF w Kalkulatorze.
 * Strona 1: tylko cena (manual override).
 * Strona 2: treści (sectionTitle, boxy, notatka).
 * Strona 3: zawsze stała.
 */

export interface PdfOverridesPage1 {
  priceNet?: number;
  priceGross?: number;
}

export interface PdfOverridesPage2 {
  sectionTitle?: string;
  boxText1?: string;
  boxText2?: string;
  boxText3?: string;
  boxText4?: string;
  note?: string;
}

export interface PdfOverrides {
  page1?: PdfOverridesPage1;
  page2?: PdfOverridesPage2;
}

export const DEFAULT_PDF_OVERRIDES_PAGE2: PdfOverridesPage2 = {
  sectionTitle: "SPECYFIKACJA TECHNICZNA",
  boxText1:
    "Projekt konstrukcji – 3 egzemplarze.\nProjekt fundamentów – 3 egzemplarze (jeśli dotyczy).\nDokumentacja montażowa i zestawienie elementów.",
  boxText2:
    "Konstrukcja stalowa dopasowana do wymiarów i obciążeń.\nPołączenia skręcane – szybki montaż i serwis.\nZabezpieczenie antykorozyjne: ocynk ogniowy.",
  boxText3:
    "Materiał: PVC 880 g/m² z atestem niepalności.\nWykończenia i uszczelnienia zapewniające szczelność.\nMożliwość doposażenia: świetliki / klapy / wzmocnienia.",
  boxText4:
    "Ściany boczne: plandeka / płyta (zgodnie z konfiguracją).\nStolarka: bramy i drzwi w standardzie wg ustaleń.\nObróbki i wykończenia naroży – estetyka i trwałość.",
  note: "",
};

export function mergePdfOverrides(partial?: Partial<PdfOverrides> | null): PdfOverrides {
  if (!partial || typeof partial !== "object") return {};
  const out: PdfOverrides = {};
  if (partial.page1 && typeof partial.page1 === "object") {
    out.page1 = {};
    if (typeof partial.page1.priceNet === "number") out.page1.priceNet = partial.page1.priceNet;
    if (typeof partial.page1.priceGross === "number") out.page1.priceGross = partial.page1.priceGross;
  }
  if (partial.page2 && typeof partial.page2 === "object") {
    out.page2 = { ...DEFAULT_PDF_OVERRIDES_PAGE2, ...partial.page2 } as PdfOverridesPage2;
  }
  return out;
}
