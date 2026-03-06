/**
 * Semantic version comparison for update checks.
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b.
 */

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.trim().split(".").map((s) => parseInt(s, 10) || 0);
  const partsB = b.trim().split(".").map((s) => parseInt(s, 10) || 0);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const na = partsA[i] ?? 0;
    const nb = partsB[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
