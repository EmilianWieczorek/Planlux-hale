/**
 * Download installer with progress and SHA256 verification.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import https from "https";
import http from "http";
import type { ReleaseInfo } from "./types";
import { setStatus, setDownloadProgress } from "./updateState";

export interface DownloadUpdateDeps {
  userDataPath: string;
  logger: { info: (m: string, d?: unknown) => void; warn: (m: string, d?: unknown) => void; error: (m: string, e?: unknown) => void };
}

const UPDATES_DIR = "updates";
const FILE_PREFIX = "planlux-update-";

function getProtocol(url: string): typeof https | typeof http {
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? https : http;
  } catch {
    return https;
  }
}

/**
 * Download installer to userData/updates/planlux-update-{version}.exe.
 * Report progress; verify SHA256; throw on mismatch.
 */
export async function downloadUpdate(
  release: ReleaseInfo,
  deps: DownloadUpdateDeps
): Promise<string> {
  const { userDataPath, logger } = deps;
  const dir = path.join(userDataPath, UPDATES_DIR);
  const filename = `${FILE_PREFIX}${release.version}.exe`;
  const filePath = path.join(dir, filename);

  setStatus("downloading", release);

  logger.info("[updates] downloading", { version: release.version });

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const protocol = getProtocol(release.download_url);
    const request = protocol.get(release.download_url, (response) => {
      const total = response.headers["content-length"];
      const totalNum = total ? parseInt(total, 10) : null;
      let transferred = 0;
      const fileStream = fs.createWriteStream(filePath);
      const hash = crypto.createHash("sha256");

      // Manually read chunks so we both write and hash (pipe() would consume and 'data' might not fire)
      response.on("data", (chunk: Buffer) => {
        transferred += chunk.length;
        hash.update(chunk);
        fileStream.write(chunk);
        const percent = totalNum && totalNum > 0 ? Math.min(100, (transferred / totalNum) * 100) : 0;
        setDownloadProgress({
          percent,
          bytesPerSecond: null,
          transferred,
          total: totalNum,
        });
      });

      response.on("end", () => {
        fileStream.end(() => {
          const computed = hash.digest("hex").toLowerCase();
          const expected = (release.sha256 ?? "").trim().toLowerCase();
          if (expected && computed !== expected) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            logger.error("[updates] SHA256 mismatch", { expected: expected.slice(0, 16), computed: computed.slice(0, 16) });
            setStatus("error", release, "Weryfikacja sumy kontrolnej nie powiodła się.");
            reject(new Error("SHA256 verification failed"));
            return;
          }
          logger.info("[updates] verified", { version: release.version });
          setStatus("downloaded", release);
          resolve(filePath);
        });
      });

      response.on("error", (err) => {
        fileStream.destroy();
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
        setStatus("error", release, err.message ?? "Download failed");
        reject(err);
      });
    });

    request.on("error", (err) => {
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
      const msg = err.message ?? "Download failed";
      logger.warn("[updates] download failed", { message: msg });
      setStatus("error", release, msg);
      reject(err);
    });
  });
}
