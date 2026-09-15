import { clipboard, nativeImage, desktopCapturer, screen } from "electron";
import { captureDisplay } from "../overlay/windows";
import { getPref, setPref } from "../preferences";
import { dismissAndRun } from "../tray";
import { RegionGeometry } from "./regionGeometry";
import { runOCR } from "../ocr/tesseract";
import { pickColorAt } from "./pixelSampler";

/**
 * Port of Sources/Capture/CaptureOrchestrator.swift.
 * Executes a capture action end-to-end and routes results to the preview deck.
 */
export type CaptureKind = "region" | "fullscreen" | "window" | "ocr" | "ocrSingleLine" | "colorPicker";

export interface CaptureRequest {
  kind: CaptureKind;
  // region
  rect?: { x: number; y: number; width: number; height: number };
  displayId?: number;
}

export async function performCapture(req: CaptureRequest): Promise<void> {
  switch (req.kind) {
    case "region":
    case "fullscreen": {
      const rect = req.kind === "fullscreen" ? null : req.rect!;
      const displayId = req.displayId ?? screen.getPrimaryDisplay().id;
      const source = await captureDisplay(displayId);
      const img = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
      const cropped = rect ? cropImage(img, rect) : img;
      clipboard.writeImage(cropped);
      setPref("lastRegionRect", rect ?? getPref("lastRegionRect"));
      emitDeckShow(cropped, "screenshot");
      break;
    }
    case "window": {
      // Window capture via thumbnail/window-picker approach (user-approved v1 plan).
      // The renderer shows the picker; main handles the chosen source here.
      const source = await captureWindow();
      const img = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
      clipboard.writeImage(img);
      emitDeckShow(img, "screenshot");
      break;
    }
    case "ocr":
    case "ocrSingleLine": {
      const text = await captureAndOCR(req.kind === "ocrSingleLine");
      clipboard.writeText(text);
      break;
    }
    case "colorPicker": {
      const color = await pickColorAt();
      if (color) clipboard.writeText(color);
      break;
    }
  }
}

export function dismissAndPerform(kind: CaptureKind) {
  dismissAndRun(() => {
    if (kind === "region") startRegionSelection();
    else performCapture({ kind }).catch(console.error);
  });
}

async function startRegionSelection() {
  // Delegates to overlay/regionSelection.ts; see that file.
  const mod = (await import("../overlay/regionSelection")) as typeof import("../overlay/regionSelection");
  await mod.startRegionSelection();
}

async function captureWindow(): Promise<Electron.DesktopCapturerSource> {
  const sources: Electron.DesktopCapturerSource[] = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  // Picker UI is shown in renderer; for the direct-hotkey path, pick the frontmost
  // visible window heuristically (largest thumbnail area).
  const best = sources
    .filter((s: Electron.DesktopCapturerSource) => s.name && s.name !== "Reflecto")
    .sort((a: Electron.DesktopCapturerSource, b: Electron.DesktopCapturerSource) =>
      b.thumbnail.getSize().width * b.thumbnail.getSize().height - a.thumbnail.getSize().width * a.thumbnail.getSize().height)[0];
  if (!best) throw new Error("No window available");
  return best;
}

async function captureAndOCR(singleLine: boolean): Promise<string> {
  const rect = getPref("lastRegionRect");
  const displayId = screen.getPrimaryDisplay().id;
  const source = await captureDisplay(displayId);
  const img = rect ? cropImage(nativeImage.createFromDataURL(source.thumbnail.toDataURL()), rect) : nativeImage.createFromDataURL(source.thumbnail.toDataURL());
  const buf = img.toPNG();
  return runOCR(buf, singleLine);
}

function cropImage(img: Electron.NativeImage, rect: { x: number; y: number; width: number; height: number }) {
  return img.crop(rect);
}

async function emitDeckShow(img: Electron.NativeImage, kind: "screenshot" | "recording") {
  const { emitBus } = await import("../bus");
  emitBus("deck:show", { png: img.toPNG().toString("base64"), kind });
}
