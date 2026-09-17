import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function resolveFfmpeg(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string;
    if (staticPath && fs.existsSync(staticPath)) return staticPath;
  } catch { /* fall through */ }
  const bundled = path.join(process.resourcesPath || "", "ffmpeg.exe");
  if (fs.existsSync(bundled)) return bundled;
  return "ffmpeg";
}

export function runFfmpeg(args: string[], stdinClose = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpeg(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += String(d); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0 || stdinClose) resolve();
      else reject(new Error(err.split("\n").slice(-8).join("\n") || `ffmpeg exited ${code}`));
    });
  });
}

export interface AvDevice {
  name: string;
  kind: "audio" | "video";
}

export async function listDshowDevices(): Promise<AvDevice[]> {
  return new Promise((resolve) => {
    const proc = spawn(resolveFfmpeg(), ["-list_devices", "true", "-f", "dshow", "-i", "dummy"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stderr.on("data", (d) => { out += String(d); });
    proc.stdout.on("data", (d) => { out += String(d); });
    proc.on("close", () => {
      const devices: AvDevice[] = [];
      let kind: "audio" | "video" | null = null;
      for (const line of out.split("\n")) {
        if (/DirectShow video devices/i.test(line)) { kind = "video"; continue; }
        if (/DirectShow audio devices/i.test(line)) { kind = "audio"; continue; }
        const tagged = line.match(/"([^"]+)"\s*\((video|audio)\)/i);
        if (tagged) {
          devices.push({ name: tagged[1], kind: tagged[2].toLowerCase() as "audio" | "video" });
          continue;
        }
        const m = line.match(/"([^"]+)"/);
        if (m && kind && !/Alternative name/i.test(line)) devices.push({ name: m[1], kind });
      }
      resolve(devices);
    });
    proc.on("error", () => resolve([]));
  });
}

export function even(n: number): number {
  const i = Math.max(2, Math.round(n));
  return i % 2 === 0 ? i : i - 1;
}

export interface MediaProbe {
  width: number;
  height: number;
  hasAudio: boolean;
  duration: number;
}

/** Probe dimensions + audio presence + duration via `ffmpeg -i` stderr. */
export async function probeMedia(src: string): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const proc = spawn(resolveFfmpeg(), ["-i", src], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += String(d); });
    proc.on("close", () => {
      const vline = err.split(/\r?\n/).find((l) => l.includes("Stream #") && l.includes("Video:"));
      const m = vline?.match(/(\d{2,5})x(\d{2,5})/);
      const hasAudio = err.split(/\r?\n/).some((l) => l.includes("Stream #") && l.includes("Audio:"));
      const dm = err.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      resolve({
        width: m ? Number(m[1]) : 0,
        height: m ? Number(m[2]) : 0,
        hasAudio,
        duration: dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0,
      });
    });
    proc.on("error", () => resolve({ width: 0, height: 0, hasAudio: false, duration: 0 }));
  });
}

/** Probe source dimensions via `ffmpeg -i` stderr (no ffprobe in essentials build). */
export async function probeVideoSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn(resolveFfmpeg(), ["-i", src], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => { err += String(d); });
    proc.on("close", () => {
      const line = err.split(/\r?\n/).find((l) => l.includes("Stream #") && l.includes("Video:"));
      const m = line?.match(/(\d{2,5})x(\d{2,5})/);
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : null);
    });
    proc.on("error", () => resolve(null));
  });
}
