/**
 * Verifies that AdminPanel does not cause "Maximum update depth exceeded" or infinite re-render.
 * loadUsers is wrapped in useCallback([api]) so the effect does not re-run every render.
 */
import { describe, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { AdminPanel } from "./AdminPanel";

describe("AdminPanel – no infinite update loop", () => {
  const mockApi = vi.fn();
  const currentUser = { id: "1", email: "admin@test.pl", role: "ADMIN", displayName: "Admin" };

  beforeEach(() => {
    mockApi.mockReset();
    mockApi.mockResolvedValue({ ok: true, users: [] });
  });

  it("mounts and loads users without infinite re-renders", async () => {
    const { findByText } = render(<AdminPanel api={mockApi} currentUser={currentUser} />);
    await findByText(/Użytkownicy|Ładowanie/u, {}, { timeout: 3000 });
    expect(mockApi).toHaveBeenCalledWith("planlux:getUsers");
  });
});
