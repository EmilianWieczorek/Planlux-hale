/**
 * Playwright config for E2E tests – Electron app (Planlux Hale).
 * Run with: npm run test:e2e -w packages/desktop
 * Requires: npm run build -w packages/desktop first (built main + renderer).
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "electron", use: { ...devices["Desktop Chrome"] } }],
});
