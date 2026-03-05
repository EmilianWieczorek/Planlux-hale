/**
 * Post-build verification: assets/icon.ico exists and (if present) packaged app resources contain it.
 * Run from packages/desktop: node electron/scripts/verify-icon.js
 */
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..", "..");
const assetsIco = path.join(root, "assets", "icon.ico");
const releaseAssetsIco = path.join(root, "release", "win-unpacked", "resources", "assets", "icon.ico");

let pass = true;

if (!fs.existsSync(assetsIco)) {
  console.error("FAIL: packages/desktop/assets/icon.ico does not exist. Run: npm run gen:ico -w @planlux/desktop or node scripts/create-icon.js");
  pass = false;
} else {
  console.log("PASS: assets/icon.ico exists");
}

if (fs.existsSync(path.join(root, "release", "win-unpacked"))) {
  if (!fs.existsSync(releaseAssetsIco)) {
    console.error("FAIL: Packaged app resources do not contain assets/icon.ico at", releaseAssetsIco);
    pass = false;
  } else {
    console.log("PASS: release/win-unpacked/resources/assets/icon.ico exists");
  }
} else {
  console.log("SKIP: release/win-unpacked not found (run npm run dist -w @planlux/desktop first)");
}

process.exit(pass ? 0 : 1);
