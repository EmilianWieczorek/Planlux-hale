/**
 * mapOfferDataToPayload: priorytet technicalSpec → baseRow → "(brak danych)".
 * Scenariusze: A) technicalSpec z DB, B) fallback baseRow, C) wszystko "(brak danych)".
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import type { GeneratePdfPayload } from "@planlux/shared";
import { mapOfferDataToPayload } from "./generatePdfFromTemplate";

const BASE_OFFER = {
  clientName: "Test",
  widthM: 20,
  lengthM: 40,
  heightM: 5,
  areaM2: 800,
  variantNazwa: "T18 T35 Dach",
  variantHali: "T18_T35_DACH",
};

const BASE_PRICING = {
  totalPln: 500000,
  base: { totalBase: 400000, cenaPerM2: 500 },
};

function payload(overrides: Partial<GeneratePdfPayload> = {}): GeneratePdfPayload {
  return {
    offer: BASE_OFFER,
    pricing: BASE_PRICING,
    offerNumber: "OF/2025/01",
    ...overrides,
  };
}

describe("mapOfferDataToPayload", () => {
  const offerDate = "10.03.2025";

  it("A) uses technicalSpec when present (from DB)", () => {
    const input = payload({
      technicalSpec: {
        construction_type: "Stal ocynkowana",
        roof_type: "PVC 880",
        walls: "Płyta warstwowa",
      },
    });
    const result = mapOfferDataToPayload(input, offerDate, null);
    expect(result.constructionType).toBe("Stal ocynkowana");
    expect(result.roofType).toBe("PVC 880");
    expect(result.wallsType).toBe("Płyta warstwowa");
    expect(result.technicalSpec?.konstrukcja).toBe("Stal ocynkowana");
    expect(result.technicalSpec?.dach).toBe("PVC 880");
    expect(result.technicalSpec?.sciany).toBe("Płyta warstwowa");
  });

  it("B) fallback to baseRow when technicalSpec missing", () => {
    const input = payload({
      technicalSpec: undefined,
      pricing: {
        ...BASE_PRICING,
        base: {
          ...BASE_PRICING.base!,
          row: {
            Typ_Konstrukcji: "Konstrukcja z base",
            Typ_Dachu: "Dach z base",
            Boki: "Boki z base",
          },
        },
      },
    });
    const result = mapOfferDataToPayload(input, offerDate, null);
    expect(result.constructionType).toBe("Konstrukcja z base");
    expect(result.roofType).toBe("Dach z base");
    expect(result.wallsType).toBe("Boki z base");
  });

  it("B) fallback to baseRow.Dach when Typ_Dachu empty", () => {
    const input = payload({
      technicalSpec: undefined,
      pricing: {
        ...BASE_PRICING,
        base: {
          ...BASE_PRICING.base!,
          row: { Typ_Konstrukcji: "K", Dach: "Dach alt", Boki: "B" },
        },
      },
    });
    const result = mapOfferDataToPayload(input, offerDate, null);
    expect(result.roofType).toBe("Dach alt");
  });

  it("C) technicalSpec and baseRow missing → (brak danych)", () => {
    const input = payload({
      technicalSpec: undefined,
      pricing: { ...BASE_PRICING, base: { totalBase: 400000 } },
    });
    const result = mapOfferDataToPayload(input, offerDate, null);
    expect(result.constructionType).toBe("(brak danych)");
    expect(result.roofType).toBe("(brak danych)");
    expect(result.wallsType).toBe("(brak danych)");
  });

  it("technicalSpec has priority over baseRow when both present", () => {
    const input = payload({
      technicalSpec: { construction_type: "Z spec", roof_type: "Z spec", walls: "Z spec" },
      pricing: {
        ...BASE_PRICING,
        base: {
          ...BASE_PRICING.base!,
          row: { Typ_Konstrukcji: "Z base", Typ_Dachu: "Z base", Boki: "Z base" },
        },
      },
    });
    const result = mapOfferDataToPayload(input, offerDate, null);
    expect(result.constructionType).toBe("Z spec");
    expect(result.roofType).toBe("Z spec");
    expect(result.wallsType).toBe("Z spec");
  });
});
