import { app } from "electron";
import { autoUpdater } from "electron-updater";
import AutoLaunch from "auto-launch";
import path from "node:path";

/**
 * Port of Sources/Services/AppUpdater.swift (Sparkle) + onboarding login item.
 * PLATFORM GAP: Sparkle appcast → electron-updater feed; configure
 * publish.provider in electron-builder.yml for your update server.
 */
export function initUpdater() {
  if (app.isPackaged) {
    autoUpdater.autoDownload = false; // BetterShot prompts before download
    autoUpdater.on("update-available", (info) => {
      const { emitBus } = require("./bus");
      emitBus("updater:available", { version: info.version });
    });
    autoUpdater.checkForUpdates().catch((e) => console.warn("[Reflecto] updater:", e));
  }
}

const autoLaunch =
  process.platform === "win32"
    ? new AutoLaunch({ name: "Reflecto" })
    : null;

/**
 * PLATFORM GAP: BetterShot used SMAppService (macOS); Windows uses either
 * app.setLoginItemSettings or the `auto-launch` package registry entry.
 * electron-builder NSIS already creates a startup shortcut when
 * `nsis.createStartMenuShortcut` + runAfterFinish are set, but the toggle
 * in Settings uses this.
 */
export function setLaunchAtLogin(enabled: boolean) {
  if (autoLaunch) {
    if (enabled) void autoLaunch.enable().catch(() => {});
    else void autoLaunch.disable().catch(() => {});
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled });
  }
}

export async function getLaunchAtLogin(): Promise<boolean> {
  if (autoLaunch) {
    try {
      return await autoLaunch.isEnabled();
    } catch {
      return false;
    }
  }
  return app.getLoginItemSettings().openAtLogin;
}
