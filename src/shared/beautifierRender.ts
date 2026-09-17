import {
  GRADIENT_PRESETS,
  beautifierNeedsCanvas,
  cameraHasEffect,
  normalizeBeautifierConfig,
  progressiveBlurIsActive,
  watermarkIsVisible,
  type BeautifierConfig,
  type BackgroundStyle,
} from "./beautifierTypes";
import {
  homographyFor,
  invertHomography,
  projectQuad,
  quadBounds,
  rasterizeProjected,
} from "./cameraProjection";

function aspectValue(r: BeautifierConfig["aspectRatio"]): number | null {
  switch (r) {
    case "1:1": return 1;
    case "4:3": return 4 / 3;
    case "3:2": return 3 / 2;
    case "16:9": return 16 / 9;
    case "9:16": return 9 / 16;
    default: return null;
  }
}

/** Port of BeautifierRenderer.render — canvas top-left origin. */
export function renderBeautifierToDataURL(
  sourceDataURL: string,
  config: BeautifierConfig,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        resolve(renderBeautifierFromImage(img, img.naturalWidth, img.naturalHeight, config).toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for beautifier"));
    img.src = sourceDataURL;
  });
}

/**
 * Full look compositor (single shared core for preview + export, so they
 * cannot drift): background -> screenshot plane (rounded image + outer
 * border ring, optional clipped scene blur) -> 3D camera projection (true
 * perspective homography, not affine) + shadow -> bleed scene blur ->
 * tiled watermark.
 */
export function renderBeautifierFromImage(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  config: BeautifierConfig,
): HTMLCanvasElement {
  const cfg = normalizeBeautifierConfig(config);
  const W = srcW;
  const H = srcH;
  if (!beautifierNeedsCanvas(cfg)) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
  const S = Math.min(W, H);

  // Base layout (padding + aspect), as before.
  const pad = S * cfg.padding;
  let cW = W + 2 * pad;
  let cH = H + 2 * pad;
  const ratio = aspectValue(cfg.aspectRatio);
  if (ratio) {
    if (cW / cH < ratio) cW = cH * ratio;
    else cH = cW / ratio;
  }
  cW = Math.ceil(cW);
  cH = Math.ceil(cH);
  const x = Math.round(0.5 * (cW - W));
  const y = Math.round(0.5 * (cH - H));
  const R = cfg.cornerRadius * S;

  // Screenshot plane: rounded image + outer border ring (+ clipped blur).
  const borderT = borderPixelThickness(cfg, S);
  const ringPad = borderT > 0 ? Math.ceil(borderT) + 1 : 0;
  const plane = buildScreenshotPlane(img, W, H, R, cfg, ringPad, S);
  const planeW = plane.width;
  const planeH = plane.height;
  // Plane origin in base-canvas coords (image top-left minus ring margin).
  const planeX = x - ringPad;
  const planeY = y - ringPad;

  // Camera quad (image-plane coords -> base-canvas coords).
  const cam = cameraHasEffect(cfg.camera);
  let quad = {
    topLeft: { x: planeX, y: planeY },
    topRight: { x: planeX + planeW, y: planeY },
    bottomRight: { x: planeX + planeW, y: planeY + planeH },
    bottomLeft: { x: planeX, y: planeY + planeH },
  };
  if (cam) {
    const q = projectQuad(planeW, planeH, cW, cH, cfg.camera);
    quad = {
      topLeft: { x: q.topLeft.x + planeX, y: q.topLeft.y + planeY },
      topRight: { x: q.topRight.x + planeX, y: q.topRight.y + planeY },
      bottomRight: { x: q.bottomRight.x + planeX, y: q.bottomRight.y + planeY },
      bottomLeft: { x: q.bottomLeft.x + planeX, y: q.bottomLeft.y + planeY },
    };
  }

  // Expand the canvas so a tilted card / bleed blur keeps breathing room
  // (BetterShot's usesCanvasLayout), then shift everything into place.
  const margin = Math.ceil(S * 0.08) + 8;
  const qb = quadBounds(quad);
  const ex0 = Math.min(0, Math.floor(qb.x) - margin);
  const ey0 = Math.min(0, Math.floor(qb.y) - margin);
  const ex1 = Math.max(cW, Math.ceil(qb.x + qb.w) + margin);
  const ey1 = Math.max(cH, Math.ceil(qb.y + qb.h) + margin);
  const shiftX = -ex0;
  const shiftY = -ey0;

  const canvas = document.createElement("canvas");
  canvas.width = ex1 - ex0;
  canvas.height = ey1 - ey0;
  const ctx = canvas.getContext("2d")!;
  drawBackground(ctx, canvas.width, canvas.height, cfg.style);

  drawScreenshot(ctx, plane, quad, shiftX, shiftY, cfg, S);

  if (progressiveBlurIsActive(cfg.progressiveBlur) && cfg.progressiveBlur.edgeMode === "bleed") {
    const blurred = applyProgressiveBlur(canvas, cfg);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurred, 0, 0);
  }

  drawWatermark(ctx, canvas.width, canvas.height, cfg);
  return canvas;
}

function borderPixelThickness(cfg: BeautifierConfig, S: number): number {
  const b = cfg.border;
  if (!b?.enabled || !(b.thickness > 0) || !(b.opacity > 0)) return 0;
  return Math.max(0, b.thickness) * S;
}

/** Rounded screenshot + outer border ring on a transparent plane. */
function buildScreenshotPlane(
  img: CanvasImageSource,
  W: number,
  H: number,
  R: number,
  cfg: BeautifierConfig,
  ringPad: number,
  S: number,
): HTMLCanvasElement {
  const plane = document.createElement("canvas");
  plane.width = Math.max(1, Math.ceil(W + 2 * ringPad));
  plane.height = Math.max(1, Math.ceil(H + 2 * ringPad));
  const pctx = plane.getContext("2d")!;
  const bx = ringPad;
  const by = ringPad;
  const t = borderPixelThickness(cfg, S);

  if (t > 0) {
    // Outer ring: backing fill of the expanded rounded rect with the image
    // rect knocked out (evenodd) — exact t-wide ring, like BetterShot's
    // frame backing (which fills cardPath behind the image).
    pctx.save();
    pctx.beginPath();
    roundedRectPath(pctx, bx - t, by - t, W + 2 * t, H + 2 * t, R + t);
    roundedRectPath(pctx, bx, by, W, H, R);
    pctx.fillStyle = cfg.border.color;
    pctx.globalAlpha = Math.min(1, Math.max(0, cfg.border.opacity));
    pctx.fill("evenodd");
    pctx.restore();
  }

  pctx.save();
  roundedRectPath(pctx, bx, by, W, H, R);
  pctx.clip();
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(img, bx, by, W, H);
  pctx.restore();

  if (progressiveBlurIsActive(cfg.progressiveBlur) && cfg.progressiveBlur.edgeMode === "clipped") {
    const blurred = applyProgressiveBlur(plane, cfg);
    pctx.clearRect(0, 0, plane.width, plane.height);
    pctx.drawImage(blurred, 0, 0);
  }
  return plane;
}

/** Flat draw or true-perspective draw of the plane, with alpha-following shadow. */
function drawScreenshot(
  ctx: CanvasRenderingContext2D,
  plane: HTMLCanvasElement,
  quad: { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomRight: { x: number; y: number }; bottomLeft: { x: number; y: number } },
  shiftX: number,
  shiftY: number,
  cfg: BeautifierConfig,
  S: number,
): void {
  const cam = cameraHasEffect(cfg.camera);
  const blur = Math.max(2, S * (0.035 + cfg.shadowStrength * 0.035));
  const yOff = S * (0.012 + cfg.shadowStrength * 0.018);
  if (!cam) {
    const dx = quad.topLeft.x + shiftX;
    const dy = quad.topLeft.y + shiftY;
    if (cfg.shadowStrength > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${cfg.shadowStrength * 0.36})`;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = yOff;
      ctx.drawImage(plane, dx, dy);
      ctx.restore();
    } else {
      ctx.drawImage(plane, dx, dy);
    }
    return;
  }
  // Perspective path: inverse-map the plane through the quad homography.
  const H = homographyFor(0, 0, plane.width, plane.height, {
    topLeft: { x: quad.topLeft.x + shiftX, y: quad.topLeft.y + shiftY },
    topRight: { x: quad.topRight.x + shiftX, y: quad.topRight.y + shiftY },
    bottomRight: { x: quad.bottomRight.x + shiftX, y: quad.bottomRight.y + shiftY },
    bottomLeft: { x: quad.bottomLeft.x + shiftX, y: quad.bottomLeft.y + shiftY },
  });
  if (!H) {
    ctx.drawImage(plane, quad.topLeft.x + shiftX, quad.topLeft.y + shiftY);
    return;
  }
  const inv = invertHomography(H);
  if (!inv) {
    ctx.drawImage(plane, quad.topLeft.x + shiftX, quad.topLeft.y + shiftY);
    return;
  }
  const srcCtx = plane.getContext("2d")!;
  const srcData = srcCtx.getImageData(0, 0, plane.width, plane.height);
  const qb = quadBounds({
    topLeft: { x: quad.topLeft.x + shiftX, y: quad.topLeft.y + shiftY },
    topRight: { x: quad.topRight.x + shiftX, y: quad.topRight.y + shiftY },
    bottomRight: { x: quad.bottomRight.x + shiftX, y: quad.bottomRight.y + shiftY },
    bottomLeft: { x: quad.bottomLeft.x + shiftX, y: quad.bottomLeft.y + shiftY },
  });
  const fx = Math.floor(qb.x);
  const fy = Math.floor(qb.y);
  const fw = Math.max(1, Math.ceil(qb.x + qb.w) - fx);
  const fh = Math.max(1, Math.ceil(qb.y + qb.h) - fy);
  const dest = new ImageData(fw, fh);
  rasterizeProjected(srcData, inv, dest, fx, fy);
  const proj = document.createElement("canvas");
  proj.width = fw;
  proj.height = fh;
  proj.getContext("2d")!.putImageData(dest, 0, 0);
  if (cfg.shadowStrength > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${cfg.shadowStrength * 0.36})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = yOff;
    ctx.drawImage(proj, fx, fy);
    ctx.restore();
  } else {
    ctx.drawImage(proj, fx, fy);
  }
}

interface BlurGeometry {
  focus: { x: number; y: number };
  normal: { x: number; y: number };
  focusRadius: number;
  halfWidth: number;
  transition: number;
  renderRadius: number;
  maxDist: number;
}

function blurGeometry(w: number, h: number, cfg: BeautifierConfig): BlurGeometry {
  const b = cfg.progressiveBlur;
  const S = Math.min(w, h);
  const fx = Math.min(1, Math.max(0, b.focusPosition.x)) * w;
  const fy = Math.min(1, Math.max(0, b.focusPosition.y)) * h;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const maxCorner = Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - fx, cy - fy)));
  const a = (b.directionDegrees * Math.PI) / 180;
  const normal = { x: -Math.sin(a), y: Math.cos(a) };
  const maxDir = Math.max(...corners.map(([cx, cy]) => Math.abs((cx - fx) * normal.x + (cy - fy) * normal.y)));
  const fs = Math.min(1, Math.max(0, b.focusSize));
  const fall = Math.min(1, Math.max(0, b.falloff));
  return {
    focus: { x: fx, y: fy },
    normal,
    focusRadius: 0.04 * S + fs * Math.max(0, maxCorner - 0.04 * S),
    halfWidth: 0.025 * S + fs * Math.max(0, maxDir - 0.025 * S),
    transition: S * (0.1 + fall * 0.48),
    renderRadius: Math.max(0.5, b.strength * S / 1000),
    maxDist: Math.max(maxCorner, maxDir, 1),
  };
}

/**
 * Layered canvas approximation of Core Image's masked variable blur:
 * K increasingly-blurred full copies composited through gradient alpha
 * bands (radial rings / directional strips). Returns a new canvas.
 */
export function applyProgressiveBlur(
  source: HTMLCanvasElement,
  cfg: BeautifierConfig,
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const g = blurGeometry(w, h, cfg);
  const K = 5;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.drawImage(source, 0, 0);

  const blurredCopies: HTMLCanvasElement[] = [];
  for (let i = 1; i <= K; i++) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cctx = c.getContext("2d")!;
    cctx.filter = `blur(${(g.renderRadius * i / K).toFixed(2)}px)`;
    cctx.drawImage(source, 0, 0);
    blurredCopies.push(c);
  }

  // Masked composite of one blurred copy through one gradient band.
  const compositeBand = (
    blurred: HTMLCanvasElement,
    inner: number,
    outer: number,
    directionalSign: 0 | 1 | -1,
  ) => {
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d")!;
    let grad: CanvasGradient;
    if (cfg.progressiveBlur.mode === "radial" || directionalSign === 0) {
      grad = mctx.createRadialGradient(g.focus.x, g.focus.y, Math.max(0, inner), g.focus.x, g.focus.y, Math.max(0.5, outer));
    } else {
      const n = directionalSign === 1 ? g.normal : { x: -g.normal.x, y: -g.normal.y };
      grad = mctx.createLinearGradient(
        g.focus.x + n.x * inner, g.focus.y + n.y * inner,
        g.focus.x + n.x * outer, g.focus.y + n.y * outer,
      );
    }
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(255,255,255,1)");
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, w, h);
    const band = document.createElement("canvas");
    band.width = w;
    band.height = h;
    const bctx = band.getContext("2d")!;
    bctx.drawImage(mask, 0, 0);
    bctx.globalCompositeOperation = "source-in";
    bctx.drawImage(blurred, 0, 0);
    octx.drawImage(band, 0, 0);
  };

  for (let i = 1; i <= K; i++) {
    const inner = bandInner(g, cfg, i - 1, K);
    const outer = bandInner(g, cfg, i, K);
    if (cfg.progressiveBlur.mode === "radial") {
      compositeBand(blurredCopies[i - 1], inner, outer, 0);
    } else {
      compositeBand(blurredCopies[i - 1], inner, outer, 1);
      compositeBand(blurredCopies[i - 1], inner, outer, -1);
    }
  }
  return out;
}

function bandInner(g: BlurGeometry, cfg: BeautifierConfig, step: number, K: number): number {
  const base = cfg.progressiveBlur.mode === "radial" ? g.focusRadius : g.halfWidth;
  return base + (g.transition * step) / K;
}

/**
 * Diagonal tiled watermark — port of drawWatermark: density rows over the
 * canvas height, 2.2x horizontal spacing, diagonal-sized grid centered on
 * the canvas, rotated about the center, clipped to the canvas.
 */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cfg: BeautifierConfig,
): void {
  const wm = cfg.watermark;
  const text = (wm.text ?? "").trim();
  if (!watermarkIsVisible(cfg.watermark) || w <= 1 || h <= 1) return;
  const rows = Math.max(2, Math.round(wm.density));
  const spacingY = h / rows;
  const spacingX = Math.max(1, spacingY * 2.2);
  const diagonal = Math.hypot(w, h);
  const columnCount = Math.max(2, Math.ceil(diagonal / spacingX));
  const rowCount = Math.max(2, Math.ceil(diagonal / spacingY));
  const originX = w / 2 - (columnCount * spacingX) / 2;
  const originY = h / 2 - (rowCount * spacingY) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-wm.rotationDegrees * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.font = `600 ${Math.max(1, wm.fontSize)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = wm.color;
  ctx.globalAlpha = Math.min(0.75, Math.max(0, wm.opacity));
  for (let row = 0; row <= rowCount; row++) {
    for (let col = 0; col <= columnCount; col++) {
      ctx.fillText(text, originX + col * spacingX, originY + row * spacingY);
    }
  }
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  style: BackgroundStyle,
) {
  if (style.kind === "solid") {
    const [r, g, b] = style.rgb;
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (style.kind === "gradient") {
    const preset = GRADIENT_PRESETS.find((p) => p.id === style.id) ?? GRADIENT_PRESETS[0];
    const grad = ctx.createLinearGradient(w * 0.5, 0, w * 0.5, h);
    for (const s of preset.stops) grad.addColorStop(s.at, s.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    for (const hi of [...preset.highlights].reverse()) {
      const hx = hi.x * w;
      const hy = hi.y * h;
      const rx = Math.max(hi.x, 1 - hi.x) * w * Math.SQRT2 * hi.extent;
      const ry = Math.max(hi.y, 1 - hi.y) * h * Math.SQRT2 * hi.extent;
      const rg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(rx, ry));
      rg.addColorStop(0, `rgba(255,255,255,${hi.opacity})`);
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(Math.max(0, r), w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  roundedRectPath(ctx, x, y, w, h, r);
}
