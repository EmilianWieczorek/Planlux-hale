/**
 * Vitest config for renderer (React) tests only.
 * Uses happy-dom to avoid jsdom's ESM dependency chain (html-encoding-sniffer → @exodus/bytes).
 */
import path from "path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: [path.resolve(__dirname, "renderer/src/test/setup.ts")],
    include: ["renderer/src/**/*.test.{ts,tsx}"],
    testTimeout: 5000,
    maxConcurrency: 1,
    server: {
      deps: { inline: ["@mui/icons-material", "@mui/material"] },
    },
  },
  optimizeDeps: {
    include: ["@mui/icons-material", "@mui/material", "react", "react-dom"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "renderer/src"),
    },
  },
});
