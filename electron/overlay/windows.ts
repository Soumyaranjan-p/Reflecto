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
  const displays = screen.getAllDisplays();
  const target = displays.find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(target.size.width * target.scaleFactor),
      height: Math.round(target.size.height * target.scaleFactor),
    },
  });
  const byId = sources.find((s) => s.display_id && s.display_id === String(displayId));
  if (byId) return byId;
  const index = displays.findIndex((d) => d.id === displayId);
  if (index >= 0 && sources[index]) return sources[index];
  const wantW = Math.round(target.size.width * target.scaleFactor);
  const wantH = Math.round(target.size.height * target.scaleFactor);
  const bySize = sources.find((s) => {
    const size = s.thumbnail.getSize();
    return Math.abs(size.width - wantW) <= 2 && Math.abs(size.height - wantH) <= 2;
  });
  if (bySize) return bySize;
  const fallback = sources[0];
  if (!fallback) throw new Error("No screen source available");
  return fallback;
}
