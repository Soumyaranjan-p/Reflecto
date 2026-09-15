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
        const m = line.match(/"([^"]+)"/);
        if (m && kind) devices.push({ name: m[1], kind });
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
