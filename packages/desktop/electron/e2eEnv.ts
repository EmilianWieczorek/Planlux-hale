/**
 * E2E test mode: isolated userData so tests never touch production data.
 * Only active when PLANLUX_E2E=1 and PLANLUX_E2E_DIR is set (absolute path).
 * Production behavior is unchanged when these env vars are not set.
 */

import path from "path";
import fs from "fs";

export function getE2EConfig(): { isE2E: true; e2eBaseDir: string } | { isE2E: false } {
  const e2eDir = process.env.PLANLUX_E2E_DIR;
  if (process.env.PLANLUX_E2E !== "1" || !e2eDir || typeof e2eDir !== "string") {
    return { isE2E: false };
  }
  const absolute = path.isAbsolute(e2eDir) ? e2eDir : path.resolve(process.cwd(), e2eDir);
  return { isE2E: true, e2eBaseDir: absolute };
}

/** Create E2E dirs (pdfs, logs) so PDF/output and logs land in temp. Call only when isE2E. */
export function ensureE2EDirs(e2eBaseDir: string): void {
  const pdfsDir = path.join(e2eBaseDir, "pdfs");
  const logsDir = path.join(e2eBaseDir, "logs");
  const previewDir = path.join(e2eBaseDir, "preview");
  const tmpDir = path.join(e2eBaseDir, "tmp");
  for (const dir of [e2eBaseDir, pdfsDir, logsDir, previewDir, tmpDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
