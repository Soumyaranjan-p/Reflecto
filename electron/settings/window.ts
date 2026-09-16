import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { getPref, setPref, loadPreferences, defaultPreferences } from "../preferences";
import { setLaunchAtLogin, getLaunchAtLogin } from "../updater";
import { Action, defaultShortcut, displayString, effectiveShortcut, registerShortcuts, setShortcutBinding } from "../shortcuts";
import { preloadPath } from "../paths";

/**
 * Port of Sources/Settings/SettingsWindowController.swift + PreferencesView.
 * Left inspector chrome, frosted panel — General / Overlay / Shortcuts tabs first.
 */

let settingsWin: BrowserWindow | null = null;

export function openSettingsWindow(section?: string) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    if (section) settingsWin.webContents.send("settings:section", section);
    return;
  }
  settingsWin = new BrowserWindow({
    width: 720,
    height: 560,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: "Reflecto Settings",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) settingsWin.loadURL(`${devURL}/src/entries/settings.html`);
  else settingsWin.loadFile(path.join(__dirname, "../dist/src/entries/settings.html"));
  settingsWin.once("ready-to-show", () => {
    settingsWin?.show();
    if (section) settingsWin?.webContents.send("settings:section", section);
  });
  settingsWin.on("closed", () => { settingsWin = null; });
}

export function registerSettingsIpc() {
  ipcMain.handle("settings:snapshot", async () => {
    const prefs = { ...defaultPreferences, ...(loadPreferences().store as object) };
    const shortcuts: Record<string, { label: string; enabled: boolean } | null> = {};
    for (const action of Object.values(Action).filter((v) => typeof v === "number") as Action[]) {
      const s = effectiveShortcut(action);
      shortcuts[String(action)] = s ? { label: displayString(s), enabled: s.enabled } : null;
    }
    return {
      prefs,
      shortcuts,
      launchAtLogin: await getLaunchAtLogin(),
      defaults: Object.fromEntries(
        (Object.values(Action).filter((v) => typeof v === "number") as Action[])
          .map((a) => {
            const d = defaultShortcut(a);
            return [String(a), d ? displayString(d) : null];
          }),
      ),
    };
  });
  ipcMain.handle("settings:setPref", (_e, key: string, value: unknown) => {
    setPref(key as never, value as never);
    return getPref(key as never);
  });
  ipcMain.handle("settings:setLaunchAtLogin", async (_e, enabled: boolean) => {
    setLaunchAtLogin(enabled);
    return getLaunchAtLogin();
  });
  ipcMain.handle("settings:resetOverlay", () => {
    setPref("overlayCardSize", "small");
    setPref("overlayEdgeMargin", 20);
    setPref("overlayPosition", "bottomRight");
    setPref("overlayDismissDelay", 5);
    setPref("overlayToolLayout", "");
    setPref("overlayAlwaysShowActions", false);
    return true;
  });
  // Re-bind after shortcut edits (settings UI will call this).
  ipcMain.handle("settings:reregisterShortcuts", () => {
    registerShortcuts();
    return true;
  });
  ipcMain.handle("settings:setShortcut", (_e, action: number, shortcut: { keyCode: number; modifiers: number; enabled: boolean } | null) => {
    return setShortcutBinding(action, shortcut);
  });
  ipcMain.handle("settings:r2Test", async () => {
    const { testR2Connection } = await import("../sharing/r2");
    await testR2Connection();
    return true;
  });
}
