/**
 * E2E: Salesperson opens "Wyślij e-mail", fills to/subject, sends. No real SMTP; app must not crash.
 * Expect QUEUED or error message; optionally assert email_history/outbox via UI or IPC.
 */
import { test, expect } from "@playwright/test";
import { launchElectron, cleanupE2EMarker } from "../_helpers/launchElectron";

test.describe("Salesperson – send email (safe, no real SMTP)", () => {
  test("send email flow does not crash and shows status", async () => {
    const { electronApp, page, e2eMarkerPath } = await launchElectron();
    try {
      await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("login-email").fill("test@planlux.pl");
      await page.getByTestId("login-password").fill("Planlux123");
      await page.getByTestId("login-submit").click();

      await expect(page.getByTestId("nav-kalkulator")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("offer-send-email").click();

      await expect(page.getByTestId("email-to")).toBeVisible({ timeout: 5000 });
      await page.getByTestId("email-to").fill("test@planlux.pl");
      await page.getByTestId("email-subject").fill("E2E Test");
      await page.locator("[data-testid=email-body]").fill("Test automatyczny");
      await page.getByTestId("email-send-submit").click();

      await expect(page.getByTestId("email-status")).toBeVisible({ timeout: 15_000 });
    } finally {
      await electronApp.close();
      cleanupE2EMarker(e2eMarkerPath);
    }
  });
});
