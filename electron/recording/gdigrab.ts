import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, screen } from "electron";
import { even, resolveFfmpeg, runFfmpeg } from "./ffmpeg";
import { evenRect, getWindowRect, parseCapturerHwnd, type WinRect } from "../win32";

function toPhysical(rect: { x: number; y: number; width: number; height: number }): WinRect {
  return evenRect(screen.dipToScreenRect(null, rect));
}

function clampToDesktop(rect: WinRect): WinRect {
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  for (const d of screen.getAllDisplays()) {
    const p = screen.dipToScreenRect(null, d.bounds);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y + p.height);
  }
  const x = Math.max(minX, rect.x);
  const y = Math.max(minY, rect.y);
  const right = Math.min(maxX, rect.x + rect.width);
  const bottom = Math.min(maxY, rect.y + rect.height);
  return evenRect({
    x,
    y,
    width: Math.max(2, right - x),
    height: Math.max(2, bottom - y),
  });
}

export type CursorStyle = "recorded" | "hidden" | "dark" | "light" | "dot" | "hand";
export type CursorMotion = "natural" | "smooth";

export interface GdiStart {
  kind: "display" | "area" | "window";
  hwnd?: number;
  title?: string;
  rect?: WinRect;
  fps: number;
  drawMouse: boolean;
}

export interface GdiInfo {
  args: string[];
  dest: string;
  expected: WinRect | null;
  kind: string;
}

let proc: ChildProcess | null = null;
let current: string | null = null;
let lastInfo: GdiInfo | null = null;
let stderrBuf = "";

export function resetGdiInfo() {
  lastInfo = null;
}

export function lastGdiInfo() {
  return lastInfo;
}

function log(msg: string) {
  console.log("[Reflecto:gdigrab]", msg);
}

export function needsGdiGrab(opts: {
  sourceType: string;
  showCursor?: boolean;
  cursorStyle?: CursorStyle;
}): boolean {
  if (opts.sourceType === "window") return true;
  if (opts.showCursor === false) return true;
  if (opts.cursorStyle && opts.cursorStyle !== "recorded") return true;
  return false;
}

export async function startGdiGrab(start: GdiStart): Promise<GdiInfo> {
  await stopGdiGrab(false);
  const dest = path.join(app.getPath("temp"), `reflecto-gdi-${randomUUID()}.mkv`);
  const fps = start.fps || 30;
  const args = [
    "-y",
    "-f", "gdigrab",
    "-framerate", String(fps),
    "-draw_mouse", start.drawMouse ? "1" : "0",
    "-thread_queue_size", "1024",
  ];
  let expected: WinRect | null = null;
  if (start.kind === "window") {
    expected = start.rect ? evenRect(start.rect) : (start.hwnd ? getWindowRect(start.hwnd) : null);
    if (expected) {
      const r = clampToDesktop(expected);
      expected = r;
      args.push(
        "-offset_x", String(r.x),
        "-offset_y", String(r.y),
        "-video_size", `${r.width}x${r.height}`,
        "-i", "desktop",
      );
    } else if (start.title) {
      args.push("-i", `title=${start.title}`);
    } else {
      throw new Error("Window recording needs bounds or a window title (gdigrab has no hwnd= input)");
    }
  } else if (start.kind === "area" && start.rect) {
    const r = toPhysical(start.rect);
    expected = r;
    args.push(
      "-offset_x", String(r.x),
      "-offset_y", String(r.y),
      "-video_size", `${Math.max(2, r.width)}x${Math.max(2, r.height)}`,
      "-i", "desktop",
    );
  } else {
    const d = screen.getPrimaryDisplay();
    const r = toPhysical(d.bounds);
    expected = r;
    args.push(
      "-offset_x", String(r.x),
      "-offset_y", String(r.y),
      "-video_size", `${r.width}x${r.height}`,
      "-i", "desktop",
    );
  }
  args.push(
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-flush_packets", "1",
    dest,
  );
  stderrBuf = "";
  current = dest;
  lastInfo = { args, dest, expected, kind: start.kind };
  log(args.join(" "));
  await new Promise<void>((resolve, reject) => {
    proc = spawn(resolveFfmpeg(), args, { stdio: ["pipe", "ignore", "pipe"] });
    let started = false;
    const done = (err?: Error) => {
      if (started) return;
      started = true;
      if (err) reject(err);
      else resolve();
    };
    proc.stderr?.on("data", (d) => {
      const t = String(d);
      stderrBuf += t;
      if (/error|failed/i.test(t) && /gdigrab|Immediate/i.test(t)) {
        log(t.trim().slice(0, 240));
      }
      if (/frame=\s*[1-9]|time=\s*\d/.test(stderrBuf)) done();
    });
    proc.on("error", (err) => done(err));
    proc.on("close", (code) => {
      if (!started) done(new Error(`gdigrab exited ${code}: ${stderrBuf.slice(-400)}`));
    });
    setTimeout(() => done(), 4000);
  });
  return lastInfo;
}

export async function stopGdiGrab(save: boolean): Promise<string | null> {
  const file = current;
  const child = proc;
  proc = null;
  current = null;
  if (!child) return null;
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    child.once("close", finish);
    try { child.stdin?.write("q\n"); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 2500);
    setTimeout(finish, 6000);
  });
  if (!save || !file || !fs.existsSync(file) || fs.statSync(file).size < 1024) {
    log(`discarded gdigrab size=${file && fs.existsSync(file) ? fs.statSync(file).size : 0}`);
    return null;
  }
  const dest = path.join(app.getPath("userData"), "recordings", `reflecto_${randomUUID()}.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    await runFfmpeg(["-y", "-i", file, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest]);
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    log(`saved ${dest} bytes=${fs.statSync(dest).size}`);
    if (lastInfo) lastInfo.dest = dest;
    return dest;
  } catch (err) {
    log(`transcode failed, keeping mkv: ${err}`);
    return file;
  }
}

export function dipToPhysical(rect: { x: number; y: number; width: number; height: number }): WinRect {
  return toPhysical(rect);
}

export { even, parseCapturerHwnd, getWindowRect };
