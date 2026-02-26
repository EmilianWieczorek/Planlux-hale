/**
 * Edytowalna treść PDF – tylko strony 1 i 2.
 * Strona 3 jest zawsze stała i nie podlega edycji (page3Locked).
 */

export interface PdfEditorPage1Content {
  offerNumber: string;
  clientName: string;
  nip: string;
  email: string;
  phone: string;
  leadText: string;
}

export interface PdfEditorPage2Content {
  sectionTitle: string;
  boxText1: string;
  boxText2: string;
  boxText3: string;
  boxText4: string;
  note: string;
}

export interface PdfEditorContent {
  page1: PdfEditorPage1Content;
  page2: PdfEditorPage2Content;
  /** Strona 3 jest zawsze zablokowana – brak pól edycji. */
  page3Locked: true;
}

export const DEFAULT_PDF_EDITOR_PAGE1: PdfEditorPage1Content = {
  offerNumber: "",
  clientName: "",
  nip: "",
  email: "",
  phone: "",
  leadText: "",
};

export const DEFAULT_PDF_EDITOR_PAGE2: PdfEditorPage2Content = {
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

export const DEFAULT_PDF_EDITOR_CONTENT: PdfEditorContent = {
  page1: { ...DEFAULT_PDF_EDITOR_PAGE1 },
  page2: { ...DEFAULT_PDF_EDITOR_PAGE2 },
  page3Locked: true,
};

/**
 * Bezpieczny merge – brakujące pola uzupełniane z defaults.
 */
export function mergePdfEditorContent(
  partial?: Partial<PdfEditorContent> | null
): PdfEditorContent {
  const base: PdfEditorContent = {
    page1: { ...DEFAULT_PDF_EDITOR_PAGE1 },
    page2: { ...DEFAULT_PDF_EDITOR_PAGE2 },
    page3Locked: true,
  };
  if (partial == null || typeof partial !== "object") return base;
  if (partial.page1 && typeof partial.page1 === "object") {
    base.page1 = { ...base.page1 };
    for (const k of Object.keys(partial.page1) as (keyof PdfEditorPage1Content)[]) {
      const v = partial.page1[k];
      if (v !== undefined) base.page1[k] = String(v);
    }
  }
  if (partial.page2 && typeof partial.page2 === "object") {
    base.page2 = { ...base.page2 };
    for (const k of Object.keys(partial.page2) as (keyof PdfEditorPage2Content)[]) {
      const v = partial.page2[k];
      if (v !== undefined) base.page2[k] = String(v);
    }
  }
  return base;
}
