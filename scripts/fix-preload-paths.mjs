import fs from "node:fs";

const files = [
  ["electron/tray.ts", "./paths"],
  ["electron/overlay/windows.ts", "../paths"],
  ["electron/preview/deck.ts", "../paths"],
  ["electron/settings/window.ts", "../paths"],
  ["electron/gallery/window.ts", "../paths"],
  ["electron/recording/bar.ts", "../paths"],
  ["electron/editor/annotatePresenter.ts", "../paths"],
];

for (const [file, rel] of files) {
  const p = file;
  let c = fs.readFileSync(p, "utf8");
  const before = c;
  c = c.replace(/path\.join\(__dirname,\s*["']\.\.\/preload\/index\.js["']\)/g, "preloadPath()");
  if (!c.includes("preloadPath()")) {
    console.log("no preloadPath replace", file);
    continue;
  }
  if (!c.includes(`from "${rel}"`) && !c.includes(`from '${rel}'`)) {
    const lines = c.split("\n");
    let i = 0;
    while (i < lines.length && /^import /.test(lines[i])) i += 1;
    lines.splice(i, 0, `import { preloadPath } from "${rel}";`);
    c = lines.join("\n");
  }
  // Fix production loadFile paths that assumed ../dist from nested bundle
  c = c.replace(
    /path\.join\(__dirname,\s*["']\.\.\/dist\/src\/entries\//g,
    'path.join(__dirname, "../dist/src/entries/',
  );
  if (c !== before) {
    fs.writeFileSync(p, c);
    console.log("updated", file);
  } else {
    console.log("unchanged", file);
  }
}
