import { BrowserWindow, screen, ipcMain, desktopCapturer } from "electron";
import path from "node:path";
import { getPref } from "../preferences";
import { preloadPath } from "../paths";
import { showCountdown } from "../overlay/countdown";
import { startRegionSelection } from "../overlay/regionSelection";
import { showOnDeck } from "../preview/deck";
import { HistoryStore } from "../history/store";
import { showToast } from "../toast/toast";
import { openVideoEditor } from "../editor/videoPresenter";
import {
  isRecordingActive,
  pauseSession,
  recordingSnapshot,
  resumeSession,
  startSession,
  stopSession,
  handleWorkerEvent,
  takeBlob,
  refreshMediaDevices,
  lastCameraSidecar,
} from "./engine";
import { performCapture } from "../capture/orchestrator";

/**
 * Shared capture/recording bar — RecordingPickerBar + RecordingControlPresenter.
 * Capture height 64, recording height 38.
 */

type UiState = "idle" | "countdown" | "recording" | "paused";

let barWin: BrowserWindow | null = null;
let ui: UiState = "idle";
let optionsMode = false;
let tickTimer: NodeJS.Timeout | null = null;

export async function showRecordingBar(showOptions = false) {
  optionsMode = showOptions;
  ensureBar();
  positionBar();
  barWin?.show();
  barWin?.focus();
  push();
}

function ensureBar() {
  if (barWin && !barWin.isDestroyed()) return;
  barWin = new BrowserWindow({
    width: 760,
    height: 96,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  barWin.setAlwaysOnTop(true, "screen-saver");
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) barWin.loadURL(`${devURL}/src/entries/recording.html`);
  else barWin.loadFile(path.join(__dirname, "../dist/src/entries/recording.html"));
  barWin.on("closed", () => { barWin = null; });
}

function positionBar() {
  if (!barWin || barWin.isDestroyed()) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 760;
  const height = ui === "idle" ? 96 : 52;
  const x = Math.round(workArea.x + workArea.width / 2 - width / 2);
  const y = Math.round(workArea.y + workArea.height - height - 28);
  barWin.setBounds({ x, y, width, height });
}

function snapshot() {
  const rec = recordingSnapshot();
  return {
    state: ui,
    optionsMode,
    elapsedMs: rec.elapsedMs,
    openEditorAfterRecording: getPref("openEditorAfterRecording"),
    microphone: getPref("recordingMicrophone") || "",
    systemAudio: getPref("recordingSystemAudio"),
    showCursor: getPref("recordingShowCursor"),
    camera: getPref("recordingCamera") || "",
    timer: getPref("selfTimerDelay"),
  };
}

function push() {
  barWin?.webContents.send("recording:state", snapshot());
}

async function beginRecording(source: Parameters<typeof startSession>[0]["source"]) {
  if (isRecordingActive() || ui === "countdown") return;
  barWin?.hide();
  const delay = getPref("selfTimerDelay") || 0;
  if (delay > 0) {
    ui = "countdown";
    push();
    await showCountdown(delay);
    if (ui !== "countdown") return;
  }
  try {
    await startSession({
      source,
      microphone: getPref("recordingMicrophone") || null,
      systemAudio: getPref("recordingSystemAudio"),
      showCursor: getPref("recordingShowCursor"),
      cursorStyle: getPref("recordingCursorStyle"),
      camera: getPref("recordingCamera") || null,
      fps: getPref("recordingFps"),
    });
    ui = "recording";
    ensureBar();
    positionBar();
    barWin?.showInactive();
    push();
    startTicker();
  } catch (err) {
    ui = "idle";
    showToast({ title: "Couldn't start recording", message: String(err), icon: "error" });
    barWin?.show();
    push();
  }
}

export async function finishRecording(save: boolean) {
  stopTicker();
  const out = await stopSession(save);
  ui = "idle";
  positionBar();
  push();
  barWin?.hide();
  if (save && out) {
    HistoryStore.shared.importCapture(out, false, "recording");
    // BetterShot-faithful: camera stays a separate camera.mov-style sidecar,
    // never baked in. Surface it as its own gallery item so the UI does not
    // imply PiP. (Worker PiP path stays dead until a real compositor lands.)
    const cam = lastCameraSidecar();
    if (cam) {
      HistoryStore.shared.importCapture(cam.path, false, "recording");
      showToast({ message: "Recording + separate camera file saved!", icon: "success" });
    } else {
      showToast({ message: "Recording saved!", icon: "success" });
    }
    showOnDeck(out);
    if (getPref("openEditorAfterRecording")) openVideoEditor(out);
  } else if (!save) {
    showToast({ message: "Recording discarded", icon: "info" });
  }
}

function startTicker() {
  stopTicker();
  tickTimer = setInterval(() => push(), 250);
}

export function startAreaRecordingFromBar() {
  barWin?.hide();
  void startRegionSelection(false, "select").then((outcome) => {
    if (outcome.kind === "region" && outcome.rect) {
      void beginRecording({ type: "area", rect: outcome.rect, displayId: outcome.displayId });
    } else {
      barWin?.show();
    }
  });
}

function stopTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

export function registerRecordingIpc() {
  ipcMain.on("recording:start", () => void beginRecording({ type: "display" }));
  ipcMain.on("recording:startDisplay", (_e, sourceId?: string, displayId?: number) =>
    void beginRecording({ type: "display", sourceId, displayId }),
  );
  ipcMain.on("recording:startWindow", (_e, sourceId: string, title?: string) =>
    void beginRecording({ type: "window", sourceId, title }),
  );
  ipcMain.on("recording:startArea", () => startAreaRecordingFromBar());
  ipcMain.on("recording:stop", () => void finishRecording(true));
  ipcMain.on("recording:discard", () => void finishRecording(false));
  ipcMain.on("recording:pause", () => {
    void pauseSession().then(() => {
      ui = "paused";
      push();
    });
  });
  ipcMain.on("recording:resume", () => {
    void resumeSession().then(() => {
      ui = "recording";
      push();
    });
  });
  ipcMain.on("recording:restart", () => {
    void finishRecording(false).then(() => beginRecording({ type: "display" }));
  });
  ipcMain.on("recording:hide", () => barWin?.hide());
  ipcMain.on("recording:setOptionsMode", (_e, v: boolean) => {
    optionsMode = v;
    push();
  });
  ipcMain.on("recording:worker-event", (_e, kind: string, payload: unknown) => handleWorkerEvent(kind, payload));
  ipcMain.handle("recording:save-blob", (_e, bytes: unknown) => {
    takeBlob(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array));
    return true;
  });
  ipcMain.handle("recording:listScreens", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      displayId: s.display_id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
  ipcMain.handle("recording:listWindows", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["window"],
      thumbnailSize: { width: 240, height: 135 },
      fetchWindowIcons: true,
    });
    return sources
      .filter((s) => s.name && !/reflecto/i.test(s.name))
      .map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
  ipcMain.handle("recording:listDevices", async () => {
    const chromium = await refreshMediaDevices();
    if (chromium.length) return chromium;
    const { listDshowDevices } = await import("./ffmpeg");
    return listDshowDevices();
  });
  ipcMain.on("capturebar:action", (_e, kind: string) => {
    barWin?.hide();
    if (kind === "region") void startRegionSelection();
    else void performCapture({ kind: kind as never });
  });
}

export function hideRecordingBar() {
  barWin?.hide();
}

export async function recordingStopSave() {
  if (ui === "recording" || ui === "paused") await finishRecording(true);
}

export async function recordingDiscard() {
  if (ui === "recording" || ui === "paused" || ui === "countdown") await finishRecording(false);
}

export async function recordingPauseToggle() {
  if (ui === "recording") {
    await pauseSession();
    ui = "paused";
    push();
  } else if (ui === "paused") {
    await resumeSession();
    ui = "recording";
    push();
  }
}
