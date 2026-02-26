/**
 * Stabilny identyfikator urządzenia – do numerów TEMP offline.
 * Zapis w userData/device-id.txt.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { app } from "electron";

const FILENAME = "device-id.txt";

function getDeviceIdPath(): string {
  return path.join(app.getPath("userData"), FILENAME);
}

export function getDeviceId(): string {
  const p = getDeviceIdPath();
  try {
    if (fs.existsSync(p)) {
      const id = fs.readFileSync(p, "utf-8").trim();
      if (id.length >= 8) return id;
    }
  } catch {
    /* ignore */
  }
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, id, "utf-8");
  } catch {
    /* fallback */
  }
  return id;
}
