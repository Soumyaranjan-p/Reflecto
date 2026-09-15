import { BrowserWindow, screen, ipcMain, desktopCapturer } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import { showOnDeck } from "../preview/deck";
import { HistoryStore } from "../history/store";
import { showToast } from "../toast/toast";
import { getPref } from "../preferences";
import { preloadPath } from "../paths";
import { showCountdown } from "../overlay/countdown";

/**
 * Port of RecordingBarPresenter + shared capture bar.
 * BarMetrics: capture height 64, recording height 38.
 * Recording row: Stop/timer, Pause, Restart, Discard.
 *
 * PLATFORM GAP: ScreenCaptureKit → Electron desktopCapturer + ffmpeg mux.
 */

type RecordingState = "idle" | "countdown" | "recording" | "paused";

let barWin: BrowserWindow | null = null;
let state: RecordingState = "idle";
let startedAt = 0;
let elapsedBeforePause = 0;
let ffmpeg: ChildProcessWithoutNullStreams | null = null;
let outputPath: string | null = null;
let tickTimer: NodeJS.Timeout | null = null;

export async function showRecordingBar(optionsMode = false) {
  ensureBar();
  positionBar();
  barWin?.show();
  barWin?.focus();
  barWin?.webContents.send("recording:state", snapshot(optionsMode));
}

function snapshot(optionsMode = false) {
  return {
    state,
    optionsMode,
    elapsedMs: currentElapsed(),
    openEditorAfterRecording: getPref("openEditorAfterRecording"),
  };
}

function currentElapsed(): number {
  if (state === "recording") return elapsedBeforePause + (Date.now() - startedAt);
  return elapsedBeforePause;
}

function ensureBar() {
  if (barWin && !barWin.isDestroyed()) return;
  barWin = new BrowserWindow({
    width: 420,
    height: 72,
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
  const { workArea } = screen.getPrimaryDisplay();
  const width = 420;
  const height = state === "idle" ? 72 : 46;
  const x = Math.round(workArea.x + workArea.width / 2 - width / 2);
  const y = Math.round(workArea.y + 16);
  barWin.setBounds({ x, y, width, height });
}

async function startRecording() {
  if (state === "recording" || state === "countdown") return;
  const delay = getPref("selfTimerDelay") || 0;
  if (delay > 0) {
    state = "countdown";
    push();
    await showCountdown(delay);
    if (state !== "countdown") return;
  }

  const dir = path.join(app.getPath("userData"), "recordings");
  fs.mkdirSync(dir, { recursive: true });
  outputPath = path.join(dir, `reflecto_${randomUUID()}.mp4`);

  // Prefer ffmpeg gdigrab on Windows for full-desktop capture.
  const ffmpegPath = resolveFfmpeg();
  const args = [
    "-y",
    "-f", "gdigrab",
    "-framerate", "30",
    "-i", "desktop",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    outputPath,
  ];
  try {
    ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
  } catch (err) {
    showToast({ title: "Couldn't start recording", message: String(err), icon: "error" });
    state = "idle";
    push();
    return;
  }

  state = "recording";
  startedAt = Date.now();
  elapsedBeforePause = 0;
  positionBar();
  push();
  startTicker();
}

function resolveFfmpeg(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch { /* fall through */ }
  const bundled = path.join(process.resourcesPath || "", "ffmpeg.exe");
  if (fs.existsSync(bundled)) return bundled;
  return "ffmpeg";
}

function pauseRecording() {
  if (state !== "recording" || !ffmpeg) return;
  // gdigrab doesn't pause cleanly — stop writing by signaling and keep file; full pause needs segment mux.
  // Approximate: send 'p' is not supported; we stop the process clock UI-only and note platform gap.
  elapsedBeforePause = currentElapsed();
  state = "paused";
  // Stop ffmpeg and we'll restart on resume into a new segment later; for v1 just pause the timer.
  push();
}

function resumeRecording() {
  if (state !== "paused") return;
  state = "recording";
  startedAt = Date.now();
  push();
}

async function stopRecording(save: boolean) {
  stopTicker();
  const out = outputPath;
  if (ffmpeg) {
    try {
      ffmpeg.stdin.write("q");
      ffmpeg.stdin.end();
    } catch {
      ffmpeg.kill("SIGINT");
    }
    await new Promise<void>((resolve) => {
      ffmpeg?.once("close", () => resolve());
      setTimeout(resolve, 3000);
    });
    ffmpeg = null;
  }
  state = "idle";
  elapsedBeforePause = 0;
  outputPath = null;
  positionBar();
  push();
  barWin?.hide();

  if (save && out && fs.existsSync(out) && fs.statSync(out).size > 0) {
    HistoryStore.shared.importCapture(out, false, "recording");
    showOnDeck(out);
    showToast({ message: "Recording saved!", icon: "success" });
  } else if (out) {
    try { fs.unlinkSync(out); } catch { /* ignore */ }
    if (!save) showToast({ message: "Recording discarded", icon: "info" });
  }
}

function restartRecording() {
  void stopRecording(false).then(() => startRecording());
}

function startTicker() {
  stopTicker();
  tickTimer = setInterval(() => push(), 250);
}

function stopTicker() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function push() {
  barWin?.webContents.send("recording:state", snapshot(false));
}

export function registerRecordingIpc() {
  ipcMain.on("recording:start", () => void startRecording());
  ipcMain.on("recording:stop", () => void stopRecording(true));
  ipcMain.on("recording:discard", () => void stopRecording(false));
  ipcMain.on("recording:pause", () => pauseRecording());
  ipcMain.on("recording:resume", () => resumeRecording());
  ipcMain.on("recording:restart", () => restartRecording());
  ipcMain.on("recording:hide", () => barWin?.hide());
  ipcMain.handle("recording:listScreens", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
  });
}
