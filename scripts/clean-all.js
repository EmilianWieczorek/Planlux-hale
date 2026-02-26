#!/usr/bin/env node
/**
 * Usuwa dist, release, win-unpacked, .vite w całym monorepo.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dirs = [
  "packages/desktop/dist",
  "packages/shared/dist",
  "packages/desktop/release",
  "packages/desktop/win-unpacked",
  "packages/desktop/out",
  "packages/desktop/build",
  "packages/desktop/node_modules/.vite",
  "packages/desktop/node_modules/.cache",
  "packages/shared/node_modules/.cache",
  "coverage",
];

for (const d of dirs) {
  const full = path.join(root, d);
  try {
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true });
      console.log("Removed:", d);
    }
  } catch (e) {
    console.warn("Skip", d, e.message);
  }
}
console.log("clean:all done");
