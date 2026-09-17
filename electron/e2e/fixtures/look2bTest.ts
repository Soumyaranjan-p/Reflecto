import { renderBeautifierFromImage } from "../../../src/shared/beautifierRender";
import {
  defaultBeautifierConfig,
  normalizeBeautifierConfig,
} from "../../../src/shared/beautifierTypes";
import { projectQuad } from "../../../src/shared/cameraProjection";

function mkCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
  const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [d[0], d[1], d[2], d[3]];
}

function blockVariance(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): number {
  const d = ctx.getImageData(Math.round(x), Math.round(y), s, s).data;
  let n = 0;
  let mean = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    n++;
    mean += g;
  }
  mean /= n;
  let v = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v += (g - mean) * (g - mean);
  }
  return v / n;
}

function maxLumaBox(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): number {
  let m = 0;
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const [R, G, B] = px(ctx, cx + x, cy + y);
      m = Math.max(m, 0.299 * R + 0.587 * G + 0.114 * B);
    }
  }
  return m;
}

// ---- 1. Camera: red frame rect, rotationY=25 -> left edge longer than right.
const frameSrc = mkCanvas(200, 200);
{
  const c = frameSrc.getContext("2d")!;
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 200, 200);
  c.strokeStyle = "#f73833";
  c.lineWidth = 4;
  c.strokeRect(20, 20, 160, 160);
}
const camCfg = normalizeBeautifierConfig({
  ...defaultBeautifierConfig,
  style: { kind: "none" },
  padding: 0.1,
  shadowStrength: 0,
  camera: {
    panX: 0, panY: 0, tiltXDegrees: 0, tiltYDegrees: 0,
    rotationXDegrees: 0, rotationYDegrees: 25, rollDegrees: 0,
    fieldOfViewDegrees: 24, zoom: 1,
  },
});
const t0 = performance.now();
const camCanvas = renderBeautifierFromImage(frameSrc, 200, 200, camCfg);
const camMs = performance.now() - t0;
const camCtx = camCanvas.getContext("2d", { willReadFrequently: true })!;
const camData = camCtx.getImageData(0, 0, camCanvas.width, camCanvas.height).data;
const isRed = (i: number) => camData[i] > 150 && camData[i + 1] < 120 && camData[i + 2] < 120;
let leftX = -1;
let rightX = -1;
for (let x = 0; x < camCanvas.width; x++) {
  for (let y = 0; y < camCanvas.height; y += 2) {
    if (isRed((y * camCanvas.width + x) * 4)) { leftX = x; break; }
  }
  if (leftX >= 0) break;
}
for (let x = camCanvas.width - 1; x >= 0; x--) {
  for (let y = 0; y < camCanvas.height; y += 2) {
    if (isRed((y * camCanvas.width + x) * 4)) { rightX = x; break; }
  }
  if (rightX >= 0) break;
}
const runLen = (x: number) => {
  let n = 0;
  for (let y = 0; y < camCanvas.height; y++) {
    if (isRed((y * camCanvas.width + x) * 4)) n++;
  }
  return n;
};
const leftRun = leftX >= 0 ? runLen(leftX) : 0;
const rightRun = rightX >= 0 ? runLen(rightX) : 0;
const quad = projectQuad(200, 200, 240, 240, camCfg.camera);
const quadLeft = Math.hypot(quad.topLeft.x - quad.bottomLeft.x, quad.topLeft.y - quad.bottomLeft.y);
const quadRight = Math.hypot(quad.topRight.x - quad.bottomRight.x, quad.topRight.y - quad.bottomRight.y);

// ---- 2. Blur: checkerboard source.
const checker = mkCanvas(200, 200);
{
  const c = checker.getContext("2d")!;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      c.fillStyle = (x + y) % 2 ? "#000000" : "#ffffff";
      c.fillRect(x * 10, y * 10, 10, 10);
    }
  }
}
const radialCfg = normalizeBeautifierConfig({
  ...defaultBeautifierConfig,
  style: { kind: "none" },
  padding: 0,
  shadowStrength: 0,
  progressiveBlur: {
    isEnabled: true, edgeMode: "clipped", mode: "radial", strength: 40,
    falloff: 0.3, focusSize: 0.1,
    focusPosition: { x: 0.5, y: 0.5 }, directionDegrees: 0,
  },
});
const radialCanvas = renderBeautifierFromImage(checker, 200, 200, radialCfg);
const radialCtx = radialCanvas.getContext("2d", { willReadFrequently: true })!;
const varCenter = blockVariance(radialCtx, 90, 90, 20);
const varCorner = blockVariance(radialCtx, 0, 0, 20);

const dirCfg = normalizeBeautifierConfig({
  ...radialCfg,
  progressiveBlur: {
    isEnabled: true, edgeMode: "clipped", mode: "directional", strength: 40,
    falloff: 0.3, focusSize: 0.2,
    focusPosition: { x: 0.5, y: 0.5 }, directionDegrees: 0,
  },
});
const dirCanvas = renderBeautifierFromImage(checker, 200, 200, dirCfg);
const dirCtx = dirCanvas.getContext("2d", { willReadFrequently: true })!;
const varMid = blockVariance(dirCtx, 90, 90, 20);
const varTop = blockVariance(dirCtx, 90, 0, 20);

// clipped vs bleed on a blue background with a small checker card.
const smallChecker = mkCanvas(100, 100);
{
  const c = smallChecker.getContext("2d")!;
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      c.fillStyle = (x + y) % 2 ? "#000000" : "#ffffff";
      c.fillRect(x * 10, y * 10, 10, 10);
    }
  }
}
const sceneBase = {
  ...defaultBeautifierConfig,
  style: { kind: "solid", rgb: [0, 0, 200] as [number, number, number] },
  padding: 0.3,
  shadowStrength: 0,
  progressiveBlur: {
    isEnabled: true, edgeMode: "clipped" as const, mode: "radial" as const, strength: 60,
    falloff: 0.3, focusSize: 0,
    focusPosition: { x: 0.5, y: 0.5 }, directionDegrees: 0,
  },
};
const clippedCanvas = renderBeautifierFromImage(smallChecker, 100, 100, normalizeBeautifierConfig(sceneBase));
const bleedCanvas = renderBeautifierFromImage(
  smallChecker, 100, 100,
  normalizeBeautifierConfig({ ...sceneBase, progressiveBlur: { ...sceneBase.progressiveBlur, edgeMode: "bleed" } }),
);
const clippedCtx = clippedCanvas.getContext("2d", { willReadFrequently: true })!;
const bleedCtx = bleedCanvas.getContext("2d", { willReadFrequently: true })!;
// 6px left of the screenshot edge: clipped keeps pure bg, bleed drags
// screenshot colors outward.
const clippedBg = px(clippedCtx, 24, 80);
const bleedBg = px(bleedCtx, 24, 80);
const bgDist = (p: [number, number, number, number]) => Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2] - 200);

// ---- 3. Watermark on black (white ink contrasts; gaps read background).
const blackSrc = mkCanvas(100, 100);
{
  const c = blackSrc.getContext("2d")!;
  c.fillStyle = "#000000";
  c.fillRect(0, 0, 100, 100);
}
const wmText = "REFLECTO";
const wmCfg = normalizeBeautifierConfig({
  ...defaultBeautifierConfig,
  style: { kind: "solid", rgb: [0, 0, 0] as [number, number, number] },
  padding: 0.1,
  shadowStrength: 0,
  watermark: { text: wmText, density: 4, fontSize: 12, rotationDegrees: 45, opacity: 1, color: "#ffffff" },
});
const wmCanvas = renderBeautifierFromImage(blackSrc, 100, 100, wmCfg);
const wmCtx = wmCanvas.getContext("2d", { willReadFrequently: true })!;
const W = wmCanvas.width;
const H = wmCanvas.height;
const rows = 4;
const spacingY = H / rows;
const spacingX = spacingY * 2.2;
const diagonal = Math.hypot(W, H);
const columnCount = Math.max(2, Math.ceil(diagonal / spacingX));
const rowCount = Math.max(2, Math.ceil(diagonal / spacingY));
const originX = W / 2 - (columnCount * spacingX) / 2;
const originY = H / 2 - (rowCount * spacingY) / 2;
// Un-rotate tile centers back to canvas space (canvas rotated by -45 about center).
const ang = (-45 * Math.PI) / 180;
const toCanvas = (lx: number, ly: number): [number, number] => {
  const dx = lx - W / 2;
  const dy = ly - H / 2;
  return [
    W / 2 + dx * Math.cos(ang) - dy * Math.sin(ang),
    H / 2 + dx * Math.sin(ang) + dy * Math.cos(ang),
  ];
};
const midC = Math.floor(columnCount / 2);
const midR = Math.floor(rowCount / 2);
const tileHits: number[] = [];
for (const [dc, dr] of [[0, 0], [1, 0], [0, 1]] as Array<[number, number]>) {
  const [cx, cy] = toCanvas(originX + (midC + dc) * spacingX, originY + (midR + dr) * spacingY);
  tileHits.push(Math.round(maxLumaBox(wmCtx, cx, cy, 4)));
}
const [gx, gy] = toCanvas(originX + (midC + 0.5) * spacingX, originY + (midR + 0.5) * spacingY);
const gapLuma = Math.round(maxLumaBox(wmCtx, gx, gy, 2));

// ---- 4. Border ring width scan (white card on blue, square corners).
const whiteSrc = mkCanvas(100, 100);
{
  const c = whiteSrc.getContext("2d")!;
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, 100, 100);
}
const borderCfg = normalizeBeautifierConfig({
  ...defaultBeautifierConfig,
  style: { kind: "solid", rgb: [0, 0, 200] as [number, number, number] },
  padding: 0.2,
  cornerRadius: 0,
  shadowStrength: 0,
  border: { enabled: true, color: "#ff0000", thickness: 0.05, opacity: 1 },
});
const borderCanvas = renderBeautifierFromImage(whiteSrc, 100, 100, borderCfg);
const borderCtx = borderCanvas.getContext("2d", { willReadFrequently: true })!;
const midY = Math.floor(borderCanvas.height / 2);
// Image at pad=0.2*100=20, shifted by canvas breathing room: locate the ring
// dynamically and require it to be 5px wide, flush against the white card,
// with blue background outside it.
let ringStart = -1;
let ringEnd = -1;
let imgStart = -1;
for (let x = 0; x < borderCanvas.width; x++) {
  const [R, G, B] = px(borderCtx, x, midY);
  const red = R > 150 && G < 120 && B < 120;
  const white = R > 200 && G > 200 && B > 200;
  if (red && ringStart < 0) ringStart = x;
  if (!red && ringStart >= 0 && ringEnd < 0) ringEnd = x;
  if (white && ringEnd >= 0 && imgStart < 0) { imgStart = x; break; }
}
const ringWidth = ringEnd - ringStart;
const [br, bg, bb] = px(borderCtx, Math.max(0, ringStart - 5), midY);

const res = {
  camera: {
    canvasW: camCanvas.width, canvasH: camCanvas.height,
    leftRun, rightRun, edgeDiff: leftRun - rightRun,
    quadLeft: Math.round(quadLeft * 10) / 10, quadRight: Math.round(quadRight * 10) / 10,
    ms: Math.round(camMs * 10) / 10,
    ok: leftRun - rightRun > 12,
  },
  blur: {
    radialCenter: Math.round(varCenter), radialCorner: Math.round(varCorner),
    radialRatio: Math.round((varCorner / Math.max(1, varCenter)) * 100) / 100,
    dirMid: Math.round(varMid), dirTop: Math.round(varTop),
    dirRatio: Math.round((varTop / Math.max(1, varMid)) * 100) / 100,
    clippedBgDist: Math.round(bgDist(clippedBg)),
    bleedBgDist: Math.round(bgDist(bleedBg)),
    ok: varCorner / Math.max(1, varCenter) < 0.4 && varCenter > 500 &&
      varTop / Math.max(1, varMid) < 0.4 && varMid > 500 &&
      bgDist(clippedBg) < 12 && bgDist(bleedBg) > 12,
  },
  watermark: {
    canvasW: W, canvasH: H, tileHits, gapLuma,
    ok: tileHits.filter((v) => v > 120).length >= 2 && gapLuma < 60,
  },
  border: {
    canvasW: borderCanvas.width, ringStart, ringWidth, imgStart,
    bgNear: [br, bg, bb],
    ok: ringWidth >= 4 && ringWidth <= 6 && ringEnd === imgStart && bb > 150 && br < 120,
  },
  pass: false,
};
res.pass = res.camera.ok && res.blur.ok && res.watermark.ok && res.border.ok;
(window as unknown as { __look2b: typeof res }).__look2b = res;
