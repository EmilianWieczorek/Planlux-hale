/**
 * Preflight checks for dev/prod flows.
 *
 * Usage:
 *   node scripts/preflight.js dev   # first run / dev:desktop
 *   node scripts/preflight.js prod  # production builds (dist, CI)
 */

const fs = require("fs");
const path = require("path");

function fail(message) {
  // eslint-disable-next-line no-console
  console.error(`[preflight] ${message}`);
  process.exit(1);
}

const mode = process.argv[2] === "prod" ? "prod" : "dev";
const rootDir = path.resolve(__dirname, "..");

const REQUIRED_ENV_VARS_DEV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
const REQUIRED_ENV_VARS_PROD = ["SUPABASE_URL", "SUPABASE_ANON_KEY"];

function checkNodeVersion() {
  const requiredMajor = 20;
  const requiredMinor = 19;
  const [majorStr, minorStr] = process.versions.node.split(".");
  const major = parseInt(majorStr, 10) || 0;
  const minor = parseInt(minorStr, 10) || 0;

  if (major < requiredMajor || (major === requiredMajor && minor < requiredMinor)) {
    fail(
      `Unsupported Node.js version: ${process.versions.node}. ` +
        `Planlux Hale requires Node >= ${requiredMajor}.${requiredMinor}. ` +
        `Use Node 22 LTS (recommended) or newer.`
    );
  }
}

function readEnvKeys(envPath) {
  try {
    const raw = fs.readFileSync(envPath, "utf8");
    const keys = new Set();
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      if (key) keys.add(key);
    }
    return keys;
  } catch {
    return new Set();
  }
}

function checkEnvFile(currentMode) {
  const rootEnv = path.join(rootDir, ".env");
  const desktopEnv = path.join(rootDir, "packages", "desktop", ".env");
  const required = currentMode === "prod" ? REQUIRED_ENV_VARS_PROD : REQUIRED_ENV_VARS_DEV;

  if (!fs.existsSync(rootEnv) && !fs.existsSync(desktopEnv)) {
    const varsList = required.map((v) => `  - ${v}`).join("\n");
    fail(
      "Missing .env file. Create .env in repo root or packages/desktop by copying .env.example " +
        "and adjusting values for your environment.\n" +
        "Expected at least the following variables:\n" +
        varsList
    );
  }

  const envPath = fs.existsSync(rootEnv) ? rootEnv : desktopEnv;
  const keys = readEnvKeys(envPath);
  const missing = required.filter((v) => !keys.has(v));

  if (missing.length > 0) {
    const varsList = missing.map((v) => `  - ${v}`).join("\n");
    fail(
      `Environment file found at ${path.relative(rootDir, envPath)}, but some required variables are missing:\n` +
        varsList +
        "\nUpdate your .env based on .env.example."
    );
  }
}

function checkWorkspacePackages() {
  const packages = [
    { dir: path.join(rootDir, "packages", "shared"), expectedName: "@planlux/shared" },
    { dir: path.join(rootDir, "packages", "core"), expectedName: "@planlux/core" },
    { dir: path.join(rootDir, "packages", "desktop"), expectedName: "@planlux/desktop" },
  ];

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.dir)) {
      fail(`Workspace package directory not found: ${path.relative(rootDir, pkg.dir)}.`);
    }
    const pkgJsonPath = path.join(pkg.dir, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      fail(`Missing package.json for workspace: ${path.relative(rootDir, pkg.dir)}.`);
    }
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      if (pkgJson.name !== pkg.expectedName) {
        fail(
          `Unexpected package name in ${path.relative(
            rootDir,
            pkgJsonPath
          )}. Expected "${pkg.expectedName}", got "${pkgJson.name}".`
        );
      }
    } catch (e) {
      fail(
        `Invalid package.json for workspace: ${path.relative(
          rootDir,
          pkgJsonPath
        )}. Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}

function checkSharedCoreDist() {
  const distFiles = [
    path.join(rootDir, "packages", "shared", "dist", "index.js"),
    path.join(rootDir, "packages", "core", "dist", "index.js"),
  ];

  const missing = distFiles.filter((p) => !fs.existsSync(p));
  if (missing.length > 0) {
    const relMissing = missing.map((p) => path.relative(rootDir, p));
    fail(
      "Missing build output for shared/core packages:\n" +
        relMissing.map((p) => `  - ${p}`).join("\n") +
        "\nRun `npm run build:shared && npm run build:core` (or a full build) before running production flows."
    );
  }
}

// Common checks for all modes
checkNodeVersion();
checkEnvFile(mode);
checkWorkspacePackages();

// Additional checks for production flows
if (mode === "prod") {
  checkSharedCoreDist();
}

// eslint-disable-next-line no-console
console.log(`[preflight] OK (${mode})`);

