import { app, clipboard, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPref, setPref } from "../preferences";

/**
 * Port of ScreenshotFileActions (BetterShotPreferences.swift).
 * Copy uses a durable temp clipboard snapshot so dismissing the deck does not
 * invalidate pasted file references.
 */

export function defaultExportDirectory(): string {
  const configured = getPref("exportDirectory") ?? getPref("saveFolder");
  if (configured) return configured;
  const pictures = app.getPath("pictures");
  const dir = path.join(pictures, "Reflecto");
  fs.mkdirSync(dir, { recursive: true });
  if (!getPref("exportDirectory")) setPref("exportDirectory", dir);
  return dir;
}

export function exportFileName(sourcePath: string): string {
  const ext = path.extname(sourcePath).replace(".", "") || "png";
  const stamp = formatStamp(new Date());
  return `Reflecto_${stamp}.${ext}`;
}

function formatStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

function uniqueDestination(fileName: string, directory: string): string {
  let dest = path.join(directory, fileName);
  if (!fs.existsSync(dest)) return dest;
  const parsed = path.parse(fileName);
  let i = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(directory, `${parsed.name} (${i})${parsed.ext}`);
    i += 1;
  }
  return dest;
}

export function saveToDefaultLocation(from: string): string {
  const directory = defaultExportDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const dest = uniqueDestination(exportFileName(from), directory);
  fs.copyFileSync(from, dest);
  return dest;
}

export function saveCapture(from: string): string {
  return saveToDefaultLocation(from);
}

/** Clipboard snapshot that survives deck discard (BetterShot clipboard policy). */
export function copyImageToClipboard(from: string): void {
  const imageData = fs.readFileSync(from);
  const ext = path.extname(from).replace(".", "") || "png";
  const clipboardURL = path.join(
    app.getPath("temp"),
    `Reflecto-Clipboard-${randomUUID()}.${ext}`,
  );
  fs.writeFileSync(clipboardURL, imageData);

  const img = nativeImage.createFromPath(from);
  // Ensure image bytes are always available (Windows clipboard primarily uses image).
  clipboard.writeImage(img);
  try {
    clipboard.writeBuffer("FileNameW", Buffer.from(`${clipboardURL}\0`, "ucs2"));
  } catch {
    // FileNameW is optional; image copy is the required path.
  }
}
