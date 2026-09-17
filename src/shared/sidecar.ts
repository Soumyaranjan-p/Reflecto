/**
 * Reflecto edit-document sidecar — port of BetterShot's AnnotationDocument.swift.
 *
 * BetterShot stores `{version, baseImageFileName, shapes, bindings, background}`
 * as JSON in a separate `<image>.bettershot` file next to the display image,
 * plus an untouched base image (`<stem>.base.<ext>`), and auto-loads both when
 * the editor opens a capture (AnnotationEditorModel.load).
 *
 * Differences (deliberate, stated):
 * - No `bindings`: Reflecto arrows have no terminal bindings to persist.
 * - No `baseImageFileName` inside the doc: the base path is derived from the
 *   image path by convention (`stem.base.ext`), same as BetterShot's
 *   baseImageURL(for:) helper.
 * - ADDS `canvas` (base dims at save) and `crop` (last applied crop, pre-crop
 *   coords): Reflecto has no base-image replacement flow, so crop is stored
 *   for provenance/validation. Shapes are already post-crop at save time, so
 *   crop is informational and NEVER re-applied on load.
 * - Unknown future `version` values are rejected (flat open), mirroring
 *   BetterShot ignoring v1 shapes it cannot express.
 */

import {
  normalizeBeautifierConfig,
  type BeautifierConfig,
} from "./beautifierTypes";
import type { Annotation, AnnotationTool } from "../editor/types";

export const SIDECAR_VERSION = 1;
export const SIDECAR_SUFFIX = ".reflecto.json";

export interface SidecarCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReflectoSidecar {
  version: number;
  shapes: Annotation[];
  background: BeautifierConfig;
  canvas: { w: number; h: number };
  crop: SidecarCrop | null;
  savedAt: string;
}

const KNOWN_TOOLS: AnnotationTool[] = [
  "select",
  "rectangle",
  "filledRectangle",
  "ellipse",
  "line",
  "arrow",
  "freehand",
  "numberedCircle",
  "text",
  "highlight",
  "pixelate",
  "blur",
];

const finite = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function sanitizeShape(raw: unknown): Annotation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (!KNOWN_TOOLS.includes(r.tool as AnnotationTool)) return null;
  const shape: Annotation = {
    id: r.id,
    tool: r.tool as AnnotationTool,
    x1: finite(r.x1),
    y1: finite(r.y1),
    x2: finite(r.x2),
    y2: finite(r.y2),
    color: typeof r.color === "string" ? r.color : "#f73833",
    stroke: finite(r.stroke, 4),
  };
  if (typeof r.text === "string") shape.text = r.text;
  if (r.fontSize !== undefined) shape.fontSize = finite(r.fontSize, 28);
  if (r.bold !== undefined) shape.bold = r.bold === true;
  if (r.italic !== undefined) shape.italic = r.italic === true;
  if (r.underline !== undefined) shape.underline = r.underline === true;
  if (r.align === "left" || r.align === "center" || r.align === "right") shape.align = r.align;
  if (r.counter !== undefined) shape.counter = Math.round(finite(r.counter, 1));
  if (r.rotation !== undefined) shape.rotation = finite(r.rotation);
  if (r.redactionStrength !== undefined) shape.redactionStrength = finite(r.redactionStrength, 0.7);
  if (Array.isArray(r.points)) {
    const pts: { x: number; y: number }[] = [];
    for (const p of r.points) {
      const c = p as { x?: unknown; y?: unknown } | null;
      if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
        pts.push({ x: c.x as number, y: c.y as number });
      }
    }
    if (pts.length) shape.points = pts;
  }
  return shape;
}

export function buildSidecar(
  shapes: Annotation[],
  background: unknown,
  canvas: { w: number; h: number },
  crop: SidecarCrop | null,
): ReflectoSidecar {
  return {
    version: SIDECAR_VERSION,
    shapes: shapes.map((s) => sanitizeShape(s)).filter((s): s is Annotation => s !== null),
    background: normalizeBeautifierConfig(background),
    canvas: { w: Math.round(canvas.w), h: Math.round(canvas.h) },
    crop: crop ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h } : null,
    savedAt: new Date().toISOString(),
  };
}

/** Parse + validate. Returns null for unknown versions or corrupt JSON. */
export function parseSidecar(json: string): { doc: ReflectoSidecar; dropped: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== SIDECAR_VERSION) return null;
  const shapes = Array.isArray(r.shapes) ? r.shapes : [];
  const clean: Annotation[] = [];
  let dropped = 0;
  for (const s of shapes) {
    const c = sanitizeShape(s);
    if (c) clean.push(c);
    else dropped++;
  }
  const canvas = (r.canvas ?? {}) as { w?: unknown; h?: unknown };
  const cropRaw = (r.crop ?? null) as SidecarCrop | null;
  return {
    doc: {
      version: SIDECAR_VERSION,
      shapes: clean,
      background: normalizeBeautifierConfig(r.background),
      canvas: { w: Math.max(1, Math.round(finite(canvas.w, 1))), h: Math.max(1, Math.round(finite(canvas.h, 1))) },
      crop:
        cropRaw && typeof cropRaw === "object"
          ? { x: finite(cropRaw.x), y: finite(cropRaw.y), w: finite(cropRaw.w), h: finite(cropRaw.h) }
          : null,
      savedAt: typeof r.savedAt === "string" ? r.savedAt : "",
    },
    dropped,
  };
}

/** `<image>.reflecto.json` (appended extension, like `<image>.bettershot`). */
export function sidecarPathFor(imagePath: string): string {
  return `${imagePath}${SIDECAR_SUFFIX}`;
}

/** `<stem>.base.<ext>` next to the display image (like BetterShot). */
export function baseImagePathFor(imagePath: string): string {
  const sep = Math.max(imagePath.lastIndexOf("/"), imagePath.lastIndexOf("\\"));
  const dir = sep >= 0 ? imagePath.slice(0, sep + 1) : "";
  const file = sep >= 0 ? imagePath.slice(sep + 1) : imagePath;
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return `${dir}${file}.base`;
  return `${dir}${file.slice(0, dot)}.base${file.slice(dot)}`;
}
