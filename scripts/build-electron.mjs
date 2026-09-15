import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  external: ["electron", "ffmpeg-static", "tesseract.js"],
};

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ["electron/main.ts"],
    outfile: "dist-electron/main.js",
  }),
  esbuild.context({
    ...shared,
    entryPoints: ["preload/index.ts"],
    outfile: "dist-electron/preload/index.js",
  }),
]);

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log("[reflecto] electron bundle watching");
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  console.log("[reflecto] electron bundle built");
}
