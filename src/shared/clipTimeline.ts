/**
 * Non-destructive clip timeline — port of RecordingClipTimeline.swift.
 * The source movie is never modified: each clip keeps a range on the
 * original recording, and the edited/output timeline is the concatenation
 * of the surviving ranges with per-clip speed baked in (BetterShot uses
 * AVMutableComposition.scaleTimeRange; the ffmpeg export maps each clip to
 * trimmed inputs + setpts/atempo + concat, which keeps A/V in sync the
 * same way: editorDuration = duration / speed, video and audio together).
 */

export interface ExportClip {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  /** Playback speed for this clip only, 0.25...8. */
  speed: number;
}

export const CLIP_MIN_DURATION = 0.12;
export const CLIP_MIN_SPEED = 0.25;
export const CLIP_MAX_SPEED = 8;

export function clampClipSpeed(s: number): number {
  const v = Number.isFinite(s) ? s : 1;
  return Math.min(CLIP_MAX_SPEED, Math.max(CLIP_MIN_SPEED, v));
}

export function clipSourceDuration(c: Pick<ExportClip, "sourceStart" | "sourceEnd">): number {
  return Math.max(0, c.sourceEnd - c.sourceStart);
}

/** Output-timeline length of one clip once its speed is applied. */
export function clipEditorDuration(c: Pick<ExportClip, "sourceStart" | "sourceEnd" | "speed">): number {
  return clipSourceDuration(c) / Math.max(clampClipSpeed(c.speed), CLIP_MIN_SPEED);
}

/** Total edited/output timeline length, honoring per-clip speed. */
export function timelineDuration(clips: Pick<ExportClip, "sourceStart" | "sourceEnd" | "speed">[]): number {
  return clips.reduce((t, c) => t + clipEditorDuration(c), 0);
}

/**
 * Normalize a clip list against the source duration (mirror
 * `normalized(to:)`): clamp ranges, drop sub-minimum clips, clamp speeds,
 * sort by source start, de-overlap by trimming later ranges forward.
 * Falls back to a single full-range clip, like BetterShot.
 */
export function normalizeClips(
  clips: Array<Pick<ExportClip, "sourceStart" | "sourceEnd" | "speed"> & { id?: string }>,
  sourceDuration: number,
): ExportClip[] {
  const safe = Math.max(0, Number.isFinite(sourceDuration) ? sourceDuration : 0);
  const seen = new Set<string>();
  let list: ExportClip[] = [];
  for (const c of clips) {
    const start = Math.min(Math.max(c.sourceStart ?? 0, 0), safe);
    const end = Math.min(Math.max(c.sourceEnd ?? safe, start), safe);
    if (end - start < CLIP_MIN_DURATION) continue;
    let id = typeof c.id === "string" && c.id ? c.id : `clip-${list.length}-${Math.round(start * 1000)}`;
    if (seen.has(id)) id = `${id}-b`;
    seen.add(id);
    list.push({ id, sourceStart: start, sourceEnd: end, speed: clampClipSpeed(c.speed ?? 1) });
  }
  list.sort((a, b) =>
    Math.abs(a.sourceStart - b.sourceStart) > 1e-6
      ? a.sourceStart - b.sourceStart
      : a.sourceEnd - b.sourceEnd,
  );
  const out: ExportClip[] = [];
  let prevEnd = 0;
  for (const c of list) {
    const start = Math.max(c.sourceStart, prevEnd);
    if (c.sourceEnd - start < CLIP_MIN_DURATION) continue;
    out.push({ ...c, sourceStart: start });
    prevEnd = c.sourceEnd;
  }
  if (!out.length && safe > 0) {
    out.push({ id: "clip-full", sourceStart: 0, sourceEnd: safe, speed: 1 });
  }
  return out;
}

/** Split the clip containing `sourceTime` into two clips there. */
export function splitClipAt(clips: ExportClip[], sourceTime: number, makeId: () => string): ExportClip[] {
  const out: ExportClip[] = [];
  let split = false;
  for (const c of clips) {
    if (
      !split &&
      sourceTime - c.sourceStart >= CLIP_MIN_DURATION &&
      c.sourceEnd - sourceTime >= CLIP_MIN_DURATION
    ) {
      out.push({ ...c, sourceEnd: sourceTime });
      out.push({ id: makeId(), sourceStart: sourceTime, sourceEnd: c.sourceEnd, speed: c.speed });
      split = true;
    } else {
      out.push(c);
    }
  }
  return split ? out : clips;
}

export interface ClipLocation {
  index: number;
  id: string;
  editorStart: number;
  /** Offset in editor seconds within the clip. */
  offset: number;
  sourceTime: number;
}

/**
 * Mirror `location(at:)`: map an editor-timeline time to its clip and
 * source time. A sped-up segment covers more source seconds per editor
 * second, so the source offset scales up by the clip's speed.
 */
export function locationAtEditorTime(clips: ExportClip[], editorTime: number): ClipLocation | null {
  const total = timelineDuration(clips);
  if (!clips.length || total <= 0) return null;
  const clamped = Math.min(Math.max(editorTime, 0), total);
  let editorStart = 0;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const editorEnd = editorStart + clipEditorDuration(c);
    if (clamped < editorEnd || i === clips.length - 1) {
      const offset = Math.min(Math.max(clamped - editorStart, 0), clipEditorDuration(c));
      const sourceOffset = Math.min(offset * clampClipSpeed(c.speed), clipSourceDuration(c));
      return { index: i, id: c.id, editorStart, offset, sourceTime: c.sourceStart + sourceOffset };
    }
    editorStart = editorEnd;
  }
  return null;
}

/** Mirror `editorTime(forSourceTime:)`; null when the source time was cut. */
export function editorTimeForSourceTime(clips: ExportClip[], sourceTime: number): number | null {
  let editorStart = 0;
  for (const c of clips) {
    if (sourceTime >= c.sourceStart - 1e-6 && sourceTime <= c.sourceEnd + 1e-6) {
      const off = Math.min(Math.max(sourceTime - c.sourceStart, 0), clipSourceDuration(c));
      return editorStart + off / clampClipSpeed(c.speed);
    }
    editorStart += clipEditorDuration(c);
  }
  return null;
}

/**
 * Remap record-time pointer samples onto the edited timeline (mirrors
 * BetterShot rebuilding pointer/viewport timelines on clip change):
 * samples inside removed ranges are dropped, the rest shift to editor time.
 */
export function remapSamplesToEditorTime<T extends { t: number }>(
  samples: T[],
  clips: ExportClip[],
): Array<T & { t: number }> {
  const out: Array<T & { t: number }> = [];
  for (const s of samples) {
    const e = editorTimeForSourceTime(clips, s.t / 1000);
    if (e != null) out.push({ ...s, t: Math.round(e * 1000) });
  }
  return out;
}
