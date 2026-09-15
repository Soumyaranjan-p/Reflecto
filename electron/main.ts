import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createTray, setCaptureHandler, registerTrayIpc, dismissPopover } from "./tray";
import { registerShortcuts, unregisterShortcuts, Action, onShortcut } from "./shortcuts";
import { loadPreferences, getPref, setPref } from "./preferences";
import { registerRegionOverlayHandlers, startRegionSelection, setRegionCompleteHandler } from "./overlay/regionSelection";
import { performCapture, type CaptureKind } from "./capture/orchestrator";
import { initUpdater, setLaunchAtLogin, getLaunchAtLogin } from "./updater";
import { registerDeckIpc, showOnDeck, toggleDeckVisibility, saveAll, clearAll, getLastCaptureUrl, pinItem } from "./preview/deck";
import { registerPinIpc, unpinAll, hasPinnedWindows } from "./preview/pin";
import { HistoryStore } from "./history/store";
import { onBusEvent } from "./bus";
import { openSettingsWindow, registerSettingsIpc } from "./settings/window";
import { openGalleryWindow, registerGalleryIpc } from "./gallery/window";
import { showRecordingBar, registerRecordingIpc } from "./recording/bar";
import { registerColorPickerIpc } from "./overlay/colorPicker";
import { registerWindowPickerIpc } from "./overlay/windowPicker";
import { copyImageToClipboard, saveToDefaultLocation } from "./preview/fileActions";
import { randomUUID } from "node:crypto";

/**
 * Reflecto main process — port of Sources/App/BetterShotApp.swift +
 * BetterShotDelegate.swift (tray-only lifecycle, editor presentation).
 */
let tray: ReturnType<typeof createTray> | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Tray-only app: second launch does nothing visible.
  });

  app.whenReady().then(() => {
    loadPreferences();
    HistoryStore.shared; // init library
    setRegionCompleteHandler((outcome, mode) => {
      if (mode !== "capture") return;
      if (outcome.kind === "region" && outcome.rect && outcome.displayId != null) {
        void performCapture({ kind: "region", rect: outcome.rect, displayId: outcome.displayId });
      } else if (outcome.kind === "window") {
        void performCapture({ kind: "window" });
      }
    });
    registerIpc();
    tray = createTray();
    wireShortcuts();
    setCaptureHandler((kind) => handleTrayCapture(kind));
    initUpdater();
    onBusEvent((channel, payload) => {
      void channel;
      void payload;
    });
  });
}

function handleTrayCapture(kind: string) {
  const captureKinds: CaptureKind[] = [
    "region", "fullscreen", "window", "ocr", "ocrSingleLine", "colorPicker",
    "timedRegion", "regionCopy", "regionSave", "regionEdit", "regionPin", "previousRegion",
  ];
  if (kind === "region") {
    void startRegionSelection();
    return;
  }
  if (kind === "recordingOptions" || kind === "recording") {
    void showRecordingBar(kind === "recordingOptions");
    return;
  }
  if (captureKinds.includes(kind as CaptureKind)) {
    void performCapture({ kind: kind as CaptureKind }).catch((err) =>
      console.error("[Reflecto] capture failed:", err),
    );
    return;
  }
  if (kind === "mediaGallery") {
    openGalleryWindow();
    return;
  }
  if (kind === "settings") {
    openSettingsWindow();
    return;
  }
  if (kind === "quit") {
    app.quit();
    return;
  }
  if (kind === "unpinAll") {
    unpinAll();
  }
}

function wireShortcuts() {
  // Bind handlers first, then register accelerators once.
  onShortcut(Action.region, () => void startRegionSelection());
  onShortcut(Action.fullscreen, () => void performCapture({ kind: "fullscreen" }));
  onShortcut(Action.window, () => void performCapture({ kind: "window" }));
  onShortcut(Action.ocr, () => void performCapture({ kind: "ocr" }));
  onShortcut(Action.ocrSingleLine, () => void performCapture({ kind: "ocrSingleLine" }));
  onShortcut(Action.colorPicker, () => void performCapture({ kind: "colorPicker" }));
  onShortcut(Action.previousRegion, () => void performCapture({ kind: "previousRegion" }));
  onShortcut(Action.timedRegion, () => void performCapture({ kind: "timedRegion" }));
  onShortcut(Action.regionCopy, () => void performCapture({ kind: "regionCopy" }));
  onShortcut(Action.regionSave, () => void performCapture({ kind: "regionSave" }));
  onShortcut(Action.regionEdit, () => void performCapture({ kind: "regionEdit" }));
  onShortcut(Action.regionPin, () => void performCapture({ kind: "regionPin" }));
  onShortcut(Action.recording, () => void showRecordingBar(false));
  onShortcut(Action.recordingOptions, () => void showRecordingBar(true));
  onShortcut(Action.mediaGallery, () => openGalleryWindow());
  onShortcut(Action.openSettings, () => openSettingsWindow());
  onShortcut(Action.togglePreviews, () => toggleDeckVisibility());
  onShortcut(Action.savePreviews, () => saveAll());
  onShortcut(Action.closePreviews, () => clearAll());
  onShortcut(Action.unpinAll, () => unpinAll());
  onShortcut(Action.pinLastCapture, () => {
    const last = getLastCaptureUrl();
    if (last) pinItem(last);
  });
  registerShortcuts();
}

function registerIpc() {
  registerTrayIpc();
  registerRegionOverlayHandlers();
  registerDeckIpc();
  registerPinIpc();
  registerSettingsIpc();
  registerGalleryIpc();
  registerRecordingIpc();
  registerColorPickerIpc();
  registerWindowPickerIpc();

  ipcMain.handle("capture:perform", (_e, req) => performCapture(req));
  ipcMain.handle("capture:startRegionSelection", (_e, allowsWindowSelection?: boolean) =>
    startRegionSelection(allowsWindowSelection),
  );

  ipcMain.handle("capture:listWindows", async () => {
    const { desktopCapturer } = await import("electron");
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name && s.name !== "Reflecto")
      .map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        icon: s.appIcon?.toDataURL() ?? null,
      }));
  });
  ipcMain.handle("capture:windowById", async (_e, id: string) => {
    void performCapture({ kind: "window", windowId: id });
    return true;
  });

  ipcMain.handle("prefs:get", () => ({ ...loadPreferences().store }));
  ipcMain.handle("prefs:set", (_e, key: string, value: unknown) => {
    setPref(key as never, value as never);
    return true;
  });
  ipcMain.handle("prefs:getSingle", (_e, key: string) => getPref(key as never));

  ipcMain.handle("history:recents", () => {
    const shots = HistoryStore.shared.recent("screenshot", 8).map((r) => ({
      filename: r.filename,
      kind: r.kind as "screenshot" | "recording",
      id: r.id,
      path: HistoryStore.shared.displayURLForRecord(r),
    }));
    const recs = HistoryStore.shared.recent("recording", 8).map((r) => ({
      filename: r.filename,
      kind: r.kind as "screenshot" | "recording",
      id: r.id,
      path: HistoryStore.shared.displayURLForRecord(r),
    }));
    return [...shots, ...recs];
  });
  ipcMain.handle("history:open", (_e, filePath: string) => {
    if (fs.existsSync(filePath)) showOnDeck(filePath);
  });
  ipcMain.handle("pins:hasAny", () => hasPinnedWindows());
  ipcMain.handle("pins:unpinAll", () => unpinAll());

  ipcMain.handle("dialog:pickFolder", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("dialog:pickSaveFile", async (_e, opts: { title?: string; defaultPath?: string; filters?: Electron.FileFilter[] }) => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win ?? undefined!, opts);
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("files:saveTempPNG", (_e, base64: string) => {
    const file = path.join(app.getPath("temp"), `reflecto-${Date.now()}.png`);
    fs.writeFileSync(file, Buffer.from(base64, "base64"));
    return file;
  });
  ipcMain.handle("files:copyImage", (_e, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    return true;
  });
  ipcMain.handle("files:saveDataUrl", (_e, dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const temp = path.join(app.getPath("temp"), `reflecto-edit-${randomUUID()}.png`);
    fs.writeFileSync(temp, Buffer.from(base64, "base64"));
    const dest = saveToDefaultLocation(temp);
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
    return dest;
  });
  ipcMain.handle("files:copyDataUrl", (_e, dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const temp = path.join(app.getPath("temp"), `reflecto-clip-${randomUUID()}.png`);
    fs.writeFileSync(temp, Buffer.from(base64, "base64"));
    copyImageToClipboard(temp);
    return true;
  });
  ipcMain.on("files:startDrag", (e, filePath: string) => {
    e.sender.startDrag({ file: filePath, icon: nativeImage.createEmpty() });
  });
  ipcMain.handle("files:reveal", (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("loginItem:set", (_e, enabled: boolean) => setLaunchAtLogin(enabled));
  ipcMain.handle("loginItem:get", () => getLaunchAtLogin());

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.on("app:quit", () => app.quit());
  ipcMain.on("tray:openSettings", () => {
    dismissPopover();
    openSettingsWindow();
  });
  ipcMain.on("tray:openGallery", () => {
    dismissPopover();
    openGalleryWindow();
  });
}

app.on("will-quit", () => {
  unregisterShortcuts();
});

app.on("window-all-closed", () => {
  // Tray app: stay alive with no windows.
});
