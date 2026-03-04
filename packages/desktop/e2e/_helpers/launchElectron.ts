/**
 * E2E helper: launch Electron with PLANLUX_E2E=1 and a unique temp dir.
 * Returns { electronApp, page, e2eDir }. Caller must close electronApp when done.
 */
import path from "path";
import fs from "fs";
import os from "os";
import { _electron } from "@playwright/test";

const DESKTOP_ROOT = path.join(__dirname, "..", "..");

export async function launchElectron(): Promise<{
  electronApp: import("playwright").ElectronApplication;
  page: import("playwright").Page;
  e2eDir: string;
  e2eMarkerPath: string;
}> {
  const e2eDir = path.join(
    os.tmpdir(),
    `planlux-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  fs.mkdirSync(e2eDir, { recursive: true });

  /** File-based E2E marker: main process reads this when env is not visible (e.g. Windows spawn). */
  const e2eMarkerPath = path.join(DESKTOP_ROOT, ".e2e-run-dir");
  fs.writeFileSync(e2eMarkerPath, e2eDir, "utf8");

  const templateDir = path.join(DESKTOP_ROOT, "assets", "pdf-template", "Planlux-PDF");
  const env: Record<string, string> = {
    ...process.env,
    PLANLUX_E2E: "1",
    PLANLUX_E2E_DIR: e2eDir,
  };
  if (fs.existsSync(path.join(templateDir, "index.html"))) {
    env.PLANLUX_E2E_TEMPLATE_DIR = path.resolve(templateDir);
  }

  const electronApp = await _electron.launch({
    cwd: DESKTOP_ROOT,
    args: [
      ".",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
    env,
    timeout: 30_000,
  });

  const page = await electronApp.firstWindow();
  page.on("console", (msg) => {
    const text = msg.text();
    console.log(`[renderer] ${text}`);
  });

  return { electronApp, page, e2eDir, e2eMarkerPath };
}

/** Call from test finally to remove E2E marker file. */
export function cleanupE2EMarker(e2eMarkerPath: string): void {
  try {
    if (e2eMarkerPath && fs.existsSync(e2eMarkerPath)) fs.unlinkSync(e2eMarkerPath);
  } catch {
    // ignore
  }
}
