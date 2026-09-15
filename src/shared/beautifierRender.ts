import {
  GRADIENT_PRESETS,
  beautifierNeedsCanvas,
  type BeautifierConfig,
  type BackgroundStyle,
} from "./beautifierTypes";

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
        if (!beautifierNeedsCanvas(config)) {
          resolve(sourceDataURL);
          return;
        }
        const W = img.naturalWidth;
        const H = img.naturalHeight;
        const S = Math.min(W, H);
        const pad = S * config.padding;
        let cW = W + 2 * pad;
        let cH = H + 2 * pad;
        const ratio = aspectValue(config.aspectRatio);
        if (ratio) {
          if (cW / cH < ratio) cW = cH * ratio;
          else cH = cW / ratio;
        }
        cW = Math.ceil(cW);
        cH = Math.ceil(cH);
        const x = Math.round(0.5 * (cW - W));
        const y = Math.round(0.5 * (cH - H));
        const R = config.cornerRadius * S;

        const canvas = document.createElement("canvas");
        canvas.width = cW;
        canvas.height = cH;
        const ctx = canvas.getContext("2d")!;
        drawBackground(ctx, cW, cH, config.style);

        if (config.shadowStrength > 0) {
          const blur = Math.max(2, S * (0.035 + config.shadowStrength * 0.035));
          const yOff = S * (0.012 + config.shadowStrength * 0.018);
          ctx.save();
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = yOff;
          ctx.shadowBlur = blur;
          ctx.shadowColor = `rgba(0,0,0,${config.shadowStrength * 0.36})`;
          roundedRect(ctx, x, y, W, H, R);
          ctx.fillStyle = "#000";
          ctx.fill();
          ctx.restore();
          ctx.save();
          roundedRect(ctx, x, y, W, H, R);
          ctx.clip();
          ctx.clearRect(x, y, W, H);
          ctx.restore();
        }

        ctx.save();
        roundedRect(ctx, x, y, W, H, R);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y);
        ctx.restore();
        drawBorder(ctx, x, y, W, H, R, config);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for beautifier"));
    img.src = sourceDataURL;
  });
}

/** Same framing as BetterShot's BeautifierRenderer, for live editor preview. */
export function renderBeautifierFromImage(
  img: CanvasImageSource,
  srcW: number,
  srcH: number,
  config: BeautifierConfig,
): HTMLCanvasElement {
  const W = srcW;
  const H = srcH;
  if (!beautifierNeedsCanvas(config)) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
  const S = Math.min(W, H);
  const pad = S * config.padding;
  let cW = W + 2 * pad;
  let cH = H + 2 * pad;
  const ratio = aspectValue(config.aspectRatio);
  if (ratio) {
    if (cW / cH < ratio) cW = cH * ratio;
    else cH = cW / ratio;
  }
  cW = Math.ceil(cW);
  cH = Math.ceil(cH);
  const x = Math.round(0.5 * (cW - W));
  const y = Math.round(0.5 * (cH - H));
  const R = config.cornerRadius * S;
  const canvas = document.createElement("canvas");
  canvas.width = cW;
  canvas.height = cH;
  const ctx = canvas.getContext("2d")!;
  drawBackground(ctx, cW, cH, config.style);
  if (config.shadowStrength > 0 && config.style.kind !== "none") {
    const blur = Math.max(2, S * (0.035 + config.shadowStrength * 0.035));
    const yOff = S * (0.012 + config.shadowStrength * 0.018);
    ctx.save();
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = yOff;
    ctx.shadowBlur = blur;
    ctx.shadowColor = `rgba(0,0,0,${config.shadowStrength * 0.36})`;
    roundedRect(ctx, x, y, W, H, R);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundedRect(ctx, x, y, W, H, R);
    ctx.clip();
    ctx.clearRect(x, y, W, H);
    ctx.restore();
  }
  ctx.save();
  roundedRect(ctx, x, y, W, H, R);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x, y);
  ctx.restore();
  drawBorder(ctx, x, y, W, H, R, config);
  return canvas;
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

function drawBorder(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  config: BeautifierConfig,
) {
  const border = config.border;
  if (!border?.enabled || border.thickness <= 0) return;
  const S = Math.min(w, h);
  const t = Math.max(1, border.thickness * S);
  ctx.save();
  ctx.globalAlpha = border.opacity;
  ctx.strokeStyle = border.color;
  ctx.lineWidth = t;
  roundedRect(ctx, x + t / 2, y + t / 2, w - t, h - t, Math.max(0, r - t / 2));
  ctx.stroke();
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
