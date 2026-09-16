import { app, BrowserWindow, desktopCapturer, screen, session as electronSession } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { even, resolveFfmpeg, runFfmpeg, listDshowDevices } from "./ffmpeg";
import { getPref } from "../preferences";
import { preloadPath } from "../paths";
import {
  needsGdiGrab,
  startGdiGrab,
  stopGdiGrab,
  lastGdiInfo,
  resetGdiInfo,
  type CursorStyle,
} from "./gdigrab";
import { getWindowRect, parseCapturerHwnd } from "../win32";

/**
 * Windows equivalent of ScreenRecordingManager:
 * Chromium desktopCapturer + MediaRecorder pause/resume (BetterShot writer.pause).
 * System audio = desktop chromeMediaSource audio loopback.
 * Camera overlay composited in the capture worker (BetterShot camera bubble).
 */

export type RecordSource =
  | { type: "display"; displayId?: number; sourceId?: string }
  | { type: "area"; rect: { x: number; y: number; width: number; height: number }; displayId?: number; sourceId?: string }
  | { type: "window"; sourceId: string; title?: string };

export interface RecordingOptions {
  source: RecordSource;
  microphone?: string | null;
  systemAudio?: boolean;
  showCursor?: boolean;
  cursorStyle?: CursorStyle;
  camera?: string | null;
  fps?: number;
}

type SessionState = "idle" | "recording" | "paused";

interface Session {
  state: SessionState;
  startedAt: number;
  elapsedBeforePause: number;
  options: RecordingOptions;
  blobPath: string | null;
  log: string[];
}

let session: Session | null = null;
let worker: BrowserWindow | null = null;
let pendingStart: { resolve: () => void; reject: (e: Error) => void } | null = null;
let pendingStop: { resolve: () => void } | null = null;
let lastBlob: Buffer | null = null;
let mediaDevices: Array<{ id: string; label: string; kind: string }> = [];
let lastWorkerInfo: Record<string, unknown> | null = null;
let cameraProc: ChildProcess | null = null;
let lastCameraPath: string | null = null;
let gdiMode = false;
let pointerTimer: NodeJS.Timeout | null = null;
let pointerSamples: Array<{ t: number; x: number; y: number }> = [];
let pointerStartedAt = 0;

export function lastCameraSidecar() {
  if (!lastCameraPath || !fs.existsSync(lastCameraPath)) return null;
  return { path: lastCameraPath, size: fs.statSync(lastCameraPath).size };
}

export function lastCaptureWorkerInfo() {
  return lastWorkerInfo;
}

export function lastPointerLog() {
  return pointerSamples.slice();
}

export function recordingLog(): string[] {
  return session?.log ?? [];
}

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log("[Reflecto:record]", msg);
  session?.log.push(line);
}

export function recordingSnapshot() {
  return {
    state: (session?.state ?? "idle") as SessionState,
    elapsedMs: currentElapsed(),
    source: session?.options.source.type ?? "display",
  };
}

function currentElapsed(): number {
  if (!session) return 0;
  if (session.state === "recording") return session.elapsedBeforePause + (Date.now() - session.startedAt);
  return session.elapsedBeforePause;
}

function grantMediaPermissions() {
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "media" || permission === "clipboard-sanitized-write");
  });
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === "media" || permission === "clipboard-sanitized-write";
  });
}

export async function ensureCaptureWorker(): Promise<BrowserWindow> {
  if (worker && !worker.isDestroyed()) return worker;
  grantMediaPermissions();
  worker = new BrowserWindow({
    width: 320,
    height: 240,
    x: -640,
    y: -480,
    show: false,
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  });
  worker.showInactive();
  const ready = new Promise<void>((resolve) => {
    worker!.webContents.once("did-finish-load", () => resolve());
  });
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) await worker.loadURL(`${devURL}/src/entries/captureWorker.html`);
  else await worker.loadFile(path.join(__dirname, "../dist/src/entries/captureWorker.html"));
  await ready;
  return worker;
}

export async function startSession(options: RecordingOptions): Promise<void> {
  if (session && session.state !== "idle") return;
  session = {
    state: "idle",
    startedAt: 0,
    elapsedBeforePause: 0,
    options,
    blobPath: null,
    log: [],
  };
  lastBlob = null;
  lastWorkerInfo = null;
  resetGdiInfo();
  gdiMode = false;
  const fps = options.fps ?? getPref("recordingFps") ?? 30;
  const cursorStyle = (options.cursorStyle || (options.showCursor === false ? "hidden" : "recorded")) as CursorStyle;
  const useGdi = needsGdiGrab({
    sourceType: options.source.type,
    showCursor: options.showCursor,
    cursorStyle,
  });

  if (useGdi) {
    const sourceId = options.source.type === "window" ? options.source.sourceId : await resolveSourceId(options.source);
    const hwnd = options.source.type === "window" ? (parseCapturerHwnd(sourceId || "") ?? undefined) : undefined;
    const title = options.source.type === "window" ? options.source.title : undefined;
    const winRect = hwnd ? getWindowRect(hwnd) : undefined;
    if (options.source.type === "window") {
      log(`gdigrab window hwnd=${hwnd ?? "none"} title=${title || ""} bounds=${winRect ? `${winRect.width}x${winRect.height}+${winRect.x},${winRect.y}` : "unknown"}`);
    }
    const areaRect = options.source.type === "area" ? options.source.rect : undefined;
    await startGdiGrab({
      kind: options.source.type,
      hwnd,
      title,
      rect: winRect ?? areaRect,
      fps,
      drawMouse: cursorStyle === "recorded" && options.showCursor !== false,
    });
    gdiMode = true;
    session.state = "recording";
    session.startedAt = Date.now();
    startPointerLog();
    log(`gdigrab started draw_mouse=${cursorStyle === "recorded" && options.showCursor !== false ? 1 : 0} style=${cursorStyle}`);
    if (options.camera) await startCameraSidecar();
    return;
  }

  const win = await ensureCaptureWorker();
  const sourceId = await resolveSourceId(options.source);
  if (!sourceId) throw new Error("No desktop capture source for this display/window");
  log(`sourceId=${sourceId} type=${options.source.type} systemAudio=${Boolean(options.systemAudio)} mic=${options.microphone || "off"} cam=${options.camera || "off"}`);

  const area = options.source.type === "area" ? options.source : null;
  const display = area
    ? (area.displayId != null
      ? screen.getAllDisplays().find((d) => d.id === area.displayId)
      : screen.getDisplayMatching(area.rect))
    : undefined;
  const crop = area
    ? {
        x: area.rect.x - (display?.bounds.x ?? 0),
        y: area.rect.y - (display?.bounds.y ?? 0),
        width: area.rect.width,
        height: area.rect.height,
      }
    : null;

  await new Promise<void>((resolve, reject) => {
    pendingStart = { resolve, reject };
    win.webContents.send("recording:worker-start", {
      sourceId,
      crop,
      scaleFactor: display?.scaleFactor ?? screen.getPrimaryDisplay().scaleFactor,
      microphoneId: options.microphone || null,
      cameraId: null,
      systemAudio: Boolean(options.systemAudio),
      fps: options.fps ?? getPref("recordingFps") ?? 30,
    });
    setTimeout(() => {
      if (pendingStart) {
        pendingStart.reject(new Error("Capture worker did not start within 20s"));
        pendingStart = null;
      }
    }, 20000);
  });
  session.state = "recording";
  session.startedAt = Date.now();
  startPointerLog();
  log("MediaRecorder started");
  if (options.camera) await startCameraSidecar();
}

export async function pauseSession(): Promise<void> {
  if (!session || session.state !== "recording") return;
  session.elapsedBeforePause = currentElapsed();
  if (gdiMode) {
    log("gdigrab pause keeps capturing (Windows ffmpeg cannot pause gdigrab mid-stream); elapsed timer paused");
  } else {
    worker?.webContents.send("recording:worker-pause");
    log("paused (MediaRecorder.pause)");
  }
  session.state = "paused";
}

export async function resumeSession(): Promise<void> {
  if (!session || session.state !== "paused") return;
  if (!gdiMode) {
    worker?.webContents.send("recording:worker-resume");
    log("resumed (MediaRecorder.resume)");
  } else {
    log("gdigrab resume (timer only)");
  }
  session.state = "recording";
  session.startedAt = Date.now();
}

export async function stopSession(save: boolean): Promise<string | null> {
  if (!session) return null;
  session.elapsedBeforePause = currentElapsed();
  stopPointerLog();
  await stopCameraSidecar();
  if (gdiMode) {
    const notes = session.log;
    session = null;
    gdiMode = false;
    const dest = await stopGdiGrab(save);
    logLine(notes, dest ? `gdigrab saved ${dest}` : "gdigrab discarded");
    return dest;
  }
  await new Promise<void>((resolve) => {
    pendingStop = { resolve };
    worker?.webContents.send("recording:worker-stop");
    setTimeout(() => {
      pendingStop?.resolve();
      pendingStop = null;
    }, 8000);
  });
  const blob = lastBlob;
  const notes = session.log;
  const fps = session.options.fps ?? 30;
  session = null;
  if (!save || !blob || blob.length < 1024) {
    logLine(notes, `discarded blob=${blob?.length ?? 0}`);
    return null;
  }
  const webm = path.join(app.getPath("temp"), `reflecto-${randomUUID()}.webm`);
  fs.writeFileSync(webm, blob);
  const dest = path.join(app.getPath("userData"), "recordings", `reflecto_${randomUUID()}.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await runFfmpeg(["-y", "-i", webm, "-r", String(fps), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", dest]);
    try { fs.unlinkSync(webm); } catch { /* ignore */ }
    logLine(notes, `saved ${dest} bytes=${fs.statSync(dest).size}`);
    fs.appendFileSync(path.join(app.getPath("userData"), "recording-last.log"), notes.join("\n") + `\nsaved ${dest}\n`);
    return dest;
  } catch (err) {
    logLine(notes, `transcode failed: ${err}`);
    fs.appendFileSync(path.join(app.getPath("userData"), "recording-last.log"), notes.join("\n") + `\n${err}\n`);
    if (fs.existsSync(webm) && fs.statSync(webm).size > 1024) return webm;
    throw err;
  }
}

function logLine(notes: string[], msg: string) {
  notes.push(`[${new Date().toISOString()}] ${msg}`);
  console.log("[Reflecto:record]", msg);
}

async function startCameraSidecar() {
  await stopCameraSidecar();
  lastCameraPath = null;
  const cam = (await listDshowDevices()).find((d) => d.kind === "video");
  if (!cam) {
    log("no DirectShow camera for sidecar (BetterShot camera.mov equivalent)");
    return;
  }
  const dest = path.join(app.getPath("temp"), `reflecto-camera-${randomUUID()}.mkv`);
  lastCameraPath = dest;
  log(`camera sidecar dshow="${cam.name}" -> ${dest}`);
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    cameraProc = spawn(resolveFfmpeg(), [
      "-y",
      "-f", "dshow",
      "-rtbufsize", "64M",
      "-framerate", "30",
      "-video_size", "640x360",
      "-i", `video=${cam.name}`,
      "-an",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-pix_fmt", "yuv420p",
      "-flush_packets", "1",
      dest,
    ], { stdio: ["pipe", "ignore", "pipe"] });
    cameraProc.stderr?.on("data", (d) => {
      const line = String(d);
      if (/error|fail/i.test(line) && !/dummy/i.test(line)) log(`camera sidecar: ${line.trim().slice(0, 220)}`);
      if (/frame=\s*[1-9]/.test(line) || /time=\s*00:00:0[0-9]\.[1-9]/.test(line)) done();
    });
    cameraProc.on("error", (err) => {
      log(`camera sidecar spawn: ${err}`);
      done();
    });
    setTimeout(done, 8000);
  });
}

function stopCameraSidecar(): Promise<void> {
  const child = cameraProc;
  cameraProc = null;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      const src = lastCameraPath;
      if (src && fs.existsSync(src) && fs.statSync(src).size > 2048) {
        const remux = src.replace(/\.mkv$/i, ".mp4");
        try {
          await runFfmpeg(["-y", "-i", src, "-c", "copy", "-movflags", "+faststart", remux]);
          if (fs.existsSync(remux) && fs.statSync(remux).size > 1024) {
            try { fs.unlinkSync(src); } catch { /* ignore */ }
            lastCameraPath = remux;
            log(`camera sidecar finalized ${remux} bytes=${fs.statSync(remux).size}`);
          }
        } catch (err) {
          log(`camera sidecar remux failed, keeping mkv: ${err}`);
        }
      } else {
        log(`camera sidecar not finalized size=${src && fs.existsSync(src) ? fs.statSync(src).size : 0}`);
      }
      resolve();
    };
    child.once("close", () => { void finish(); });
    try { child.stdin?.write("q\n"); } catch { /* ignore */ }
    setTimeout(() => { try { if (!child.killed) child.kill(); } catch { /* ignore */ } }, 3000);
    setTimeout(() => { void finish(); }, 7000);
  });
}

function startPointerLog() {
  stopPointerLog();
  pointerSamples = [];
  pointerStartedAt = Date.now();
  pointerTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    pointerSamples.push({ t: Date.now() - pointerStartedAt, x: p.x, y: p.y });
  }, 16);
}

function stopPointerLog() {
  if (pointerTimer) clearInterval(pointerTimer);
  pointerTimer = null;
}

export function handleWorkerEvent(kind: string, payload: unknown) {
  if (kind === "started") {
    lastWorkerInfo = (payload && typeof payload === "object") ? payload as Record<string, unknown> : { ok: true };
    pendingStart?.resolve();
    pendingStart = null;
  } else if (kind === "warn") {
    log((payload as { message?: string })?.message || "worker warning");
  } else if (kind === "error") {
    const message = (payload as { message?: string })?.message || "capture worker error";
    log(message);
    pendingStart?.reject(new Error(message));
    pendingStart = null;
  } else if (kind === "stopped") {
    pendingStop?.resolve();
    pendingStop = null;
  } else if (kind === "devices") {
    mediaDevices = ((payload as { devices?: typeof mediaDevices })?.devices) ?? [];
  }
}

export function takeBlob(buffer: Buffer) {
  lastBlob = buffer;
}

export function cachedMediaDevices() {
  return mediaDevices;
}

export async function refreshMediaDevices(): Promise<typeof mediaDevices> {
  const win = await ensureCaptureWorker();
  win.webContents.send("recording:worker-list-devices");
  await new Promise((r) => setTimeout(r, 2500));
  return mediaDevices;
}

async function resolveSourceId(source: RecordSource): Promise<string | null> {
  if ("sourceId" in source && source.sourceId) return source.sourceId;
  const types: Array<"screen" | "window"> = source.type === "window" ? ["window"] : ["screen"];
  const sources = await desktopCapturer.getSources({ types, thumbnailSize: { width: 1, height: 1 } });
  if (source.type === "display") {
    if (source.displayId != null) {
      const match = sources.find((s) => s.display_id === String(source.displayId));
      if (match) return match.id;
      const displays = screen.getAllDisplays();
      const index = displays.findIndex((d) => d.id === source.displayId);
      if (index >= 0 && sources[index]) return sources[index].id;
    }
    return sources[0]?.id ?? null;
  }
  if (source.type === "area") {
    if (source.displayId != null) {
      const match = sources.find((s) => s.display_id === String(source.displayId));
      if (match) return match.id;
    }
    const display = screen.getDisplayMatching(source.rect);
    const match = sources.find((s) => s.display_id === String(display.id));
    return match?.id ?? sources[0]?.id ?? null;
  }
  return sources[0]?.id ?? null;
}

export function isRecordingActive(): boolean {
  return Boolean(session && session.state !== "idle");
}

export { even, resolveFfmpeg, lastGdiInfo };
