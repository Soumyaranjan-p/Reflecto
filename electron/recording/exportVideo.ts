import { app } from "electron";
import path from "node:path";
import { even, runFfmpeg } from "./ffmpeg";

export interface VideoMask {
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
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
}

export async function exportEditedVideo(req: VideoExportRequest): Promise<string> {
  const dest = req.dest ?? path.join(app.getPath("videos"), `Reflecto_${Date.now()}.mp4`);
  const args = ["-y", "-ss", String(req.trimStart), "-to", String(req.trimEnd), "-i", req.src];
  const filters: string[] = [];
  let last = "0:v";
  if (req.crop && req.crop.width > 2 && req.crop.height > 2) {
    filters.push(`[${last}]crop=${even(req.crop.width)}:${even(req.crop.height)}:${Math.round(req.crop.x)}:${Math.round(req.crop.y)}[c]`);
    last = "c";
  }
  req.masks.forEach((mask, i) => {
    const tag = `m${i}`;
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
  if (filters.length) {
    args.push("-filter_complex", filters.join(";"), "-map", `[${last}]`);
  } else {
    args.push("-map", "0:v");
  }
  args.push("-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", String(req.crf), "-r", String(req.fps), "-c:a", "aac", "-movflags", "+faststart", dest);
  await runFfmpeg(args);
  return dest;
}
