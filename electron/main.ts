import { app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { createTray, setCaptureHandler, registerTrayIpc, dismissPopover } from "./tray";
import { registerShortcuts, unregisterShortcuts, Action, onShortcut } from "./shortcuts";
import { loadPreferences, getPref, setPref } from "./preferences";
import { preloadPath } from "./paths";
import { registerRegionOverlayHandlers, startRegionSelection, setRegionCompleteHandler, cancelRegionSelection } from "./overlay/regionSelection";
import { performCapture, type CaptureKind } from "./capture/orchestrator";
import { initUpdater, setLaunchAtLogin, getLaunchAtLogin } from "./updater";
import { registerDeckIpc, showOnDeck, toggleDeckVisibility, saveAll, clearAll, getLastCaptureUrl, pinItem } from "./preview/deck";
import { registerPinIpc, unpinAll, hasPinnedWindows } from "./preview/pin";
import { openAnnotateEditor } from "./editor/annotatePresenter";
import { openOnboardingWindow, registerOnboardingIpc, shouldPresentOnboarding, markOnboardingSeen } from "./onboarding/window";
import { HistoryStore } from "./history/store";
import { onBusEvent } from "./bus";
import { openSettingsWindow, registerSettingsIpc } from "./settings/window";
import { openGalleryWindow, registerGalleryIpc } from "./gallery/window";
import { showRecordingBar, registerRecordingIpc, recordingStopSave, recordingPauseToggle, startAreaRecordingFromBar, recordingDiscard } from "./recording/bar";
import { registerColorPickerIpc } from "./overlay/colorPicker";
import { registerWindowPickerIpc } from "./overlay/windowPicker";
import { copyImageToClipboard, saveToDefaultLocation } from "./preview/fileActions";
import { randomUUID } from "node:crypto";
import { exportEditedVideo } from "./recording/exportVideo";
import { isR2Configured, uploadShare } from "./sharing/r2";

/**
 * Reflecto main process — port of Sources/App/BetterShotApp.swift +
 * BetterShotDelegate.swift (tray-only lifecycle, editor presentation).
 */
let tray: ReturnType<typeof createTray> | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    const url = argv.find((a) => a.startsWith("reflecto://"));
    if (url) handleReflectoUrl(url);
  });

  app.whenReady().then(async () => {
    loadPreferences();
    if (process.defaultApp) {
      if (process.argv.length >= 2) app.setAsDefaultProtocolClient("reflecto", process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient("reflecto");
    }
    HistoryStore.shared; // init library
    setRegionCompleteHandler((outcome, mode, captureKind) => {
      if (mode !== "capture") return;
      if (outcome.kind === "region" && outcome.rect && outcome.displayId != null) {
        const kind = (captureKind as CaptureKind) || "region";
        void performCapture({ kind, rect: outcome.rect, displayId: outcome.displayId });
      } else if (outcome.kind === "window") {
        void performCapture({ kind: "window" });
      }
    });
registerIpc();
    registerOnboardingIpc();
    tray = createTray();

  function openDevWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Reflecto",
    backgroundColor: "#111111",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;

  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    void win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return win;
}

if (process.env.VITE_DEV_SERVER_URL) {
  openDevWindow();
}

wireShortcuts();
  setCaptureHandler((kind) => handleTrayCapture(kind));
  initUpdater();
  if (HistoryStore.shared.records.length && getPref("onboardingSeenVersion") === 0) {
      markOnboardingSeen();
    }
    const isE2E = process.argv.some((a) => a.includes("e2e"));
    if (!isE2E && shouldPresentOnboarding()) openOnboardingWindow();
    const launchUrl = process.argv.find((a) => a.startsWith("reflecto://"));
    if (launchUrl) handleReflectoUrl(launchUrl);
    if (process.argv.includes("--record-e2e")) {
      const { runRecordingE2E } = await import("./recording/e2e");
      const report = await runRecordingE2E();
      console.log("E2E_REPORT", report);
      app.exit(0);
      return;
    }
    if (process.argv.includes("--editor-e2e")) {
      const { runEditorE2E } = await import("./e2e/editorE2E");
      const report = await runEditorE2E();
      console.log("EDITOR_E2E_REPORT", report);
      app.exit(0);
      return;
    }
    if (process.argv.includes("--app-e2e")) {
      const { runAppE2E } = await import("./e2e/appE2E");
      const report = await runAppE2E();
      console.log("APP_E2E_REPORT", report);
      if (!process.argv.includes("--url-e2e")) {
        app.exit(0);
        return;
      }
    }
    if (process.argv.includes("--url-e2e")) {
      const ready = path.join(app.getPath("userData"), "url-e2e-ready.json");
      fs.writeFileSync(ready, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      console.log("URL_E2E_READY", ready);
    }
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
  onShortcut(Action.recordArea, () => startAreaRecordingFromBar());
  onShortcut(Action.stopRecording, () => void recordingStopSave());
  onShortcut(Action.pauseRecording, () => void recordingPauseToggle());
  onShortcut(Action.discardRecording, () => void recordingDiscard());
  onShortcut(Action.restartRecording, () => {
    void recordingDiscard().then(() => showRecordingBar(false));
  });
  onShortcut(Action.restoreLastCapture, () => {
    const last = getLastCaptureUrl();
    if (last) showOnDeck(last);
  });
  onShortcut(Action.openImage, () => void openImageFromDisk());
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
  ipcMain.handle("files:saveDocument", async (_e, payload: { dataUrl: string; baseDataUrl: string; doc: unknown }) => {
    const { buildSidecar } = await import("../src/shared/sidecar");
    const { writeSidecarFiles } = await import("./editor/sidecar");
    const composite = Buffer.from(payload.dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const base = Buffer.from(payload.baseDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (!composite.length || !base.length) throw new Error("Save needs image bytes");
    const temp = path.join(app.getPath("temp"), `reflecto-edit-${randomUUID()}.png`);
    fs.writeFileSync(temp, composite);
    const dest = saveToDefaultLocation(temp);
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
    type Sidecar = import("../src/shared/sidecar").ReflectoSidecar;
    const d = (payload.doc ?? {}) as {
      shapes?: Sidecar["shapes"];
      background?: unknown;
      canvas?: { w: number; h: number };
      crop?: Sidecar["crop"];
    };
    const doc = buildSidecar(d.shapes ?? [], d.background, d.canvas ?? { w: 0, h: 0 }, d.crop ?? null);
    return writeSidecarFiles(dest, composite, base, doc);
  });
  ipcMain.handle("editor:loadSidecar", async (_e, imagePath: string) => {
    const { loadSidecarFor } = await import("./editor/sidecar");
    return loadSidecarFor(imagePath);
  });
  ipcMain.handle("files:copyDataUrl", (_e, dataUrl: string) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const temp = path.join(app.getPath("temp"), `reflecto-clip-${randomUUID()}.png`);
    fs.writeFileSync(temp, Buffer.from(base64, "base64"));
    copyImageToClipboard(temp);
    return true;
  });
  ipcMain.handle("files:exportDataUrl", async (_e, dataUrl: string) => {
    const dest = await dialog.showSaveDialog({
      title: "Export image",
      defaultPath: path.join(app.getPath("pictures"), `Reflecto_${Date.now()}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }, { name: "JPEG", extensions: ["jpg"] }],
    });
    if (dest.canceled || !dest.filePath) return null;
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(dest.filePath, Buffer.from(base64, "base64"));
    return dest.filePath;
  });
  ipcMain.handle("files:shareDataUrl", async (_e, dataUrl: string) => {
    if (!isR2Configured()) {
      openSettingsWindow("sharing");
      return null;
    }
    const temp = path.join(app.getPath("temp"), `reflecto-share-${randomUUID()}.png`);
    fs.writeFileSync(temp, Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64"));
    const url = await uploadShare(temp);
    clipboard.writeText(url);
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
    return url;
  });
  ipcMain.handle("video:export", async (_e, req) => {
    const audioOnly = (req as { audioOnly?: string }).audioOnly;
    const container = (req as { container?: string }).container;
    const opts: Electron.SaveDialogOptions = audioOnly === "wav"
      ? {
        title: "Export audio",
        defaultPath: path.join(app.getPath("videos"), `Reflecto_${Date.now()}.wav`),
        filters: [{ name: "WAV", extensions: ["wav"] }],
      }
      : audioOnly === "m4a"
        ? {
          title: "Export audio",
          defaultPath: path.join(app.getPath("videos"), `Reflecto_${Date.now()}.m4a`),
          filters: [{ name: "M4A", extensions: ["m4a"] }],
        }
        : container === "mov"
          ? {
            title: "Export video",
            defaultPath: path.join(app.getPath("videos"), `Reflecto_${Date.now()}.mov`),
            filters: [{ name: "MOV", extensions: ["mov"] }],
          }
          : {
            title: "Export video",
            defaultPath: path.join(app.getPath("videos"), `Reflecto_${Date.now()}.mp4`),
            filters: [{ name: "MP4", extensions: ["mp4"] }],
          };
    const dest = await dialog.showSaveDialog(opts);
    if (dest.canceled || !dest.filePath) return null;
    return exportEditedVideo({ ...req, dest: dest.filePath });
  });
  ipcMain.handle("video:pickAudio", async () => {
    const picked = await dialog.showOpenDialog({
      title: "Choose replacement audio",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["m4a", "mp3", "wav", "aac", "aiff", "ogg", "flac"] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    return picked.filePaths[0];
  });
  ipcMain.on("files:startDrag", (e, filePath: string) => {
    e.sender.startDrag({ file: filePath, icon: nativeImage.createEmpty() });
  });
  ipcMain.handle("files:reveal", (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle("editor:smartRedact", async (_e, payload: { dataUrl: string; width: number; height: number }) => {
    const { smartRedactBoxes } = await import("./ocr/tesseract");
    const base64 = payload.dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    if (!buf.length) throw new Error("Smart Redact needs an image");
    return smartRedactBoxes(buf, Math.round(payload.width) || 0, Math.round(payload.height) || 0);
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

function appendUrlE2E(route: string, action: string) {
  console.log(`[Reflecto:url] route=${route} action=${action}`);
  if (!process.argv.includes("--url-e2e")) return;
  const file = path.join(app.getPath("userData"), "url-e2e.json");
  let rows: unknown[] = [];
  try {
    if (fs.existsSync(file)) rows = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
  } catch { rows = []; }
  rows.push({ at: new Date().toISOString(), route, action });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

function handleReflectoUrl(raw: string) {
  try {
    const u = new URL(raw);
    const route = `${u.hostname}${u.pathname}`.replace(/\/+$/, "").replace(/^\/+/, "");
    if (route === "capture/region" || route === "capture/region/") {
      appendUrlE2E(route, "startRegionSelection");
      void startRegionSelection();
      if (process.argv.includes("--url-e2e")) setTimeout(() => cancelRegionSelection(), 600);
    } else if (route === "capture/fullscreen") {
      appendUrlE2E(route, "performCapture:fullscreen");
      void performCapture({ kind: "fullscreen" });
    } else if (route === "capture/window") {
      appendUrlE2E(route, "performCapture:window");
      void performCapture({ kind: "window" });
    } else if (route === "ocr") {
      appendUrlE2E(route, "performCapture:ocr");
      void performCapture({ kind: "ocr" });
    } else if (route === "color-picker") {
      appendUrlE2E(route, "performCapture:colorPicker");
      void performCapture({ kind: "colorPicker" });
    } else if (route === "record") {
      appendUrlE2E(route, "showRecordingBar");
      void showRecordingBar(false);
    } else if (route === "settings") {
      appendUrlE2E(route, "openSettingsWindow");
      openSettingsWindow();
    } else {
      appendUrlE2E(route, "unhandled");
    }
  } catch {
    appendUrlE2E(raw, "malformed");
  }
}

async function openImageFromDisk() {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  });
  if (!result.canceled && result.filePaths[0]) openAnnotateEditor(result.filePaths[0]);
}
