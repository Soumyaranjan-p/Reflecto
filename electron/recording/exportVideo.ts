import { app } from "electron";
import path from "node:path";
import { even, runFfmpeg, probeMedia } from "./ffmpeg";
import { isCompositedCursorStyle, type CursorSample } from "./cursors";
import {
  normalizeClips,
  remapSamplesToEditorTime,
  timelineDuration,
  type ExportClip,
} from "../../src/shared/clipTimeline";

export type { ExportClip };

export interface VideoMask {
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
  coverage?: "crop" | "full";
  /** Editor-timeline seconds; null = whole timeline (legacy behavior). */
  start?: number | null;
  end?: number | null;
  /** Per-mask strength 4..80 (BetterShot RecordingMaskSegment amount). */
  amount?: number;
}

export type VideoCodec = "h264" | "hevc";
export type VideoResolution = "original" | "1080" | "720" | "480";
export type VideoContainer = "mp4" | "mov";
export type VideoQuality = "high" | "medium" | "low";
export type AudioOnlyFormat = "m4a" | "wav";

export interface VideoExportRequest {
  src: string;
  dest?: string;
  /** Legacy single trim range (used when `clips` is absent). */
  trimStart: number;
  trimEnd: number;
  /** Non-destructive clip list; each keeps a source range + its own speed. */
  clips?: Array<Pick<ExportClip, "sourceStart" | "sourceEnd" | "speed"> & { id?: string }>;
  crop?: { x: number; y: number; width: number; height: number } | null;
  masks: VideoMask[];
  fps: number;
  crf: number;
  /** Legacy global speed (used when `clips` is absent). */
  speed?: number;
  codec?: VideoCodec;
  resolution?: VideoResolution;
  container?: VideoContainer;
  quality?: VideoQuality;
  muted?: boolean;
  /** Audio-only export (video track dropped). */
  audioOnly?: AudioOnlyFormat | null;
  /** Replacement soundtrack: lies flat from zero, clamped to timeline length. */
  replacementAudio?: string | null;
  cursorStyle?: string;
  cursorSamples?: CursorSample[];
  cursorOffset?: { x: number; y: number };
}

const QUALITY_CRF: Record<VideoQuality, number> = { high: 20, medium: 26, low: 32 };
const QUALITY_ABR: Record<VideoQuality, string> = { high: "192k", medium: "128k", low: "96k" };

function clampSpeed(n: number): number {
  const v = Number.isFinite(n) ? n : 1;
  return Math.min(8, Math.max(0.25, Math.round(v * 100) / 100));
}

function clampAmount(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 16;
  return Math.min(80, Math.max(4, v));
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

function defaultDest(req: VideoExportRequest): string {
  if (req.audioOnly === "wav") return path.join(app.getPath("videos"), `Reflecto_${Date.now()}.wav`);
  if (req.audioOnly === "m4a") return path.join(app.getPath("videos"), `Reflecto_${Date.now()}.m4a`);
  const ext = req.container === "mov" ? "mov" : "mp4";
  return path.join(app.getPath("videos"), `Reflecto_${Date.now()}.${ext}`);
}

export async function exportEditedVideo(req: VideoExportRequest): Promise<string> {
  const media = await probeMedia(req.src);
  const quality: VideoQuality = req.quality ?? "medium";
  const crf = req.crf ?? QUALITY_CRF[quality];
  const abr = QUALITY_ABR[quality];
  const codec = req.codec ?? "h264";
  const container = req.audioOnly ? (req.audioOnly === "wav" ? "wav" : "mp4") : (req.container ?? "mp4");
  const dest = req.dest ?? defaultDest({ ...req, container: container as VideoContainer });
  const legacySpeed = clampSpeed(req.speed ?? 1);

  const clips = normalizeClips(
    req.clips ?? [{ sourceStart: req.trimStart, sourceEnd: req.trimEnd, speed: legacySpeed }],
    media.duration || Math.max(req.trimEnd, 0),
  );
  if (!clips.length) throw new Error("invalidRange: no clip survives normalization");
  const TL = timelineDuration(clips);
  if (!(TL > 0)) throw new Error("invalidRange: empty timeline");

  const vcodec = codec === "hevc" ? "libx265" : "libx264";
  const hasSrcAudio = media.hasAudio;
  const useClipAudio = hasSrcAudio && !req.muted && !req.replacementAudio;
  const W = media.width || 0;
  const H = media.height || 0;

  // Inputs: one -ss/-to window per clip, then the optional replacement.
  const args = ["-y"];
  clips.forEach((c) => {
    args.push("-ss", String(c.sourceStart), "-to", String(c.sourceEnd), "-i", req.src);
  });
  let replIndex = -1;
  if (req.replacementAudio) {
    replIndex = clips.length;
    args.push("-ss", "0", "-t", String(TL), "-i", req.replacementAudio);
  }

  const filters: string[] = [];
  const vlabels: string[] = [];
  const alabels: string[] = [];
  clips.forEach((c, i) => {
    const speed = clampSpeed(c.speed);
    // Absolute input timestamps vary with seeking; rebase to zero first so
    // the concat joins end-to-end, then apply this clip's own speed.
    // (Audio-only exports build no video branches: every filter output must
    // stay connected, and nothing would consume the video concat.)
    if (!req.audioOnly) {
      filters.push(`[${i}:v]setpts=(PTS-STARTPTS)/${speed}[v${i}]`);
      vlabels.push(`[v${i}]`);
    }
    if (useClipAudio) {
      filters.push(`[${i}:a]asetpts=PTS-STARTPTS,${atempoChain(speed)},aresample=48000,aformat=channel_layouts=stereo[ak${i}]`);
      alabels.push(`[ak${i}]`);
    }
  });

  let vlast = "vcat";
  let alast = "acat";
  if (clips.length > 1) {
    if (!req.audioOnly) {
      filters.push(`${vlabels.join("")}concat=n=${clips.length}:v=1:a=0[${vlast}]`);
    }
    if (alabels.length === clips.length) {
      filters.push(`${alabels.join("")}concat=n=${clips.length}:v=0:a=1[${alast}]`);
    }
  } else {
    vlast = "v0";
    alast = alabels.length ? "ak0" : "";
  }

  if (!req.audioOnly) {
    if (!vlabels.length) throw new Error("invalidRange: no video to export");
    if (req.crop && req.crop.width > 2 && req.crop.height > 2) {
      filters.push(`[${vlast}]crop=${even(req.crop.width)}:${even(req.crop.height)}:${Math.round(req.crop.x)}:${Math.round(req.crop.y)}[c]`);
      vlast = "c";
    }
    vlast = applyMasks(filters, vlast, req.masks, TL, W, H);
    if (req.resolution && req.resolution !== "original") {
      const h = req.resolution === "1080" ? 1080 : req.resolution === "720" ? 720 : 480;
      filters.push(`[${vlast}]scale=-2:${h}[rs]`);
      vlast = "rs";
    }
    // Cursor compositing happens in runExport (needs the final input list
    // for the cursor PNG input index); samples are remapped onto the edited
    // timeline there (cut ranges dropped).
    filters.push(`[${vlast}]fps=${req.fps},format=yuv420p[${vlast}x]`);
    vlast = `${vlast}x`;
  }

  return runExport(req, dest, { args, filters, vlast, alast, clips, TL, vcodec, abr, crf, container, hasSrcAudio, useClipAudio, replIndex });
}

function applyMasks(
  filters: string[],
  last: string,
  masks: VideoMask[],
  timeline: number,
  srcW: number,
  srcH: number,
): string {
  masks.forEach((mask, i) => {
    // Editor-timeline ranges, clamped like RecordingMaskSegment.editorRange.
    const s = mask.start == null ? 0 : Math.min(Math.max(mask.start, 0), Math.max(timeline, 0));
    const e = mask.end == null ? timeline : Math.max(s, Math.min(mask.end, timeline));
    if (!(e > s)) return;
    const timed = mask.start != null || mask.end != null;
    const enable = timed ? `:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'` : "";
    const tag = `m${i}`;
    const amount = clampAmount(mask.amount);
    // BetterShot scaledAmount(forHeight:): max(1, amount * H / 1080).
    const strength = Math.max(1, (amount * (srcH || 1080)) / 1080);
    if (mask.coverage === "full") {
      if (mask.type === "blur") {
        const r = Math.max(2, Math.round(strength));
        filters.push(`[${last}]split[b${i}s][b${i}k]`);
        filters.push(`[b${i}s]boxblur=${r}:1[${tag}b]`);
        filters.push(`[b${i}k][${tag}b]overlay=0:0${enable}[${tag}]`);
      } else {
        const cells = Math.max(2, Math.round(strength));
        const W = srcW > 0 ? srcW : "iw";
        const Hh = srcH > 0 ? srcH : "ih";
        filters.push(`[${last}]split[p${i}s][p${i}k]`);
        filters.push(`[p${i}s]scale=iw/${cells}:ih/${cells}:flags=neighbor,scale=${W}:${Hh}:flags=neighbor[${tag}p]`);
        filters.push(`[p${i}k][${tag}p]overlay=0:0${enable}[${tag}]`);
      }
      last = tag;
      return;
    }
    const x = Math.round(mask.x), y = Math.round(mask.y);
    const w = even(mask.width), h = even(mask.height);
    if (mask.type === "blur") {
      const r = Math.max(2, Math.round(strength));
      filters.push(`[${last}]split[b${i}s][b${i}k]`);
      filters.push(`[b${i}s]crop=${w}:${h}:${x}:${y},boxblur=${r}:1[${tag}b]`);
      filters.push(`[b${i}k][${tag}b]overlay=${x}:${y}${enable}[${tag}]`);
    } else {
      const dw = Math.max(2, Math.round(w / Math.max(2, strength)));
      const dh = Math.max(2, Math.round(h / Math.max(2, strength)));
      filters.push(`[${last}]split[p${i}s][p${i}k]`);
      filters.push(`[p${i}s]crop=${w}:${h}:${x}:${y},scale=${dw}:${dh}:flags=neighbor,scale=${w}:${h}:flags=neighbor[${tag}p]`);
      filters.push(`[p${i}k][${tag}p]overlay=${x}:${y}${enable}[${tag}]`);
    }
    last = tag;
  });
  return last;
}

interface ExportPlan {
  args: string[];
  filters: string[];
  vlast: string;
  alast: string;
  clips: { sourceStart: number; sourceEnd: number; speed: number; id: string }[];
  TL: number;
  vcodec: string;
  abr: string;
  crf: number;
  container: string;
  hasSrcAudio: boolean;
  useClipAudio: boolean;
  replIndex: number;
}

async function runExport(req: VideoExportRequest, dest: string, plan: ExportPlan): Promise<string> {
  const { args, filters, clips, TL, vcodec, abr, crf } = plan;
  let { vlast, alast } = plan;

  // Cursor overlay needs its PNG as an ffmpeg input; rebuild the overlay
  // segment here where the input list is final (clip inputs + replacement).
  let cursorInputIndex = -1;
  if (
    !req.audioOnly &&
    isCompositedCursorStyle(req.cursorStyle) &&
    req.cursorSamples &&
    req.cursorSamples.length > 0
  ) {
    const remapped = remapSamplesToEditorTime(req.cursorSamples.map((s) => ({ ...s })), clips);
    if (remapped.length) {
      const { buildCursorOverlay } = await import("./cursors");
      const { extraInputs, filter } = buildCursorOverlay(vlast, req.cursorStyle, remapped, req.cursorOffset ?? { x: 0, y: 0 }, "cout");
      // extraInputs is ["-i", png]; append after existing inputs.
      const inputCount = clips.length + (plan.replIndex >= 0 ? 1 : 0);
      args.push(...extraInputs);
      cursorInputIndex = inputCount;
      // Rewrite the cursor filter's "[1:v]" to the real cursor input index.
      filters.push(filter.replaceAll("[1:v]", `[${cursorInputIndex}:v]`).replace(/;$/, ""));
      vlast = "cout";
    }
  }

  if (filters.length) {
    args.push("-filter_complex", filters.join(";"));
  }
  if (req.audioOnly === "wav") {
    if (req.replacementAudio) {
      args.push("-map", `${plan.replIndex}:a?`, "-t", String(TL));
    } else if (plan.useClipAudio && alast) {
      args.push("-map", `[${alast}]`);
    } else {
      throw new Error("noAudioTrack: this recording has no audio to export");
    }
    args.push("-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", dest);
    await runFfmpeg(args);
    return dest;
  }
  if (req.audioOnly === "m4a") {
    if (req.replacementAudio) {
      args.push("-map", `${plan.replIndex}:a?`, "-t", String(TL));
    } else if (plan.useClipAudio && alast) {
      args.push("-map", `[${alast}]`);
    } else {
      throw new Error("noAudioTrack: this recording has no audio to export");
    }
    args.push("-c:a", "aac", "-b:a", abr, "-ar", "48000", "-ac", "2", "-movflags", "+faststart", dest);
    await runFfmpeg(args);
    return dest;
  }

  // Video export.
  args.push("-map", `[${vlast}]`);
  if (req.muted || (!plan.useClipAudio && !req.replacementAudio)) {
    args.push("-an");
  } else if (req.replacementAudio) {
    args.push("-map", `${plan.replIndex}:a?`, "-t", String(TL), "-c:a", "aac", "-b:a", abr);
  } else if (alast) {
    args.push("-map", `[${alast}]`, "-c:a", "aac", "-b:a", abr);
  } else {
    args.push("-an");
  }
  args.push("-c:v", vcodec, "-preset", "medium", "-crf", String(crf));
  if (plan.container === "mp4") args.push("-movflags", "+faststart");
  args.push(dest);
  await runFfmpeg(args);
  return dest;
}
