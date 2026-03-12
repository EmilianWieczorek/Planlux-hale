import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(__dirname, "renderer"),
  base: "./",
  plugins: [react()],
  define: {
    // Renderer must not use Node's process; provide a stub for any dependency that still references it.
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
  },
  optimizeDeps: {
    include: ["@planlux/shared", "pdfjs-dist"],
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/, /packages\/shared/],
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: path.resolve(__dirname, "renderer/index.html"),
    },
  },
});
