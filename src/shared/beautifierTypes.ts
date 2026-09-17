/**
 * Shared beautifier types/defaults — safe for Electron main + renderer.
 * Canvas rendering lives in src/shared/beautifierRender.ts.
 */

export type BackgroundStyle =
  | { kind: "none" }
  | { kind: "solid"; rgb: [number, number, number] }
  | { kind: "gradient"; id: string };

export interface BeautifierBorder {
  enabled: boolean;
  color: string;
  thickness: number;
  opacity: number;
}

export interface CameraSettings {
  /** Translation as a fraction of the final canvas dimensions. */
  panX: number;
  panY: number;
  /** Camera orbit around the card center, degrees. */
  tiltXDegrees: number;
  tiltYDegrees: number;
  /** Local card rotation around its own axes, degrees. */
  rotationXDegrees: number;
  rotationYDegrees: number;
  /** Rotation around the viewing axis, degrees. */
  rollDegrees: number;
  /** Lens angle 18..80 controlling perspective strength. */
  fieldOfViewDegrees: number;
  /** Explicit final scale 0.4..2.5. */
  zoom: number;
}

export type ProgressiveBlurMode = "radial" | "directional";
export type ProgressiveBlurEdgeMode = "clipped" | "bleed";

export interface ProgressiveBlurSettings {
  isEnabled: boolean;
  /** "clipped" blurs the screenshot layer only; "bleed" blurs the whole scene. */
  edgeMode: ProgressiveBlurEdgeMode;
  mode: ProgressiveBlurMode;
  /** Max blur radius, px at 1000px shortest edge (BetterShot: strength*S/1000). */
  strength: number;
  /** Sharp-to-blur transition width, 0..1. */
  falloff: number;
  /** Sharp focal area, 0..1. */
  focusSize: number;
  /** Normalized focal point (top-left origin). */
  focusPosition: { x: number; y: number };
  /** Direction of the in-focus band, degrees. 0 = horizontal band. */
  directionDegrees: number;
}

export interface WatermarkSettings {
  text: string;
  /** Rows of tiles (density). */
  density: number;
  fontSize: number;
  rotationDegrees: number;
  opacity: number;
  color: string;
}

export interface BeautifierConfig {
  style: BackgroundStyle;
  padding: number;
  cornerRadius: number;
  shadowStrength: number;
  aspectRatio: "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "9:16";
  border: BeautifierBorder;
  camera: CameraSettings;
  progressiveBlur: ProgressiveBlurSettings;
  watermark: WatermarkSettings;
}

export const defaultCameraSettings: CameraSettings = {
  panX: 0,
  panY: 0,
  tiltXDegrees: 0,
  tiltYDegrees: 0,
  rotationXDegrees: 0,
  rotationYDegrees: 0,
  rollDegrees: 0,
  fieldOfViewDegrees: 24,
  zoom: 1,
};

export const defaultProgressiveBlurSettings: ProgressiveBlurSettings = {
  isEnabled: false,
  edgeMode: "bleed",
  mode: "radial",
  strength: 18,
  falloff: 0.55,
  focusSize: 0.45,
  focusPosition: { x: 0.5, y: 0.5 },
  directionDegrees: 0,
};

export const defaultWatermarkSettings: WatermarkSettings = {
  text: "",
  density: 4,
  fontSize: 72,
  rotationDegrees: 45,
  opacity: 0.18,
  color: "#e6e6e6",
};

export const defaultBeautifierConfig: BeautifierConfig = {
  style: { kind: "none" },
  padding: 0.08,
  cornerRadius: 0.018,
  shadowStrength: 0.36,
  aspectRatio: "auto",
  border: { enabled: false, color: "#ffffff", thickness: 0.012, opacity: 1 },
  camera: { ...defaultCameraSettings },
  progressiveBlur: { ...defaultProgressiveBlurSettings },
  watermark: { ...defaultWatermarkSettings },
};

const approxZero = (v: unknown) => Math.abs(Number(v) || 0) <= 0.0001;

export function cameraHasEffect(c?: CameraSettings): boolean {
  if (!c) return false;
  return (
    !approxZero(c.panX) ||
    !approxZero(c.panY) ||
    !approxZero(c.tiltXDegrees) ||
    !approxZero(c.tiltYDegrees) ||
    !approxZero(c.rotationXDegrees) ||
    !approxZero(c.rotationYDegrees) ||
    !approxZero(c.rollDegrees) ||
    Math.abs((c.zoom ?? 1) - 1) > 0.0001
  );
}

export function progressiveBlurIsActive(b?: ProgressiveBlurSettings): boolean {
  return Boolean(b?.isEnabled && (b?.strength ?? 0) > 0.01);
}

export function watermarkIsVisible(w?: WatermarkSettings): boolean {
  return Boolean(w?.text?.trim() && (w?.opacity ?? 0) > 0);
}

/** Deep-fill stored/partial configs so old prefs never drop new sections. */
export function normalizeBeautifierConfig(raw: unknown): BeautifierConfig {
  const c = (raw ?? {}) as Partial<BeautifierConfig>;
  return {
    ...defaultBeautifierConfig,
    ...c,
    style: c.style ?? defaultBeautifierConfig.style,
    border: { ...defaultBeautifierConfig.border, ...(c.border ?? {}) },
    camera: { ...defaultCameraSettings, ...(c.camera ?? {}) },
    progressiveBlur: {
      ...defaultProgressiveBlurSettings,
      ...(c.progressiveBlur ?? {}),
      focusPosition: {
        ...defaultProgressiveBlurSettings.focusPosition,
        ...((c.progressiveBlur as ProgressiveBlurSettings | undefined)?.focusPosition ?? {}),
      },
    },
    watermark: { ...defaultWatermarkSettings, ...(c.watermark ?? {}) },
  };
}

export function beautifierNeedsCanvas(config: BeautifierConfig): boolean {
  const c = normalizeBeautifierConfig(config);
  return (
    c.style.kind !== "none" ||
    Boolean(c.border?.enabled) ||
    cameraHasEffect(c.camera) ||
    progressiveBlurIsActive(c.progressiveBlur) ||
    watermarkIsVisible(c.watermark)
  );
}

export interface GradientPreset {
  id: string;
  name: string;
  stops: Array<{ color: string; at: number }>;
  highlights: Array<{ x: number; y: number; opacity: number; extent: number }>;
}

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: "soft-blush", name: "Blush",
    stops: [{ color: "#FAFAFA", at: 0 }, { color: "#F9E8F3", at: 0.48 }, { color: "#E7C8F1", at: 1 }],
    highlights: [{ x: 0.18, y: 0.08, opacity: 0.32, extent: 0.35 }, { x: 0.86, y: 0.9, opacity: 0.16, extent: 0.34 }],
  },
  {
    id: "soft-peach", name: "Peach",
    stops: [{ color: "#FCFAF7", at: 0 }, { color: "#FBE6D8", at: 0.5 }, { color: "#FFB98D", at: 1 }],
    highlights: [{ x: 0.82, y: 0.08, opacity: 0.3, extent: 0.34 }, { x: 0.14, y: 0.88, opacity: 0.18, extent: 0.32 }],
  },
  {
    id: "soft-mint", name: "Mint",
    stops: [{ color: "#FBFCFA", at: 0 }, { color: "#E8F8F0", at: 0.48 }, { color: "#AEEACD", at: 1 }],
    highlights: [{ x: 0.18, y: 0.1, opacity: 0.34, extent: 0.36 }, { x: 0.88, y: 0.86, opacity: 0.2, extent: 0.34 }],
  },
  {
    id: "soft-blue", name: "Powder Blue",
    stops: [{ color: "#FBFCFD", at: 0 }, { color: "#E5F2FD", at: 0.5 }, { color: "#A8D7FF", at: 1 }],
    highlights: [{ x: 0.16, y: 0.08, opacity: 0.34, extent: 0.35 }, { x: 0.88, y: 0.88, opacity: 0.22, extent: 0.33 }],
  },
  {
    id: "soft-butter", name: "Butter",
    stops: [{ color: "#FDFCF7", at: 0 }, { color: "#FFF8D6", at: 0.48 }, { color: "#FFE677", at: 1 }],
    highlights: [{ x: 0.16, y: 0.08, opacity: 0.36, extent: 0.36 }, { x: 0.88, y: 0.86, opacity: 0.22, extent: 0.32 }],
  },
  {
    id: "soft-lilac", name: "Lilac",
    stops: [{ color: "#FCFBFD", at: 0 }, { color: "#EEEAFE", at: 0.44 }, { color: "#AFAEFF", at: 1 }],
    highlights: [{ x: 0.18, y: 0.07, opacity: 0.34, extent: 0.36 }, { x: 0.86, y: 0.84, opacity: 0.16, extent: 0.34 }],
  },
  {
    id: "soft-sage", name: "Sage",
    stops: [{ color: "#FCFBF7", at: 0 }, { color: "#E8EDE1", at: 0.42 }, { color: "#91AD8A", at: 1 }],
    highlights: [{ x: 0.16, y: 0.08, opacity: 0.3, extent: 0.36 }, { x: 0.88, y: 0.42, opacity: 0.2, extent: 0.31 }],
  },
  {
    id: "soft-coral", name: "Coral",
    stops: [{ color: "#FCF9F7", at: 0 }, { color: "#F9D3CD", at: 0.46 }, { color: "#FF6F73", at: 1 }],
    highlights: [{ x: 0.18, y: 0.07, opacity: 0.3, extent: 0.36 }, { x: 0.82, y: 0.7, opacity: 0.2, extent: 0.31 }],
  },
  {
    id: "soft-aqua", name: "Aqua",
    stops: [{ color: "#FBFDFD", at: 0 }, { color: "#DFF9FC", at: 0.48 }, { color: "#6FE2ED", at: 1 }],
    highlights: [{ x: 0.15, y: 0.08, opacity: 0.34, extent: 0.36 }, { x: 0.88, y: 0.87, opacity: 0.24, extent: 0.34 }],
  },
  {
    id: "soft-mauve", name: "Mauve",
    stops: [{ color: "#FBF8F6", at: 0 }, { color: "#E8DADB", at: 0.42 }, { color: "#B7949F", at: 1 }],
    highlights: [{ x: 0.17, y: 0.07, opacity: 0.3, extent: 0.36 }, { x: 0.86, y: 0.38, opacity: 0.18, extent: 0.32 }],
  },
];
