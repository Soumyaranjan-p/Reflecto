import { screen, BrowserWindow, ipcMain } from "electron";
import { createRegionOverlayWindow } from "./windows";
import { RegionGeometry, type Rect } from "../capture/regionGeometry";
import { getPref, setPref } from "../preferences";

/**
 * Port of Sources/Capture/RegionSelectionOverlay.swift — window layer + completion protocol.
 */

export type RegionMode = "capture" | "ocr" | "select";

export interface RegionSelectionOutcome {
  kind: "region" | "window" | "cancelled";
  rect?: Rect;
  displayId?: number;
}

type CompleteHandler = (outcome: RegionSelectionOutcome, mode: RegionMode) => void;

let active: BrowserWindow[] = [];
let resolver: ((o: RegionSelectionOutcome) => void) | null = null;
let currentMode: RegionMode = "capture";
let onComplete: CompleteHandler | null = null;

/** Main registers capture routing here to avoid a circular import with orchestrator. */
export function setRegionCompleteHandler(fn: CompleteHandler) {
  onComplete = fn;
}

export function startRegionSelection(
  allowsWindowSelection = true,
  mode: RegionMode = "capture",
): Promise<RegionSelectionOutcome> {
  return new Promise((resolve) => {
    if (resolver) {
      finish({ kind: "cancelled" });
    }
    resolver = resolve;
    currentMode = mode;
    active = [];
    const displays = screen.getAllDisplays();
    const lastRegion = getPref("lastRegionRect");
    for (const display of displays) {
      const win = createRegionOverlayWindow(display);
      win.webContents.once("did-finish-load", () => {
        win.webContents.send("regionoverlay:start", {
          displayId: display.id,
          bounds: display.bounds,
          scaleFactor: display.scaleFactor,
          allowsWindowSelection: allowsWindowSelection && mode === "capture",
          ghost:
            lastRegion && RegionGeometry.contains(display.bounds, lastRegion)
              ? RegionGeometry.localRect(lastRegion, display.bounds)
              : null,
          capturesOnRelease: getPref("captureRegionOnRelease"),
        });
      });
      win.show();
      active.push(win);
    }
  });
}

function finish(outcome: RegionSelectionOutcome) {
  for (const win of active) {
    if (!win.isDestroyed()) win.destroy();
  }
  active = [];
  const resolve = resolver;
  const mode = currentMode;
  resolver = null;
  resolve?.(outcome);
  if (outcome.kind !== "cancelled") {
    onComplete?.(outcome, mode);
  }
}

export function registerRegionOverlayHandlers() {
  ipcMain.handle("regionoverlay:complete", (_e, payload: RegionSelectionOutcome) => {
    if (payload.kind === "region" && payload.rect && payload.displayId != null) {
      const display = screen.getAllDisplays().find((d) => d.id === payload.displayId);
      if (display) {
        const global = RegionGeometry.globalRect(payload.rect, display.bounds);
        setPref("lastRegionRect", global);
        finish({ ...payload, rect: global });
        return;
      }
    }
    finish(payload);
  });
  ipcMain.handle("regionoverlay:cancel", () => finish({ kind: "cancelled" }));
}
