import { app } from "electron";
import path from "node:path";
import { even, runFfmpeg } from "./ffmpeg";

export interface VideoMask {
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
  coverage?: "crop" | "full";
}

export interface VideoExportRequest {
  src: string;
  dest?: string;
  trimStart: number;
  trimEnd: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
  masks: VideoMask[];
  fps: number;
  crf: number;
  speed?: number;
}

function clampSpeed(n: number): number {
  const v = Math.round(n * 100) / 100;
  return Math.min(8, Math.max(0.25, v));
}

function atempoChain(speed: number): string {
  const parts: string[] = [];
  let s = speed;
  while (s > 2.0001) {
    parts.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.5 - 1e-6) {
    parts.push("atempo=0.5");
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(",");
}

export async function exportEditedVideo(req: VideoExportRequest): Promise<string> {
  const dest = req.dest ?? path.join(app.getPath("videos"), `Reflecto_${Date.now()}.mp4`);
  const speed = clampSpeed(req.speed ?? 1);
  const args = ["-y", "-ss", String(req.trimStart), "-to", String(req.trimEnd), "-i", req.src];
  const filters: string[] = [];
  let last = "0:v";
  if (req.crop && req.crop.width > 2 && req.crop.height > 2) {
    filters.push(`[${last}]crop=${even(req.crop.width)}:${even(req.crop.height)}:${Math.round(req.crop.x)}:${Math.round(req.crop.y)}[c]`);
    last = "c";
  }
  req.masks.forEach((mask, i) => {
    const tag = `m${i}`;
    if (mask.coverage === "full") {
      if (mask.type === "blur") {
        filters.push(`[${last}]boxblur=8:1[${tag}]`);
      } else {
        filters.push(`[${last}]scale=iw/16:ih/16,scale=iw*16:ih*16:flags=neighbor[${tag}]`);
      }
      last = tag;
      return;
    }
    const x = Math.round(mask.x), y = Math.round(mask.y);
    const w = even(mask.width), h = even(mask.height);
    if (mask.type === "blur") {
      filters.push(`[${last}]split[b${i}s][b${i}k]`);
      filters.push(`[b${i}s]crop=${w}:${h}:${x}:${y},boxblur=8:1[${tag}b]`);
      filters.push(`[b${i}k][${tag}b]overlay=${x}:${y}[${tag}]`);
    } else {
      filters.push(`[${last}]split[p${i}s][p${i}k]`);
      filters.push(`[p${i}s]crop=${w}:${h}:${x}:${y},scale=iw/16:ih/16,scale=${w}:${h}:flags=neighbor[${tag}p]`);
      filters.push(`[p${i}k][${tag}p]overlay=${x}:${y}[${tag}]`);
    }
    last = tag;
  });
  if (Math.abs(speed - 1) > 0.001) {
    filters.push(`[${last}]setpts=PTS/${speed}[sp]`);
    last = "sp";
  }
  if (filters.length) {
    args.push("-filter_complex", filters.join(";"), "-map", `[${last}]`);
  } else {
    args.push("-map", "0:v");
  }
  if (Math.abs(speed - 1) > 0.001) {
    args.push("-filter:a", atempoChain(speed), "-map", "0:a?");
  } else {
    args.push("-map", "0:a?");
  }
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", String(req.crf), "-r", String(req.fps), "-c:a", "aac", "-movflags", "+faststart", dest);
  await runFfmpeg(args);
  return dest;
}
