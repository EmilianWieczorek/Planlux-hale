/**
 * Design tokens – PLANLUX premium B2B palette.
 */

export const tokens = {
  font: {
    family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    weight: { regular: 400, medium: 500, semiBold: 600, bold: 700 },
    size: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24 },
  },
  color: {
    primary: "#8B2635", // PLANLUX burgundy/red
    primaryHover: "#A02D3D",
    primaryMuted: "rgba(139, 38, 53, 0.12)",
    navy: "#1A2332", // dark navy
    navyLight: "#252F3F",
    navyMuted: "rgba(26, 35, 50, 0.08)",
    white: "#FFFFFF",
    gray: { 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A" },
    success: "#10B981",
    warning: "#F59E0B",
    error: "#EF4444",
    border: "#E2E8F0",
    text: "#1E293B",
    textMuted: "#64748B",
  },
  shadow: {
    sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
    md: "0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
    lg: "0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
  },
  radius: { sm: 6, md: 8, lg: 12, full: 9999 },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 },
} as const;
