import fs from "node:fs";
import {
  baseImagePathFor,
  parseSidecar,
  sidecarPathFor,
  type ReflectoSidecar,
} from "../../src/shared/sidecar";

/**
 * Filesystem layer for edit-document sidecars — mirrors
 * ScreenshotHistoryStore.editDocumentURL/loadEditDocument/baseImageURL:
 * display image `<stem>.png`, sidecar `<stem>.png.reflecto.json`,
 * untouched base `<stem>.base.png`, all next to each other.
 */

export interface LoadedSidecar {
  doc: ReflectoSidecar;
  /** Absolute base-image path, or null when the base file is missing. */
  basePath: string | null;
  sidecarPath: string;
  dropped: number;
}

export function writeSidecarFiles(
  destImagePath: string,
  compositePng: Buffer,
  basePng: Buffer,
  doc: ReflectoSidecar,
): { dest: string; sidecarPath: string; basePath: string } {
  fs.writeFileSync(destImagePath, compositePng);
  const basePath = baseImagePathFor(destImagePath);
  fs.writeFileSync(basePath, basePng);
  const sidecarPath = sidecarPathFor(destImagePath);
  fs.writeFileSync(sidecarPath, JSON.stringify(doc, null, 2), "utf8");
  return { dest: destImagePath, sidecarPath, basePath };
}

/** Auto-detect: parse the sidecar if present (null when absent/corrupt/versioned-out). */
export function loadSidecarFor(imagePath: string): LoadedSidecar | null {
  const sidecarPath = sidecarPathFor(imagePath);
  let raw: string;
  try {
    raw = fs.readFileSync(sidecarPath, "utf8");
  } catch {
    return null;
  }
  const parsed = parseSidecar(raw);
  if (!parsed) return null;
  const basePath = baseImagePathFor(imagePath);
  return {
    doc: parsed.doc,
    basePath: fs.existsSync(basePath) ? basePath : null,
    sidecarPath,
    dropped: parsed.dropped,
  };
}
