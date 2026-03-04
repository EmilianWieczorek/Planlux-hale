/**
 * Simple semver comparison for x.y.z (no prerelease for now).
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 * Invalid versions are treated as "0.0.0".
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseParts(a);
  const pb = parseParts(b);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

function parseParts(v: string): [number, number, number] {
  if (typeof v !== "string" || !v.trim()) return [0, 0, 0];
  const parts = v.trim().split(".");
  return [
    parseInt(parts[0] ?? "0", 10) || 0,
    parseInt(parts[1] ?? "0", 10) || 0,
    parseInt(parts[2] ?? "0", 10) || 0,
  ];
}

/** True if current < latest (update available). */
export function isUpdateAvailable(current: string, latest: string): boolean {
  return compareSemver(current, latest) < 0;
}

/** True if current < minSupported (force update / block). */
export function isBelowMinSupported(current: string, minSupported: string): boolean {
  return compareSemver(current, minSupported) < 0;
}
