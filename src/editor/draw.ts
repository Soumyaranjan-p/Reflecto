import { isLightColor, type Annotation, type Point } from "./types";
import { fontStackFor } from "./fonts";

export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  annotations: Annotation[],
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.restore();

  const redactions = annotations.filter((a) => a.tool === "blur" || a.tool === "pixelate");
  const spots = annotations.filter((a) => a.tool === "highlight");
  const rest = annotations.filter((a) => a.tool !== "blur" && a.tool !== "pixelate" && a.tool !== "highlight");

  for (const a of redactions) drawRedaction(ctx, a);
  for (const a of rest) drawShape(ctx, a);
  if (spots.length) drawSpotlight(ctx, width, height, spots);
}

function drawRedaction(ctx: CanvasRenderingContext2D, a: Annotation) {
  const x = Math.min(a.x1, a.x2);
  const y = Math.min(a.y1, a.y2);
  const w = Math.abs(a.x2 - a.x1);
  const h = Math.abs(a.y2 - a.y1);
  if (w < 2 || h < 2) return;
  const strength = a.redactionStrength ?? 0.7;
  try {
    if (a.tool === "pixelate") {
      const block = Math.max(4, Math.round(8 + strength * 24));
      const sample = ctx.getImageData(x, y, w, h);
      for (let py = 0; py < h; py += block) {
        for (let px = 0; px < w; px += block) {
          const i = (Math.min(py, h - 1) * w + Math.min(px, w - 1)) * 4;
          ctx.fillStyle = `rgba(${sample.data[i]},${sample.data[i + 1]},${sample.data[i + 2]},1)`;
          ctx.fillRect(x + px, y + py, block, block);
        }
      }
    } else {
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const octx = off.getContext("2d")!;
      octx.filter = `blur(${Math.round(4 + strength * 18)}px)`;
      octx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);
      ctx.drawImage(off, x, y);
    }
  } catch {
    ctx.fillStyle = "rgba(80,80,80,0.55)";
    ctx.fillRect(x, y, w, h);
  }
}

function drawSpotlight(ctx: CanvasRenderingContext2D, width: number, height: number, spots: Annotation[]) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-out";
  for (const a of spots) {
    const x = Math.min(a.x1, a.x2);
    const y = Math.min(a.y1, a.y2);
    const w = Math.abs(a.x2 - a.x1);
    const h = Math.abs(a.y2 - a.y1);
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, a: Annotation) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const cx = (a.x1 + a.x2) / 2;
  const cy = (a.y1 + a.y2) / 2;
  if (a.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate(a.rotation);
    ctx.translate(-cx, -cy);
  }

  if (a.tool === "rectangle") {
    ctx.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
  } else if (a.tool === "filledRectangle") {
    ctx.fillRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
  } else if (a.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(a.x2 - a.x1) / 2, Math.abs(a.y2 - a.y1) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (a.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(a.x1, a.y1);
    ctx.lineTo(a.x2, a.y2);
    ctx.stroke();
  } else if (a.tool === "arrow") {
    drawArrow(ctx, a.x1, a.y1, a.x2, a.y2, a.stroke);
  } else if (a.tool === "freehand" && a.points?.length) {
    ctx.beginPath();
    ctx.moveTo(a.points[0].x, a.points[0].y);
    for (const p of a.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else if (a.tool === "text" && a.text) {
    const size = a.fontSize ?? Math.max(16, a.stroke * 5);
    const stack = fontStackFor(a.fontFamily);
    ctx.font = `${a.italic ? "italic " : ""}${a.bold ? "700 " : ""}${size}px ${stack}`;
    ctx.textBaseline = "top";
    ctx.textAlign = a.align ?? "left";
    ctx.fillText(a.text, a.x1, a.y1);
    if (a.underline) {
      const tw = ctx.measureText(a.text).width;
      const ux = a.align === "center" ? a.x1 - tw / 2 : a.align === "right" ? a.x1 - tw : a.x1;
      ctx.fillRect(ux, a.y1 + size + 2, tw, Math.max(2, size / 14));
    }
    ctx.textAlign = "left";
  } else if (a.tool === "numberedCircle") {
    const r = Math.max(12, a.stroke * 3);
    ctx.beginPath();
    ctx.arc(a.x1, a.y1, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = isLightColor(a.color) ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.42)";
    ctx.stroke();
    ctx.fillStyle = isLightColor(a.color) ? "#111" : "#fff";
    ctx.font = `700 ${r}px "Segoe UI Variable", "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(a.counter ?? 1), a.x1, a.y1);
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, stroke: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 10 + stroke * 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

export function annotationBounds(a: Annotation): { x: number; y: number; w: number; h: number } {
  if (a.tool === "numberedCircle") {
    const r = Math.max(12, a.stroke * 3);
    return { x: a.x1 - r, y: a.y1 - r, w: r * 2, h: r * 2 };
  }
  if (a.tool === "text") {
    const size = a.fontSize ?? Math.max(16, a.stroke * 5);
    const w = Math.max(40, (a.text?.length ?? 1) * size * 0.55);
    return { x: a.x1, y: a.y1, w, h: size * 1.3 };
  }
  if (a.tool === "freehand" && a.points?.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of a.points) {
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return {
    x: Math.min(a.x1, a.x2),
    y: Math.min(a.y1, a.y2),
    w: Math.abs(a.x2 - a.x1),
    h: Math.abs(a.y2 - a.y1),
  };
}

// NOTE: hit-testing uses the unrotated AABB (BetterShot parity for select/
// resize is approximate on rotated shapes); drawShape rotates about the box
// center, and the rotate handle orbits the box top-center.
export function hitTest(a: Annotation, p: Point, pad = 8): boolean {
  const b = annotationBounds(a);
  return p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;
}

export type Handle =
  | "topLeft" | "top" | "topRight" | "right"
  | "bottomRight" | "bottom" | "bottomLeft" | "left" | "move" | "rotate";

/** Rotate-handle anchor above the selection box (canvas pixels at scale 1). */
export const ROTATE_HANDLE_DY = 24;

export function rotateHandlePos(b: { x: number; y: number; w: number; h: number }, scale = 1): Point {
  return { x: b.x + b.w / 2, y: b.y - ROTATE_HANDLE_DY / scale };
}

export function hitHandle(p: Point, b: { x: number; y: number; w: number; h: number }, scale = 1): Handle | null {
  const hs = 7 / scale;
  const rh = rotateHandlePos(b, scale);
  if (Math.abs(p.x - rh.x) <= hs + 2 / scale && Math.abs(p.y - rh.y) <= hs + 2 / scale) return "rotate";
  const pts: Array<[Handle, number, number]> = [
    ["topLeft", b.x, b.y],
    ["top", b.x + b.w / 2, b.y],
    ["topRight", b.x + b.w, b.y],
    ["right", b.x + b.w, b.y + b.h / 2],
    ["bottomRight", b.x + b.w, b.y + b.h],
    ["bottom", b.x + b.w / 2, b.y + b.h],
    ["bottomLeft", b.x, b.y + b.h],
    ["left", b.x, b.y + b.h / 2],
  ];
  for (const [h, x, y] of pts) {
    if (Math.abs(p.x - x) <= hs && Math.abs(p.y - y) <= hs) return h;
  }
  if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return "move";
  return null;
}
export function applyHandle(
  handle: Handle,
  dx: number,
  dy: number,
  a: Annotation,
): Annotation {
  // Rotation is driven by angle math in the editor (needs the grab angle),
  // never by dx/dy — ignore here so a stray call can't corrupt rotation.
  if (handle === "rotate") return a;
  if (a.tool === "numberedCircle" || a.tool === "text") {
    return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  }
  if (a.points) {
    return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  let { x1, y1, x2, y2 } = a;
  const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
  let nl = l, nr = r, nt = t, nb = b;
  if (handle === "move") { nl += dx; nr += dx; nt += dy; nb += dy; }
  if (handle.includes("left") || handle === "left") nl += dx;
  if (handle.includes("right") || handle === "right") nr += dx;
  if (handle.includes("top") || handle === "top") nt += dy;
  if (handle.includes("bottom") || handle === "bottom") nb += dy;
  return { ...a, x1: nl, y1: nt, x2: nr, y2: nb };
}

export function drawSelection(ctx: CanvasRenderingContext2D, a: Annotation, scale: number) {
  const b = annotationBounds(a);
  ctx.save();
  ctx.strokeStyle = "#3182ed";
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  ctx.fillStyle = "#fff";
  const hs = 6 / scale;
  const pts = [
    [b.x, b.y], [b.x + b.w / 2, b.y], [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h / 2], [b.x + b.w, b.y + b.h],
    [b.x + b.w / 2, b.y + b.h], [b.x, b.y + b.h], [b.x, b.y + b.h / 2],
  ];
  for (const [x, y] of pts) {
    ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2);
    ctx.strokeRect(x - hs, y - hs, hs * 2, hs * 2);
  }
  // Rotate handle: stem + circle above the box top-center.
  const rh = rotateHandlePos(b, scale);
  const rr = 7 / scale;
  ctx.beginPath();
  ctx.moveTo(b.x + b.w / 2, b.y);
  ctx.lineTo(rh.x, rh.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(rh.x, rh.y, rr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
