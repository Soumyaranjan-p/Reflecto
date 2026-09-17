/** Port of AnnotationTool.swift + AnnotationSwatch.swift */

export type AnnotationTool =
  | "select"
  | "rectangle"
  | "filledRectangle"
  | "ellipse"
  | "line"
  | "arrow"
  | "freehand"
  | "numberedCircle"
  | "text"
  | "highlight"
  | "pixelate"
  | "blur";

export type EditorMode = AnnotationTool | "crop";

export interface Point {
  x: number;
  y: number;
}

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  stroke: number;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  counter?: number;
  points?: Point[];
  rotation?: number;
  redactionStrength?: number;
}

export interface Swatch {
  id: string;
  title: string;
  color: string;
}

export const SWATCHES: Swatch[] = [
  { id: "black", title: "Black", color: "#050506" },
  { id: "red", title: "Red", color: "#f73833" },
  { id: "orange", title: "Orange", color: "#ff8714" },
  { id: "yellow", title: "Yellow", color: "#ffd12e" },
  { id: "green", title: "Green", color: "#2eb85c" },
  { id: "turquoise", title: "Turquoise", color: "#33c4b8" },
  { id: "blue", title: "Blue", color: "#2e7aff" },
  { id: "purple", title: "Purple", color: "#8c4cf2" },
  { id: "pink", title: "Pink", color: "#ff2e6e" },
  { id: "white", title: "White", color: "#f5f5f5" },
];

export const TOOLS: Array<{ id: AnnotationTool; label: string; key?: string; help: string }> = [
  { id: "select", label: "Select", key: "H", help: "Select / move" },
  { id: "rectangle", label: "Rect", key: "R", help: "Rectangle" },
  { id: "filledRectangle", label: "Fill", help: "Solid rectangle" },
  { id: "ellipse", label: "Circle", key: "O", help: "Circle" },
  { id: "line", label: "Line", key: "L", help: "Straight line" },
  { id: "arrow", label: "Arrow", key: "A", help: "Arrow" },
  { id: "freehand", label: "Draw", help: "Freehand" },
  { id: "numberedCircle", label: "1", key: "1", help: "Numbered circle" },
  { id: "text", label: "Text", key: "T", help: "Text" },
  { id: "highlight", label: "Spot", help: "Spotlight — keep an area visible; dim the rest" },
  { id: "pixelate", label: "Pixel", key: "P", help: "Pixelate" },
  { id: "blur", label: "Blur", key: "B", help: "Blur" },
];

export function supportsColor(tool: AnnotationTool): boolean {
  return !["select", "pixelate", "blur", "highlight"].includes(tool);
}

export function supportsStroke(tool: AnnotationTool): boolean {
  return ["rectangle", "ellipse", "line", "arrow", "freehand"].includes(tool);
}

export function isRedaction(tool: AnnotationTool): boolean {
  return tool === "pixelate" || tool === "blur";
}

export function isLightColor(hex: string): boolean {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.68;
}
