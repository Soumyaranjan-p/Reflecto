/**
 * Pure port of BetterShot's AnnotationCameraGeometry.swift (v2 projection)
 * plus the unit-square homography from the same file.
 * Canvas top-left origin, degrees in, pixels out. No DOM/Node APIs.
 */

import type { CameraSettings } from "./beautifierTypes";

export interface Quad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export interface Homography {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  g: number; h: number; i: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface V3 { x: number; y: number; z: number }

function rotX(v: V3, angle: number): V3 {
  return {
    x: v.x,
    y: v.y * Math.cos(angle) - v.z * Math.sin(angle),
    z: v.y * Math.sin(angle) + v.z * Math.cos(angle),
  };
}

function rotY(v: V3, angle: number): V3 {
  return {
    x: v.x * Math.cos(angle) + v.z * Math.sin(angle),
    y: v.y,
    z: -v.x * Math.sin(angle) + v.z * Math.cos(angle),
  };
}

function perspectivePoint(
  v: V3,
  pivot: { x: number; y: number },
  imageW: number,
  imageH: number,
  fovDeg: number,
  rollDeg: number,
): { x: number; y: number } {
  const fov = clamp(fovDeg, 18, 80);
  const longestEdge = Math.max(imageW, imageH);
  const focalDistance = longestEdge * (0.35 + 0.5 / Math.max(Math.tan(rad(fov) / 2), 0.01));
  const denominator = Math.max(focalDistance - v.z, focalDistance * 0.12);
  const s = focalDistance / denominator;
  const roll = rad(rollDeg);
  const x = v.x * s;
  const y = v.y * s;
  return {
    x: pivot.x + x * Math.cos(roll) - y * Math.sin(roll),
    y: pivot.y + x * Math.sin(roll) + y * Math.cos(roll),
  };
}

/**
 * Project the image rect (in its own pixel space, origin top-left) to a
 * destination quad in canvas space. Mirrors projectionVersion 2 exactly:
 * zoom is the only framing scale; pan is a fraction of the canvas size.
 */
export function projectQuad(
  imageW: number,
  imageH: number,
  canvasW: number,
  canvasH: number,
  settings: CameraSettings,
): Quad {
  if (imageW <= 0 || imageH <= 0) {
    return {
      topLeft: { x: 0, y: 0 }, topRight: { x: 0, y: 0 },
      bottomRight: { x: 0, y: 0 }, bottomLeft: { x: 0, y: 0 },
    };
  }
  const pivot = { x: imageW / 2, y: imageH / 2 };
  const scale = clamp(settings.zoom ?? 1, 0.4, 2.5);
  const pan = {
    x: (settings.panX ?? 0) * canvasW,
    y: (settings.panY ?? 0) * canvasH,
  };
  // Canvas-space pivot: the image rect is placed at (offX, offY) in the
  // canvas; BetterShot's imageRect is canvas-space, so shift accordingly.
  // Callers pass image coords with the canvas offset baked via offX/offY.
  const projected = (px: number, py: number): { x: number; y: number } => {
    let v: V3 = { x: px - pivot.x, y: py - pivot.y, z: 0 };
    v = rotX(v, rad(settings.rotationXDegrees ?? 0));
    v = rotY(v, rad(settings.rotationYDegrees ?? 0));
    v = rotY(v, -rad(settings.tiltXDegrees ?? 0));
    v = rotX(v, -rad(settings.tiltYDegrees ?? 0));
    const p = perspectivePoint(v, pivot, imageW, imageH, settings.fieldOfViewDegrees ?? 24, settings.rollDegrees ?? 0);
    return {
      x: pivot.x + (p.x - pivot.x) * scale + pan.x,
      y: pivot.y + (p.y - pivot.y) * scale + pan.y,
    };
  };
  return {
    topLeft: projected(0, 0),
    topRight: projected(imageW, 0),
    bottomRight: projected(imageW, imageH),
    bottomLeft: projected(0, imageH),
  };
}

/** Unit-square homography mapping sourceRect -> quad (null when singular). */
export function homographyFor(
  srcX: number, srcY: number, srcW: number, srcH: number,
  quad: Quad,
): Homography | null {
  if (srcW <= 0 || srcH <= 0) return null;
  const p0 = quad.topLeft, p1 = quad.topRight, p2 = quad.bottomRight, p3 = quad.bottomLeft;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;
  const EPS = 1e-6;
  if (Math.abs(dx3) < EPS && Math.abs(dy3) < EPS) {
    a = p1.x - p0.x; b = p3.x - p0.x; c = p0.x;
    d = p1.y - p0.y; e = p3.y - p0.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < EPS) return null;
    const px = (dx3 * dy2 - dx2 * dy3) / den;
    const py = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + px * p1.x; b = p3.x - p0.x + py * p3.x; c = p0.x;
    d = p1.y - p0.y + px * p1.y; e = p3.y - p0.y + py * p3.y; f = p0.y;
    g = px; h = py;
  }
  const iw = 1 / srcW, ih = 1 / srcH;
  return {
    a: a * iw, b: b * ih, c: c - a * srcX * iw - b * srcY * ih,
    d: d * iw, e: e * ih, f: f - d * srcX * iw - e * srcY * ih,
    g: g * iw, h: h * ih, i: 1 - g * srcX * iw - h * srcY * ih,
  };
}

export function invertHomography(m: Homography): Homography | null {
  const det = m.a * (m.e * m.i - m.f * m.h) - m.b * (m.d * m.i - m.f * m.g) + m.c * (m.d * m.h - m.e * m.g);
  if (Math.abs(det) < 1e-9) return null;
  const r = 1 / det;
  return {
    a: (m.e * m.i - m.f * m.h) * r,
    b: (m.c * m.h - m.b * m.i) * r,
    c: (m.b * m.f - m.c * m.e) * r,
    d: (m.f * m.g - m.d * m.i) * r,
    e: (m.a * m.i - m.c * m.g) * r,
    f: (m.c * m.d - m.a * m.f) * r,
    g: (m.d * m.h - m.e * m.g) * r,
    h: (m.b * m.g - m.a * m.h) * r,
    i: (m.a * m.e - m.b * m.d) * r,
  };
}

export function applyHomography(m: Homography, x: number, y: number): { x: number; y: number } | null {
  const den = m.g * x + m.h * y + m.i;
  if (Math.abs(den) < 1e-9) return null;
  return { x: (m.a * x + m.b * y + m.c) / den, y: (m.d * x + m.e * y + m.f) / den };
}

/**
 * Inverse-mapped perspective raster: for each destination pixel (in a
 * destW×destH field whose origin sits at (fieldX, fieldY) in quad space),
 * sample the source ImageData with bilinear filtering. Out-of-quad pixels
 * stay transparent. Returns pixels-rendered count for diagnostics.
 */
export function rasterizeProjected(
  src: ImageData,
  inv: Homography,
  dest: ImageData,
  fieldX: number,
  fieldY: number,
): number {
  const sw = src.width, sh = src.height;
  const s = src.data;
  const dw = dest.width, dh = dest.height;
  const d = dest.data;
  let painted = 0;
  for (let y = 0; y < dh; y++) {
    const wy = fieldY + y;
    for (let x = 0; x < dw; x++) {
      const wx = fieldX + x;
      const den = inv.g * wx + inv.h * wy + inv.i;
      if (Math.abs(den) < 1e-9) continue;
      const sx = (inv.a * wx + inv.b * wy + inv.c) / den;
      const sy = (inv.d * wx + inv.e * wy + inv.f) / den;
      if (sx < 0 || sy < 0 || sx > sw - 1 || sy > sh - 1) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const fx = sx - x0, fy = sy - y0;
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const o = (y * dw + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const p00 = s[(y0 * sw + x0) * 4 + ch];
        const p10 = s[(y0 * sw + x1) * 4 + ch];
        const p01 = s[(y1 * sw + x0) * 4 + ch];
        const p11 = s[(y1 * sw + x1) * 4 + ch];
        d[o + ch] = Math.round((p00 * (1 - fx) + p10 * fx) * (1 - fy) + (p01 * (1 - fx) + p11 * fx) * fy);
      }
      painted++;
    }
  }
  return painted;
}

export function quadBounds(q: Quad): { x: number; y: number; w: number; h: number } {
  const xs = [q.topLeft.x, q.topRight.x, q.bottomRight.x, q.bottomLeft.x];
  const ys = [q.topLeft.y, q.topRight.y, q.bottomRight.y, q.bottomLeft.y];
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
