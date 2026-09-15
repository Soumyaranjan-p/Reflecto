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

export interface BeautifierConfig {
  style: BackgroundStyle;
  padding: number;
  cornerRadius: number;
  shadowStrength: number;
  aspectRatio: "auto" | "1:1" | "4:3" | "3:2" | "16:9" | "9:16";
  border: BeautifierBorder;
}

export const defaultBeautifierConfig: BeautifierConfig = {
  style: { kind: "none" },
  padding: 0.08,
  cornerRadius: 0.018,
  shadowStrength: 0.36,
  aspectRatio: "auto",
  border: { enabled: false, color: "#ffffff", thickness: 0.012, opacity: 1 },
};

export function beautifierNeedsCanvas(config: BeautifierConfig): boolean {
  return config.style.kind !== "none" || Boolean(config.border?.enabled);
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
