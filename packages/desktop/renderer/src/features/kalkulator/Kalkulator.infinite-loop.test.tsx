/**
 * Verifies that Kalkulator does not cause "Maximum update depth exceeded" or infinite re-render.
 * showToast is wrapped in useCallback to keep runSyncOfferNumber stable and avoid effect loops.
 */
import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { Kalkulator } from "./Kalkulator";

// Mock useOfferDraft to avoid store side effects
vi.mock("../../state/useOfferDraft", () => ({
  useOfferDraft: () => ({
    draft: {
      offerNumber: "",
      offerNumberLocked: false,
      variantId: "T18_T35_DACH",
      clientCompany: "",
      companyName: "",
      personName: "",
      clientName: "",
      sellerName: "",
      pdfOverrides: { page1: {}, page2: {} },
      pdfTemplateConfig: null,
      status: "DRAFT",
      addons: [],
    },
    actions: { ensureVariantInList: () => {}, setVariantHali: () => {} },
  }),
}));

// Mock offerDraftStore to avoid IPC
vi.mock("../../state/offerDraftStore", () => ({
  offerDraftStore: { getState: () => ({}), subscribe: () => () => {} },
  requestSyncTempNumbers: vi.fn(),
  buildPayloadFromDraft: vi.fn(),
  setSyncErrorHandler: vi.fn(),
}));

describe("Kalkulator – no infinite update loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts without causing infinite re-renders", async () => {
    const api = vi.fn().mockResolvedValue({ ok: false });
    const { findAllByText } = render(
      <Kalkulator api={api} userId="user-1" online={true} />
    );
    const els = await findAllByText(/Hala|Wariant|Kalkulator/u, {}, { timeout: 2000 });
    expect(els.length).toBeGreaterThan(0);
  });
});
