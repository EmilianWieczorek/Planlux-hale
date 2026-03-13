"use strict";
/**
 * Edytowalna treść PDF – tylko strony 1 i 2.
 * Strona 3 jest zawsze stała i nie podlega edycji (page3Locked).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PDF_EDITOR_CONTENT = exports.DEFAULT_PDF_EDITOR_PAGE2 = exports.DEFAULT_PDF_EDITOR_PAGE1 = void 0;
exports.mergePdfEditorContent = mergePdfEditorContent;
exports.DEFAULT_PDF_EDITOR_PAGE1 = {
    offerNumber: "",
    clientName: "",
    nip: "",
    email: "",
    phone: "",
    leadText: "",
};
exports.DEFAULT_PDF_EDITOR_PAGE2 = {
    sectionTitle: "SPECYFIKACJA TECHNICZNA",
    boxText1: "Projekt konstrukcji – 3 egzemplarze.\nProjekt fundamentów – 3 egzemplarze (jeśli dotyczy).\nDokumentacja montażowa i zestawienie elementów.",
    boxText2: "Konstrukcja stalowa dopasowana do wymiarów i obciążeń.\nPołączenia skręcane – szybki montaż i serwis.\nZabezpieczenie antykorozyjne: ocynk ogniowy.",
    boxText3: "Materiał: PVC 880 g/m² z atestem niepalności.\nWykończenia i uszczelnienia zapewniające szczelność.\nMożliwość doposażenia: świetliki / klapy / wzmocnienia.",
    boxText4: "Ściany boczne: plandeka / płyta (zgodnie z konfiguracją).\nStolarka: bramy i drzwi w standardzie wg ustaleń.\nObróbki i wykończenia naroży – estetyka i trwałość.",
    note: "",
};
exports.DEFAULT_PDF_EDITOR_CONTENT = {
    page1: { ...exports.DEFAULT_PDF_EDITOR_PAGE1 },
    page2: { ...exports.DEFAULT_PDF_EDITOR_PAGE2 },
    page3Locked: true,
};
/**
 * Bezpieczny merge – brakujące pola uzupełniane z defaults.
 */
function mergePdfEditorContent(partial) {
    const base = {
        page1: { ...exports.DEFAULT_PDF_EDITOR_PAGE1 },
        page2: { ...exports.DEFAULT_PDF_EDITOR_PAGE2 },
        page3Locked: true,
    };
    if (partial == null || typeof partial !== "object")
        return base;
    if (partial.page1 && typeof partial.page1 === "object") {
        base.page1 = { ...base.page1 };
        for (const k of Object.keys(partial.page1)) {
            const v = partial.page1[k];
            if (v !== undefined)
                base.page1[k] = String(v);
        }
    }
    if (partial.page2 && typeof partial.page2 === "object") {
        base.page2 = { ...base.page2 };
        for (const k of Object.keys(partial.page2)) {
            const v = partial.page2[k];
            if (v !== undefined)
                base.page2[k] = String(v);
        }
    }
    return base;
}
