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
        settings: path.resolve(__dirname, "src/entries/settings.html"),
        gallery: path.resolve(__dirname, "src/entries/gallery.html"),
        editor: path.resolve(__dirname, "src/entries/editor.html"),
        video: path.resolve(__dirname, "src/entries/video.html"),
        recording: path.resolve(__dirname, "src/entries/recording.html"),
        captureWorker: path.resolve(__dirname, "src/entries/captureWorker.html"),
        windowPicker: path.resolve(__dirname, "src/entries/windowPicker.html"),
        beautifier: path.resolve(__dirname, "src/entries/beautifier.html"),
        onboarding: path.resolve(__dirname, "src/entries/onboarding.html"),
      },
    },
  },
});
