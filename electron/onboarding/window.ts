import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { getPref, setPref } from "../preferences";
import { preloadPath } from "../paths";
import { showRecordingBar } from "../recording/bar";

const CURRENT = 2;

let win: BrowserWindow | null = null;

export function shouldPresentOnboarding(): boolean {
  return getPref("onboardingSeenVersion") === 0;
}

export function markOnboardingSeen() {
  setPref("onboardingSeenVersion", CURRENT);
}

export function openOnboardingWindow() {
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 560,
    height: 620,
    show: false,
    title: "Welcome to Reflecto",
    backgroundColor: "#1e1e1e",
    webPreferences: { preload: preloadPath(), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) win.loadURL(`${devURL}/src/entries/onboarding.html`);
  else win.loadFile(path.join(__dirname, "../dist/src/entries/onboarding.html"));
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => { win = null; });
}

export function registerOnboardingIpc() {
  ipcMain.handle("onboarding:complete", (_e, openBar?: boolean) => {
    markOnboardingSeen();
    win?.close();
    if (openBar) void showRecordingBar(false);
    return { seenVersion: getPref("onboardingSeenVersion") };
  });
  ipcMain.handle("onboarding:status", () => ({
    seenVersion: getPref("onboardingSeenVersion"),
    shouldPresent: shouldPresentOnboarding(),
  }));
}
