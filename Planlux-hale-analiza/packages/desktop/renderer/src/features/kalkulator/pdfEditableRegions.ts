/**
 * Hotspoty edycji PDF w Kalkulatorze.
 * Strona 1: tylko cena (priceNet, priceGross).
 * Strona 2: treści (sectionTitle, boxy, notatka).
 * Strona 3: zablokowana.
 */

import type { PdfOverrides } from "../../state/pdfOverrides";

export type PdfFieldId =
  | "page1.priceNet"
  | "page1.priceGross"
  | "page2.boxText1"
  | "page2.boxText2"
  | "page2.boxText3"
  | "page2.boxText4"
  | "page2.note";

export interface EditableRegion {
  page: 1 | 2;
  id: PdfFieldId;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "text" | "textarea" | "number";
}

export const EDITABLE_REGIONS: EditableRegion[] = [
  { page: 1, id: "page1.priceNet", label: "Cena netto", x: 0.08, y: 0.42, w: 0.25, h: 0.05, kind: "number" },
  { page: 1, id: "page1.priceGross", label: "Cena brutto", x: 0.38, y: 0.42, w: 0.25, h: 0.05, kind: "number" },
  { page: 2, id: "page2.boxText1", label: "Box 1 (Dokumentacja)", x: 0.07, y: 0.28, w: 0.4, h: 0.14, kind: "textarea" },
  { page: 2, id: "page2.boxText2", label: "Box 2 (Konstrukcja)", x: 0.52, y: 0.28, w: 0.4, h: 0.14, kind: "textarea" },
  { page: 2, id: "page2.boxText3", label: "Box 3 (Pokrycie dachu)", x: 0.07, y: 0.55, w: 0.4, h: 0.14, kind: "textarea" },
  { page: 2, id: "page2.boxText4", label: "Box 4 (Ściany + stolarka)", x: 0.52, y: 0.55, w: 0.4, h: 0.14, kind: "textarea" },
  { page: 2, id: "page2.note", label: "Notatka handlowca", x: 0.07, y: 0.82, w: 0.86, h: 0.08, kind: "textarea" },
];

export function getRegionsForPage(page: number): EditableRegion[] {
  if (page === 3) return [];
  return EDITABLE_REGIONS.filter((r) => r.page === page);
}

export function getRegionById(id: PdfFieldId): EditableRegion | undefined {
  return EDITABLE_REGIONS.find((r) => r.id === id);
}

export function getValueFromOverrides(overrides: PdfOverrides, id: PdfFieldId): string {
  if (id === "page1.priceNet") return overrides.page1?.priceNet != null ? String(overrides.page1.priceNet) : "";
  if (id === "page1.priceGross") return overrides.page1?.priceGross != null ? String(overrides.page1.priceGross) : "";
  if (id.startsWith("page2.")) {
    const key = id.replace("page2.", "") as keyof NonNullable<PdfOverrides["page2"]>;
    return String(overrides.page2?.[key] ?? "");
  }
  return "";
}

export function setValueInOverrides(overrides: PdfOverrides, id: PdfFieldId, value: string): PdfOverrides {
  if (id === "page1.priceNet") {
    const n = parseFloat(value);
    return { ...overrides, page1: { ...overrides.page1, priceNet: Number.isFinite(n) ? n : undefined } };
  }
  if (id === "page1.priceGross") {
    const n = parseFloat(value);
    return { ...overrides, page1: { ...overrides.page1, priceGross: Number.isFinite(n) ? n : undefined } };
  }
  if (id.startsWith("page2.")) {
    const key = id.replace("page2.", "") as keyof NonNullable<PdfOverrides["page2"]>;
    return { ...overrides, page2: { ...overrides.page2, [key]: value } };
  }
  return overrides;
}
