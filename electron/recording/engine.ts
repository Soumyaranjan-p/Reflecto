import { app, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { even, resolveFfmpeg, runFfmpeg } from "./ffmpeg";
import { getPref } from "../preferences";

export type RecordSource =
  | { type: "display"; displayId?: number }
  | { type: "area"; rect: { x: number; y: number; width: number; height: number } }
  | { type: "window"; title: string };

export interface RecordingOptions {
  source: RecordSource;
  microphone?: string | null;
  systemAudio?: boolean;
  showCursor?: boolean;
  camera?: string | null;
  fps?: number;
}

type SessionState = "idle" | "recording" | "paused";

interface Session {
  state: SessionState;
  startedAt: number;
  elapsedBeforePause: number;
  dir: string;
  segments: string[];
  proc: ChildProcessWithoutNullStreams | null;
  options: RecordingOptions;
}

let session: Session | null = null;

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

export async function startSession(options: RecordingOptions): Promise<void> {
  if (session && session.state !== "idle") return;
  const dir = path.join(app.getPath("temp"), `reflecto-rec-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  session = {
    state: "idle",
    startedAt: 0,
    elapsedBeforePause: 0,
    dir,
    segments: [],
    proc: null,
    options,
  };
  try {
    await spawnSegment();
  } catch (err) {
    session = null;
    throw err;
  }
}

async function spawnSegment(): Promise<void> {
  if (!session) return;
  const out = path.join(session.dir, `seg-${session.segments.length}.mp4`);
  const args = buildArgs(session.options, out);
  const proc = spawn(resolveFfmpeg(), args, { stdio: ["pipe", "pipe", "pipe"] });
  session.proc = proc;
  session.segments.push(out);
  session.state = "recording";
  session.startedAt = Date.now();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 400);
    proc.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function buildArgs(options: RecordingOptions, out: string): string[] {
  const fps = options.fps ?? getPref("recordingFps") ?? 30;
  const showCursor = options.showCursor ?? getPref("recordingShowCursor") ?? true;
  const args: string[] = ["-y", "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", showCursor ? "1" : "0"];

  if (options.source.type === "area") {
    const physical = screen.dipToScreenRect(null, options.source.rect);
    args.push(
      "-offset_x", String(Math.round(physical.x)),
      "-offset_y", String(Math.round(physical.y)),
      "-video_size", `${even(physical.width)}x${even(physical.height)}`,
      "-i", "desktop",
    );
  } else if (options.source.type === "window") {
    args.push("-i", `title=${options.source.title.replace(/"/g, "")}`);
  } else if (options.source.type === "display") {
    const source = options.source;
    const display = source.displayId != null
      ? screen.getAllDisplays().find((d) => d.id === source.displayId) ?? screen.getPrimaryDisplay()
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const physical = screen.dipToScreenRect(null, display.bounds);
    args.push(
      "-offset_x", String(Math.round(physical.x)),
      "-offset_y", String(Math.round(physical.y)),
      "-video_size", `${even(physical.width)}x${even(physical.height)}`,
      "-i", "desktop",
    );
  }

  const mic = options.microphone ?? getPref("recordingMicrophone") ?? "";
  if (mic) {
    args.push("-f", "dshow", "-i", `audio=${mic}`);
  }

  const filters: string[] = [];
  if (options.camera) {
    args.push("-f", "dshow", "-i", `video=${options.camera}`);
    const camIndex = mic ? 2 : 1;
    filters.push(`[${camIndex}:v]scale=320:-1[cam]`, `[0:v][cam]overlay=W-w-24:H-h-24[vout]`);
  }

  args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (filters.length) {
    args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
    if (mic) args.push("-map", "1:a", "-c:a", "aac");
  } else if (mic) {
    args.push("-map", "0:v", "-map", "1:a", "-c:a", "aac");
  }
  args.push(out);
  return args;
}

export async function pauseSession(): Promise<void> {
  if (!session || session.state !== "recording") return;
  session.elapsedBeforePause = currentElapsed();
  await stopProcess();
  session.state = "paused";
}

export async function resumeSession(): Promise<void> {
  if (!session || session.state !== "paused") return;
  await spawnSegment();
}

export async function stopSession(save: boolean): Promise<string | null> {
  if (!session) return null;
  session.elapsedBeforePause = currentElapsed();
  await stopProcess();
  const segs = session.segments.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);
  const dir = session.dir;
  session = null;
  if (!save || segs.length === 0) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    return null;
  }
  const dest = path.join(app.getPath("userData"), "recordings", `reflecto_${randomUUID()}.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (segs.length === 1) {
    fs.copyFileSync(segs[0], dest);
  } else {
    const list = path.join(dir, "concat.txt");
    fs.writeFileSync(list, segs.map((s) => `file '${s.replace(/\\/g, "/")}'`).join("\n"));
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", dest]);
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return dest;
}

async function stopProcess(): Promise<void> {
  const proc = session?.proc;
  if (!proc) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    proc.once("close", done);
    try {
      proc.stdin.write("q");
      proc.stdin.end();
    } catch {
      proc.kill("SIGINT");
    }
    setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
      done();
    }, 4000);
  });
  if (session) session.proc = null;
}

export function isRecordingActive(): boolean {
  return Boolean(session && session.state !== "idle");
}
