import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        tray: path.resolve(__dirname, "src/entries/tray.html"),
        overlay: path.resolve(__dirname, "src/entries/overlay.html"),
        preview: path.resolve(__dirname, "src/entries/preview.html"),
      },
    },
  },
});
