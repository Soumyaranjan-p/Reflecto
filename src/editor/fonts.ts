/**
 * Font sources for the text tool — port of BetterShot's AnnoFontFamily
 * (TextMeasure.swift), which deliberately offers a curated set of faces
 * ("used to expose every installed family", cut to the faces guaranteed
 * present) rather than the system font panel.
 *
 * Windows has no NSFontPanel equivalent, so Reflecto does the same: a small
 * curated list. The model stores a plain string id per annotation (NOT a
 * closed enum), and every consumer reads through this font-source list, so
 * a future native-enumeration source (DirectWrite) can replace curated()
 * without touching the Annotation type, persistence, or rendering.
 */

export interface FontSource {
  /** Stable id persisted on the annotation. */
  id: string;
  /** Display title in the picker. */
  title: string;
  /** CSS font-family stack used for canvas + textarea rendering. */
  stack: string;
}

export const DEFAULT_FONT_ID = "segoe";

function curated(): FontSource[] {
  return [
    { id: "segoe", title: "Segoe UI", stack: `"Segoe UI Variable", "Segoe UI", sans-serif` },
    { id: "arial", title: "Arial", stack: `Arial, "Segoe UI", sans-serif` },
    { id: "georgia", title: "Georgia", stack: `Georgia, "Times New Roman", serif` },
    { id: "consolas", title: "Consolas", stack: `Consolas, "Cascadia Mono", monospace` },
    { id: "verdana", title: "Verdana", stack: `Verdana, "Segoe UI", sans-serif` },
  ];
}

/** Swap this for a native-enumeration source later; callers stay unchanged. */
export function fontSources(): FontSource[] {
  return curated();
}

export function fontStackFor(id: unknown): string {
  const fallback = curated()[0].stack;
  if (typeof id !== "string" || !id) return fallback;
  return curated().find((f) => f.id === id)?.stack ?? fallback;
}

export function fontTitleFor(id: unknown): string {
  if (typeof id !== "string" || !id) return curated()[0].title;
  return curated().find((f) => f.id === id)?.title ?? curated()[0].title;
}
