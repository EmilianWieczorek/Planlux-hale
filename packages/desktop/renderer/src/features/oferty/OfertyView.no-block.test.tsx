/**
 * OfertyView nie blokuje renderu listy, gdy syncTempOfferNumbers wisi/timeout.
 * Lista ofert ładowana jest natychmiast; sync idzie w tle.
 */
import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { OfertyView } from "./OfertyView";

describe("OfertyView – lista nie blokuje się na sync", () => {
  const mockApi = vi.fn();

  beforeEach(() => {
    mockApi.mockReset();
  });

  it("pokazuje listę ofert natychmiast, gdy getOffersCrm resolve szybko, a sync nigdy nie resolve", async () => {
    mockApi.mockImplementation((channel: string) => {
      if (channel === "planlux:getOffersCrm") {
        return Promise.resolve({ ok: true, offers: [] });
      }
      if (channel === "planlux:isOnline") {
        return Promise.resolve({ online: true });
      }
      if (channel === "planlux:syncTempOfferNumbers") {
        return new Promise(() => {}); // nigdy nie resolve
      }
      return Promise.resolve({});
    });

    const { findByText } = render(
      <OfertyView api={mockApi} userId="u1" isAdmin={false} />
    );
    await findByText(/Oferty|Brak ofert/u, {}, { timeout: 2000 });
    expect(mockApi).toHaveBeenCalledWith("planlux:getOffersCrm", "u1", "in_progress", "", false);
  });
});
