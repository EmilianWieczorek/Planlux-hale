/**
 * Prepare script: run husky install only when git is available.
 * On Windows (or CI without git), npm install must not fail with "git command not found".
 */
const { execSync, spawnSync } = require("child_process");

function hasGit() {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasGit()) {
  console.warn("prepare: git not in PATH, skipping husky");
  process.exit(0);
}

const r = spawnSync("npx", ["husky", "install"], { stdio: "inherit", cwd: process.cwd(), shell: true });
process.exit(r.status !== null ? r.status : 0);
