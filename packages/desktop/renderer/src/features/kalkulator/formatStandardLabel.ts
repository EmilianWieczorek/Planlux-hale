export function formatStandardLabel(name: string | null | undefined): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";

  // Normalize separators and casing
  const withSpaces = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = withSpaces.toLowerCase();

  // 4X4 / 10X12 -> 4x4 / 10x12 (also handles spaces)
  const dimFixed = lower.replace(/(\d+)\s*x\s*(\d+)/g, "$1x$2").replace(/(\d+)\s*×\s*(\d+)/g, "$1x$2");

  // Title-case words, keep numbers intact
  const words = dimFixed.split(" ");
  const titled = words
    .map((w) => {
      if (!w) return w;
      if (/^\d/.test(w)) return w; // starts with digit
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");

  return titled;
}

