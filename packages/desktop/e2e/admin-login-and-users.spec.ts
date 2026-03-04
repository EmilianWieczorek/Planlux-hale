/**
 * E2E: Admin logs in (emilian@planlux.pl / 1234), opens Admin, verifies users table and salesperson (test@planlux.pl).
 */
import { test, expect } from "@playwright/test";
import { launchElectron, cleanupE2EMarker } from "./_helpers/launchElectron";

test.describe("Admin – login and users", () => {
  test("admin logs in and sees users table with salesperson", async () => {
    const { electronApp, page, e2eMarkerPath } = await launchElectron();
    try {
      await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("login-email").fill("emilian@planlux.pl");
      await page.getByTestId("login-password").fill("1234");
      await page.getByTestId("login-submit").click();

      await expect(page.getByTestId("nav-admin")).toBeVisible({ timeout: 25_000 });
      await page.getByTestId("nav-admin").click();

      const usersSection = page.getByTestId("admin-users-table").or(page.getByTestId("empty-state"));
      await expect(usersSection).toBeVisible({ timeout: 10_000 });
      await expect(usersSection.getByText("test@planlux.pl")).toBeVisible({ timeout: 5000 });
      await expect(usersSection.getByText("emilian@planlux.pl")).toBeVisible({ timeout: 5000 });
    } finally {
      await electronApp.close();
      cleanupE2EMarker(e2eMarkerPath);
    }
  });
});
