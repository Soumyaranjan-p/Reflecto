import { app, BrowserWindow } from "electron";
import path from "node:path";
import { createTray } from "./tray";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts";
import { loadPreferences } from "./preferences";

app.disableHardwareAcceleration === undefined; // keep GPU for canvas windows

let tray: ReturnType<typeof createTray> | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Tray-only app: a second launch just re-shows nothing; kept for parity with NSApplication single instance.
  });

  app.whenReady().then(() => {
    loadPreferences();
    tray = createTray();
    registerShortcuts();
  });
}

app.on("will-quit", () => {
  unregisterShortcuts();
});

app.on("window-all-closed", () => {
  // Tray app: stay alive with no windows (matches LSUIElement behavior).
});

// Reflecto is a tray-first app; do not show in taskbar by default.
// PLATFORM GAP (Windows/macOS): macOS used LSUIElement; on Windows we hide
// windows from the taskbar individually via skipTaskbar:true.
export function windowIconPath(): string {
  return path.join(process.env.VITE_DEV_SERVER_URL ? "." : __dirname, "../build/icon.ico");
}

export function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows();
}
