import { BrowserWindow, screen, desktopCapturer } from "electron";
import path from "node:path";
import { preloadPath } from "../paths";

/**
 * Port of Sources/Capture/RegionSelectionOverlay.swift — overlay window layer.
 * One transparent, always-on-top, per-display window shows the selection UI.
 */
export function createRegionOverlayWindow(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  win.setAlwaysOnTop(true, "screen-saver"); // matches maximumWindow level
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) win.loadURL(`${devURL}/src/entries/overlay.html`);
  else win.loadFile("dist/src/entries/overlay.html");
  return win;
}

export async function captureDisplay(displayId: number): Promise<Electron.DesktopCapturerSource> {
  const primary = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: primary.size.width * primary.scaleFactor,
      height: primary.size.height * primary.scaleFactor,
    },
  });
  const match = sources.find((s) => s.display_id === String(displayId)) ?? sources[0];
  if (!match) throw new Error("No screen source available");
  return match;
}
