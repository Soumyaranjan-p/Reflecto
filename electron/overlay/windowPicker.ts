import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { preloadPath } from "../paths";
import { performCapture } from "../capture/orchestrator";

/**
 * Window picker — BetterShot uses macOS native window capture;
 * Reflecto shows a thumbnail grid of open windows (desktopCapturer).
 */

let pickerWin: BrowserWindow | null = null;

export function openWindowPicker() {
  if (pickerWin && !pickerWin.isDestroyed()) {
    pickerWin.focus();
    return;
  }
  pickerWin = new BrowserWindow({
    width: 720,
    height: 480,
    show: false,
    title: "Capture Window",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  pickerWin.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) pickerWin.loadURL(`${devURL}/src/entries/windowPicker.html`);
  else pickerWin.loadFile(path.join(__dirname, "../dist/src/entries/windowPicker.html"));
  pickerWin.once("ready-to-show", () => pickerWin?.show());
  pickerWin.on("closed", () => { pickerWin = null; });
}

export function registerWindowPickerIpc() {
  ipcMain.on("windowpicker:select", (_e, id: string) => {
    pickerWin?.close();
    void performCapture({ kind: "window", windowId: id });
  });
  ipcMain.on("windowpicker:cancel", () => pickerWin?.close());
}
