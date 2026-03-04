/**
 * E2E: Salesperson logs in, fills Kalkulator, generates PDF, verifies file in E2E_DIR/pdfs.
 */
import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { launchElectron, cleanupE2EMarker } from "../_helpers/launchElectron";

test.describe("Salesperson – offer PDF", () => {
  test("salesperson fills form and generates PDF", async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    const { electronApp, page, e2eDir, e2eMarkerPath } = await launchElectron();
    const pdfsDir = path.join(e2eDir, "pdfs");

    page.on("console", (msg) => {
      const t = msg.text();
      if (/E2E|pdf|PDF|error|Error/.test(t)) console.log("[renderer]", t);
    });
    page.on("pageerror", (err) => console.error("[pageerror]", err.message));

    try {
      await expect(page.getByTestId("login-email")).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("login-email").fill("test@planlux.pl");
      await page.getByTestId("login-password").fill("Planlux123");
      await page.getByTestId("login-submit").click();

      await expect(page.getByTestId("nav-kalkulator")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("nav-kalkulator").click();

      await page.getByRole("button", { name: /Klient/i }).click();
      await expect(page.getByTestId("client-company")).toBeVisible({ timeout: 5000 });
      await page.getByTestId("client-company").fill("Firma Testowa");
      await page.getByTestId("client-firstName").fill("Jan Kowalski");
      await page.getByTestId("client-email").fill("jan.kowalski@test.pl");
      await page.getByTestId("hall-width").fill("10");
      await page.getByTestId("hall-length").fill("20");
      await page.getByTestId("hall-height").fill("4");

      await expect(page.getByTestId("offer-generate-pdf")).toBeVisible({ timeout: 5000 });
      await expect(page.getByTestId("offer-generate-pdf")).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId("offer-generate-pdf").click();

      await expect(page.getByTestId("pdf-status")).toContainText("Generowanie", { timeout: 10_000 });

      const duplicateContinue = page.getByRole("button", { name: /Kontynuuj mimo to/i });
      try {
        await duplicateContinue.click({ timeout: 2_000 });
      } catch {
        // No duplicate modal – doGeneratePdf was called directly
      }

      await expect(page.getByTestId("pdf-status")).toContainText("Wygenerowano", { timeout: 90_000 });

      const files = fs.readdirSync(pdfsDir);
      if (files.length === 0) {
        console.error("[E2E] pdfs dir listing (empty):", pdfsDir);
      } else {
        console.log("[E2E] pdfs dir listing:", files);
      }
      expect(files.length).toBeGreaterThan(0);
      const pdfFile = files.find((f) => f.endsWith(".pdf"));
      expect(pdfFile).toBeTruthy();
      const stat = fs.statSync(path.join(pdfsDir, pdfFile!));
      expect(stat.size).toBeGreaterThan(20_000);
    } catch (e) {
      const desktopRoot = path.dirname(e2eMarkerPath);
      console.error("[E2E] .e2e-run-dir exists?", fs.existsSync(path.join(desktopRoot, ".e2e-run-dir")));
      console.error("[E2E] .e2e-handler-entered exists?", fs.existsSync(path.join(desktopRoot, ".e2e-handler-entered")));
      if (fs.existsSync(pdfsDir)) {
        console.error("[E2E] on failure pdfs dir listing:", pdfsDir, fs.readdirSync(pdfsDir));
      }
      throw e;
    } finally {
      await electronApp.close();
      cleanupE2EMarker(e2eMarkerPath);
    }
  });
});
