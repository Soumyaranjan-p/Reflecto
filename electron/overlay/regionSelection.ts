import { screen, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { createRegionOverlayWindow } from "./windows";
import { RegionGeometry, RegionAdjustment, type Rect, type RegionHandle } from "../capture/regionGeometry";
import { getPref, setPref } from "../preferences";
import { performCapture } from "../capture/orchestrator";

/**
 * Port of Sources/Capture/RegionSelectionOverlay.swift — the SelectionView logic
 * (drag-to-select, 8 handles + move, ghost reuse, guide lines, key handling)
 * lives in the renderer (src/overlay/RegionSelectionOverlay.tsx); this module
 * owns the windows and the completion protocol.
 */
interface RegionSelectionOutcome {
  kind: "region" | "window" | "cancelled";
  rect?: Rect;
  displayId?: number;
}

let active: BrowserWindow[] = [];
let resolver: ((o: RegionSelectionOutcome) => void) | null = null;

export function startRegionSelection(allowsWindowSelection = true): Promise<RegionSelectionOutcome> {
  return new Promise((resolve) => {
    resolver = resolve;
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
          allowsWindowSelection,
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
    win.destroy();
  }
  active = [];
  resolver?.(outcome);
  resolver = null;
}

export function registerRegionOverlayHandlers() {
  ipcMain.handle("regionoverlay:complete", (_e, payload: RegionSelectionOutcome) => {
    if (payload.kind === "region" && payload.rect && payload.displayId != null) {
      const display = screen.getAllDisplays().find((d) => d.id === payload.displayId);
      if (display) {
        const global = RegionGeometry.globalRect(payload.rect, display.bounds);
        setPref("lastRegionRect", global);
        void performCapture({ kind: "region", rect: global, displayId: payload.displayId });
      }
    }
    finish(payload);
  });
  ipcMain.handle("regionoverlay:cancel", () => finish({ kind: "cancelled" }));
}
