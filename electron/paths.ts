import path from "node:path";

/** Preload path relative to the bundled main process (`dist-electron/main.js`). */
export function preloadPath(): string {
  return path.join(__dirname, "preload/index.js");
}

/** Renderer HTML in production builds. */
export function rendererEntry(name: string): string {
  return path.join(__dirname, `../dist/src/entries/${name}.html`);
}
