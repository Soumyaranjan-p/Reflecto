import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export type CompositedCursorStyle = "dot" | "hand" | "dark" | "light";

export function isCompositedCursorStyle(s: string | undefined): s is CompositedCursorStyle {
  return s === "dot" || s === "hand" || s === "dark" || s === "light";
}

export function cursorPixelSize(style: CompositedCursorStyle): number {
  return style === "hand" ? 32 : 24;
}

export interface CursorSample {
  t: number;
  x: number;
  y: number;
}

type RGBA = [number, number, number, number];

function canvas(w: number, h: number): { w: number; h: number; px: Uint8ClampedArray } {
  return { w, h, px: new Uint8ClampedArray(w * h * 4) };
}

function setPx(c: { w: number; h: number; px: Uint8ClampedArray }, x: number, y: number, col: RGBA) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= c.w || iy >= c.h) return;
  const o = (iy * c.w + ix) * 4;
  if (col[3] === 0) return;
  if (col[3] === 255) {
    c.px[o] = col[0];
    c.px[o + 1] = col[1];
    c.px[o + 2] = col[2];
    c.px[o + 3] = 255;
    return;
  }
  const a = col[3] / 255;
  c.px[o] = col[0] * a + c.px[o] * (1 - a);
  c.px[o + 1] = col[1] * a + c.px[o + 1] * (1 - a);
  c.px[o + 2] = col[2] * a + c.px[o + 2] * (1 - a);
  c.px[o + 3] = Math.max(c.px[o + 3], col[3]);
}

function fillCircle(c: { w: number; h: number; px: Uint8ClampedArray }, cx: number, cy: number, r: number, col: RGBA) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= r) setPx(c, x, y, d > r - 1 ? [col[0], col[1], col[2], 128] : col);
    }
  }
}

function fillPoly(
  c: { w: number; h: number; px: Uint8ClampedArray },
  pts: Array<[number, number]>,
  col: RGBA,
) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) setPx(c, x, y, col);
    }
  }
}

function strokeLine(
  c: { w: number; h: number; px: Uint8ClampedArray },
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  col: RGBA,
) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    setPx(c, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, col);
  }
}

function strokePoly(c: { w: number; h: number; px: Uint8ClampedArray }, pts: Array<[number, number]>, col: RGBA) {
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    strokeLine(c, x1, y1, x2, y2, col);
  }
}

function fillRect(c: { w: number; h: number; px: Uint8ClampedArray }, x: number, y: number, w: number, h: number, col: RGBA) {
  for (let iy = Math.round(y); iy < Math.round(y + h); iy++) {
    for (let ix = Math.round(x); ix < Math.round(x + w); ix++) setPx(c, ix, iy, col);
  }
}

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const td = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([td, data])), 0);
  return Buffer.concat([len, td, data, crc]);
}

function encodePNG(c: { w: number; h: number; px: Uint8ClampedArray }): Buffer {
  const { w, h, px } = c;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(px.slice(y * w * 4, (y + 1) * w * 4)).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Classic pointer arrow polygon in a 24x24 box, hotspot at top-left.
const ARROW: Array<[number, number]> = [
  [4, 2],
  [4, 18],
  [9, 14],
  [12, 21],
  [14, 20],
  [11, 13],
  [16, 13],
];

function drawArrow(fill: RGBA, outline: RGBA) {
  const c = canvas(24, 24);
  fillPoly(c, ARROW, fill);
  strokePoly(c, ARROW, outline);
  return c;
}

function drawDot(): { w: number; h: number; px: Uint8ClampedArray } {
  const c = canvas(24, 24);
  fillCircle(c, 12, 12, 10, [255, 255, 255, 255]);
  fillCircle(c, 12, 12, 8, [255, 45, 45, 255]);
  return c;
}

function drawHand(): { w: number; h: number; px: Uint8ClampedArray } {
  // Simplified pointing-hand silhouette: four fingers + palm + thumb.
  const c = canvas(32, 32);
  const W: RGBA = [255, 255, 255, 255];
  const B: RGBA = [0, 0, 0, 255];
  // Index finger (raised), then middle/ring/pinky, palm, thumb.
  fillRect(c, 12, 2, 5, 14, W);
  fillRect(c, 18, 7, 5, 10, W);
  fillRect(c, 23, 10, 4, 8, W);
  fillRect(c, 7, 10, 4, 8, W);
  fillRect(c, 7, 15, 20, 13, W);
  fillRect(c, 3, 16, 6, 4, W);
  // Outline: outer border strokes around the silhouette blocks.
  fillRect(c, 11, 1, 7, 1, B);
  fillRect(c, 11, 1, 1, 15, B);
  fillRect(c, 17, 2, 1, 14, B);
  fillRect(c, 18, 6, 5, 1, B);
  fillRect(c, 23, 6, 1, 4, B);
  fillRect(c, 23, 9, 4, 1, B);
  fillRect(c, 27, 10, 1, 8, B);
  fillRect(c, 6, 9, 5, 1, B);
  fillRect(c, 6, 9, 1, 9, B);
  fillRect(c, 7, 28, 20, 1, B);
  fillRect(c, 27, 18, 1, 10, B);
  return c;
}

/** Generate (once) the cursor bitmap for a style; returns file path. */
export function ensureCursorPng(style: CompositedCursorStyle): string {
  const dir = path.join(os.tmpdir(), "reflecto-cursors");
  fs.mkdirSync(dir, { recursive: true });
  const size = cursorPixelSize(style);
  const p = path.join(dir, `cursor-${style}-${size}-shaped.png`);
  if (!fs.existsSync(p) || fs.statSync(p).size < 100) {
    let c;
    switch (style) {
      case "dot":
        c = drawDot();
        break;
      case "hand":
        c = drawHand();
        break;
      case "dark":
        c = drawArrow([20, 20, 20, 255], [255, 255, 255, 255]);
        break;
      case "light":
        c = drawArrow([245, 245, 245, 255], [20, 20, 20, 255]);
        break;
    }
    fs.writeFileSync(p, encodePNG(c));
  }
  return p;
}

/**
 * Overlay chain compositing a cursor bitmap driven by pointer samples.
 * Samples MUST be physical pixels (DIP * display scaleFactor); offset
 * subtracts the capture origin (also physical, e.g. gdigrab expected rect).
 * Downsamples to ~4Hz / max 400 windows so the filter graph stays small
 * while tracking continuously; the final window holds to end-of-video.
 * Returns extra input args (cursor png) + filter_complex segment mapping
 * [last] -> [outTag]. Second video input is index 1 (caller must place the
 * cursor -i immediately after the main -i).
 */
export function buildCursorOverlay(
  last: string,
  style: CompositedCursorStyle,
  samples: CursorSample[],
  offset: { x: number; y: number },
  outTag: string,
): { extraInputs: string[]; filter: string } {
  const png = ensureCursorPng(style);
  // ~4Hz stepping (16ms * 16) keeps the graph small while tracking the mouse
  // continuously; the final window is held to end-of-video so a parked cursor
  // stays visible instead of vanishing 250ms after the last sample.
  const kept = samples.filter((_, i) => i % 16 === 0).slice(0, 400);
  const safe = kept.length ? kept : [{ t: 0, x: offset.x, y: offset.y }];
  let chain = "";
  let prev = last;
  safe.forEach((s, i) => {
    const isLast = i === safe.length - 1;
    const t0 = (s.t / 1000).toFixed(2);
    const t1 = isLast ? "3600" : ((safe[i + 1]?.t ?? s.t + 250) / 1000).toFixed(2);
    const x = Math.max(0, Math.round(s.x - offset.x));
    const y = Math.max(0, Math.round(s.y - offset.y));
    const tag = i === safe.length - 1 ? outTag : `cur${i}`;
    chain += `[${prev}][1:v]overlay=${x}:${y}:enable='between(t,${t0},${t1})'[${tag}];`;
    prev = tag;
  });
  return { extraInputs: ["-i", png], filter: chain };
}
