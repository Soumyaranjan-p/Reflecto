import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, screen } from "electron";
import { even, resolveFfmpeg, runFfmpeg } from "./ffmpeg";
import { buildCursorOverlay, isCompositedCursorStyle, type CursorSample } from "./cursors";
import { evenRect, getWindowRect, parseCapturerHwnd, type WinRect } from "../win32";

export interface GdiCursorOverlay {
  style: string;
  samples: CursorSample[];
}

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
let segments: string[] = [];
let lastStart: GdiStart | null = null;

export function resetGdiInfo() {
  lastInfo = null;
  segments = [];
  lastStart = null;
}

export function gdiSegmentCount() {
  return segments.length;
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
  segments = [];
  lastStart = { ...start };
  const info = await spawnSegment(start);
  segments.push(info.dest);
  return info;
}

function buildGdiArgs(start: GdiStart, dest: string): { args: string[]; expected: WinRect | null } {
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
  return { args, expected };
}

async function spawnSegment(start: GdiStart): Promise<GdiInfo> {
  const dest = path.join(app.getPath("temp"), `reflecto-gdi-${randomUUID()}.mkv`);
  const { args, expected } = buildGdiArgs(start, dest);
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

export async function stopGdiGrab(save: boolean, cursor?: GdiCursorOverlay): Promise<string | null> {
  await terminateProc();
  const files = segments.filter((f) => fs.existsSync(f) && fs.statSync(f).size >= 1024);
  segments = [];
  lastStart = null;
  if (!save || files.length === 0) {
    for (const f of segments) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    log(`discarded gdigrab segments=${files.length}`);
    return null;
  }
  let source = files[0];
  let concatTmp: string | null = null;
  if (files.length > 1) {
    const list = path.join(app.getPath("temp"), `reflecto-concat-${randomUUID()}.txt`);
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
    concatTmp = path.join(app.getPath("temp"), `reflecto-gdi-joined-${randomUUID()}.mkv`);
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", concatTmp]);
    try { fs.unlinkSync(list); } catch { /* ignore */ }
    source = concatTmp;
    log(`concatenated ${files.length} segments -> ${concatTmp} bytes=${fs.statSync(concatTmp).size}`);
  }
  const dest = path.join(app.getPath("userData"), "recordings", `reflecto_${randomUUID()}.mp4`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    if (cursor && isCompositedCursorStyle(cursor.style) && cursor.samples.length > 0) {
      const off = lastInfo?.expected ? { x: lastInfo.expected.x, y: lastInfo.expected.y } : { x: 0, y: 0 };
      const { extraInputs, filter } = buildCursorOverlay("0:v", cursor.style, cursor.samples, off, "cout");
      await runFfmpeg([
        "-y", "-i", source, ...extraInputs,
        "-filter_complex", filter.replace(/;$/, ""),
        "-map", "[cout]", "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest,
      ]);
      log(`saved ${dest} cursor=${cursor.style} samples=${cursor.samples.length} segments=${files.length}`);
    } else {
      await runFfmpeg(["-y", "-i", source, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest]);
      log(`saved ${dest} segments=${files.length}`);
    }
    for (const f of files) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    if (concatTmp) { try { fs.unlinkSync(concatTmp); } catch { /* ignore */ } }
    log(`saved ${dest} bytes=${fs.statSync(dest).size} segments=${files.length}`);
    if (lastInfo) lastInfo.dest = dest;
    return dest;
  } catch (err) {
    log(`transcode failed, keeping source: ${err}`);
    return source;
  }
}

/** True pause: terminate current segment; frames during pause are never captured. */
export async function pauseGdiGrab(): Promise<void> {
  await terminateProc();
  log(`gdigrab paused segments=${segments.length}`);
}

/** True resume: start a fresh segment with identical params; stop concatenates. */
export async function resumeGdiGrab(): Promise<GdiInfo | null> {
  if (!lastStart) return null;
  // Re-resolve live window bounds so a moved window resumes tight (occlusion-safe-ish: still desktop pixels, see WGC note).
  if (lastStart.kind === "window" && lastStart.hwnd) {
    const live = getWindowRect(lastStart.hwnd);
    if (live) lastStart = { ...lastStart, rect: live };
  }
  const info = await spawnSegment(lastStart);
  segments.push(info.dest);
  log(`gdigrab resumed segment=${segments.length} -> ${info.dest}`);
  return info;
}

async function terminateProc(): Promise<void> {
  const child = proc;
  proc = null;
  current = null;
  if (!child) return;
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    child.once("close", finish);
    try { child.stdin?.write("q\n"); } catch { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, 2500);
    setTimeout(finish, 6000);
  });
}

export function dipToPhysical(rect: { x: number; y: number; width: number; height: number }): WinRect {
  return toPhysical(rect);
}

export { even, parseCapturerHwnd, getWindowRect };
