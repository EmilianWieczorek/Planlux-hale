/**
 * Generate packages/desktop/assets/icon.ico (multi-resolution).
 * Prefer: use a source PNG (assets/icon.png or assets/logo.png) and an image tool to export multi-size ICO.
 * Fallback: if no PNG found, runs programmatic create-icon.js to produce assets/icon.ico (Planlux blue).
 * Run from packages/desktop: node electron/scripts/gen-ico.js
 */
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..", "..");
const candidates = [
  path.join(root, "assets", "icon.png"),
  path.join(root, "assets", "logo.png"),
  path.join(root, "assets", "pdf-template", "Planlux-PDF", "assets", "logo-bez-tla.png"),
];

const pngPath = candidates.find((p) => fs.existsSync(p));
if (!pngPath) {
  console.error(
    "No source PNG found. Add one of:\n  packages/desktop/assets/icon.png\n  packages/desktop/assets/logo.png\nThen use an image tool to export multi-size ICO to assets/icon.ico, or run:\n  node scripts/create-icon.js\nfor a programmatic icon."
  );
  process.exit(1);
}

require(path.join(root, "scripts", "create-icon.js"));
console.log("Generated assets/icon.ico (multi-size). Source PNG:", path.relative(root, pngPath));
