/**
 * E2E: Admin logs in, opens Admin, goes to Historia PDF and Historia e-mail tabs – no crash.
 */
import { test, expect } from "@playwright/test";
import { launchElectron, cleanupE2EMarker } from "../_helpers/launchElectron";

test.describe("Admin – history tabs load", () => {
  test("admin can open Historia PDF and Historia e-mail without crash", async () => {
    const { electronApp, page, e2eMarkerPath } = await launchElectron();
    try {
      await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("login-email").fill("emilian@planlux.pl");
      await page.getByTestId("login-password").fill("1234");
      await page.getByTestId("login-submit").click();

      await expect(page.getByTestId("nav-admin")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("nav-admin").click();

      await expect(page.getByRole("heading", { name: "Panel admina" })).toBeVisible({ timeout: 5000 });
      await page.getByRole("tab", { name: /Historia PDF/i }).click();
      await expect(page.getByTestId("history-pdf-table").or(page.getByTestId("empty-state"))).toBeVisible({ timeout: 5000 });

      await page.getByRole("tab", { name: /Historia e-mail/i }).click();
      await expect(page.getByTestId("history-email-table").or(page.getByTestId("empty-state"))).toBeVisible({ timeout: 5000 });
    } finally {
      await electronApp.close();
      cleanupE2EMarker(e2eMarkerPath);
    }
  });
});
