import { clipboard, nativeImage, desktopCapturer, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { captureDisplay } from "../overlay/windows";
import { getPref, setPref } from "../preferences";
import { dismissAndRun } from "../tray";
import { runOCR } from "../ocr/tesseract";
import { startColorPicker } from "../overlay/colorPicker";
import { DeckStaging } from "../preview/deckStaging";
import { showOnDeck, editItem, pinItem, saveItem } from "../preview/deck";
import { copyImageToClipboard } from "../preview/fileActions";
import { showToast } from "../toast/toast";
import { startRegionSelection } from "../overlay/regionSelection";
import { showCountdown } from "../overlay/countdown";
import { beautifyPNG } from "../preview/beautifier";

/**
 * Port of Sources/Capture/CaptureOrchestrator.swift.
 * Every screenshot starts in private staging; only explicit Save exports it.
 */
export type CaptureKind =
  | "region"
  | "fullscreen"
  | "window"
  | "ocr"
  | "ocrSingleLine"
  | "colorPicker"
  | "timedRegion"
  | "regionCopy"
  | "regionSave"
  | "regionEdit"
  | "regionPin"
  | "previousRegion";

export interface CaptureRequest {
  kind: CaptureKind;
  rect?: { x: number; y: number; width: number; height: number };
  displayId?: number;
  windowId?: string;
}

let captureInProgress = false;
const pending: CaptureRequest[] = [];

export async function performCapture(req: CaptureRequest): Promise<void> {
  if (captureInProgress) {
    pending.push(req);
    return;
  }
  captureInProgress = true;
  try {
    await executeCapture(req);
    while (pending.length) {
      const next = pending.shift()!;
      await executeCapture(next);
    }
  } finally {
    captureInProgress = false;
  }
}

async function executeCapture(req: CaptureRequest): Promise<void> {
  switch (req.kind) {
    case "region":
    case "timedRegion":
    case "regionCopy":
    case "regionSave":
    case "regionEdit":
    case "regionPin": {
      if (!req.rect) {
        await startRegionSelection();
        return;
      }
      await captureAndProcess(req);
      break;
    }
    case "previousRegion": {
      const last = getPref("lastRegionRect");
      if (!last) return;
      await captureAndProcess({ ...req, kind: "region", rect: last, displayId: req.displayId ?? screen.getPrimaryDisplay().id });
      break;
    }
    case "fullscreen": {
      const displayId = req.displayId ?? screen.getPrimaryDisplay().id;
      const source = await captureDisplay(displayId);
      const img = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
      await processCapturedImage(img, req, displayId);
      break;
    }
    case "window": {
      if (!req.windowId) {
        const { openWindowPicker } = await import("../overlay/windowPicker");
        openWindowPicker();
        return;
      }
      const source = await captureWindowById(req.windowId);
      const img = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
      await processCapturedImage(img, req);
      break;
    }
    case "ocr":
    case "ocrSingleLine": {
      // OCR uses region selection then recognizes text (no deck card).
      const outcome = await startRegionSelection(false, "ocr");
      if (outcome.kind !== "region" || !outcome.rect || outcome.displayId == null) return;
      const source = await captureDisplay(outcome.displayId);
      const full = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
      const cropped = cropImage(full, toLocalCrop(outcome.rect, outcome.displayId));
      const text = await runOCR(cropped.toPNG(), req.kind === "ocrSingleLine");
      clipboard.writeText(text);
      showToast({ title: "Copied", message: "Text copied to clipboard", icon: "ocr", displayId: outcome.displayId });
      break;
    }
    case "colorPicker": {
      const color = await startColorPicker();
      // Toast + clipboard handled inside the picker on successful click.
      void color;
      break;
    }
  }
}

async function captureAndProcess(req: CaptureRequest) {
  const displayId = req.displayId ?? screen.getPrimaryDisplay().id;
  const delay = req.kind === "timedRegion"
    ? Math.max(3, getPref("selfTimerDelay") || 3)
    : getPref("selfTimerDelay");
  if (delay > 0) {
    await countdown(delay, displayId);
  }

  const source = await captureDisplay(displayId);
  const full = nativeImage.createFromDataURL(source.thumbnail.toDataURL());
  const img = req.rect ? cropImage(full, toLocalCrop(req.rect, displayId)) : full;
  if (req.rect) setPref("lastRegionRect", req.rect);
  await processCapturedImage(img, req, displayId);
}

/** Map global screen rect → image-local crop (display-relative, device pixels). */
function toLocalCrop(
  global: { x: number; y: number; width: number; height: number },
  displayId: number,
): { x: number; y: number; width: number; height: number } {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  const scale = display.scaleFactor;
  return {
    x: Math.round((global.x - display.bounds.x) * scale),
    y: Math.round((global.y - display.bounds.y) * scale),
    width: Math.round(global.width * scale),
    height: Math.round(global.height * scale),
  };
}

async function processCapturedImage(
  img: Electron.NativeImage,
  action: CaptureRequest,
  displayId?: number,
) {
  const stagedURL = await stageCapture(img);
  const keep = getPref("keepInDeckUntilSaved");
  let displayURL = stagedURL;
  if (!keep) {
    const retained = DeckStaging.retain(stagedURL);
    if (retained !== stagedURL) {
      DeckStaging.discard(stagedURL);
      displayURL = retained;
    }
  }

  if (action.kind === "regionCopy" || (action.kind !== "regionSave" && getPref("copyAfterCapture"))) {
    try {
      copyImageToClipboard(displayURL);
    } catch (err) {
      showToast({
        title: "Copy Failed",
        message: err instanceof Error ? err.message : String(err),
        icon: "error",
        displayId,
      });
    }
  }

  showOnDeck(displayURL, displayId);

  if (action.kind === "regionSave") {
    saveItem(displayURL);
  } else if (action.kind === "regionPin") {
    pinItem(displayURL);
  } else if (action.kind === "regionEdit" || (getPref("openEditorAfterCapture") && action.kind !== "regionCopy")) {
    editItem(displayURL);
  }
}

/** Private staging: raw companion + beautified deliverable (CaptureOrchestrator.stageCapture). */
async function stageCapture(img: Electron.NativeImage): Promise<string> {
  DeckStaging.prepareDirectory();
  const format = getPref("exportFormat") || "png";
  const ext = format === "jpeg" ? "jpg" : "png";
  const staged = path.join(DeckStaging.directory, `reflecto_${randomUUID()}.${ext}`);
  const raw = DeckStaging.rawURL(staged);
  const png = img.toPNG();
  fs.writeFileSync(raw, png);

  const look = getPref("defaultBeautifierConfig");
  let out = png;
  try {
    out = await beautifyPNG(png, look);
  } catch (err) {
    console.warn("[Reflecto] beautify failed, using raw:", err);
    showToast({
      title: "Couldn't prepare capture",
      message: "The original screenshot is still available in the preview.",
      icon: "error",
    });
  }

  if (format === "jpeg") {
    fs.writeFileSync(staged, nativeImage.createFromBuffer(out).toJPEG(Math.round((getPref("exportQuality") || 0.9) * 100)));
  } else {
    fs.writeFileSync(staged, out);
  }
  return staged;
}

export function dismissAndPerform(kind: CaptureKind) {
  dismissAndRun(() => {
    if (kind === "region" || kind === "timedRegion" || kind === "regionCopy" || kind === "regionSave" || kind === "regionEdit" || kind === "regionPin") {
      void startRegionSelection().then((outcome) => {
        // regionSelection already triggers performCapture on complete; this path is for direct calls.
        void outcome;
      });
    } else {
      void performCapture({ kind }).catch(console.error);
    }
  });
}

async function captureWindowById(id: string): Promise<Electron.DesktopCapturerSource> {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 2560, height: 1440 },
  });
  const match = sources.find((s) => s.id === id);
  if (!match) throw new Error("Window not found");
  return match;
}

function cropImage(
  img: Electron.NativeImage,
  rect: { x: number; y: number; width: number; height: number },
) {
  const size = img.getSize();
  const x = Math.max(0, Math.min(rect.x, size.width - 1));
  const y = Math.max(0, Math.min(rect.y, size.height - 1));
  const width = Math.max(1, Math.min(rect.width, size.width - x));
  const height = Math.max(1, Math.min(rect.height, size.height - y));
  return img.crop({ x, y, width, height });
}

async function countdown(seconds: number, displayId?: number) {
  await showCountdown(seconds, displayId);
}
