import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";
import {
  CLIP_MAX_SPEED,
  CLIP_MIN_DURATION,
  CLIP_MIN_SPEED,
  clipEditorDuration,
  editorTimeForSourceTime,
  locationAtEditorTime,
  normalizeClips,
  splitClipAt,
  timelineDuration,
  type ExportClip,
} from "../shared/clipTimeline";

interface Mask {
  id: string;
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
  coverage: "crop" | "full";
  /** Editor-timeline seconds; null = whole timeline. */
  start: number | null;
  end: number | null;
  /** Per-mask strength 4..80 (BetterShot RecordingMaskSegment amount). */
  amount: number;
}

function fileUrl(src: string): string {
  if (!src || src.startsWith("file:") || src.startsWith("http")) return src;
  return `file:///${src.replace(/\\/g, "/")}`;
}

const QUALITY_CRF = { high: 20, medium: 26, low: 32 } as const;

function VideoStudio() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [src, setSrc] = useState(fileUrl(params.get("src") || ""));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0); // editor-timeline seconds
  const [playing, setPlaying] = useState(false);
  const [clips, setClips] = useState<ExportClip[]>([]);
  const [selectedClip, setSelectedClip] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [maskTool, setMaskTool] = useState<"blur" | "pixelate" | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [selectedMask, setSelectedMask] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fps, setFps] = useState(30);
  const [crf, setCrf] = useState(26);
  const [quality, setQuality] = useState<"high" | "medium" | "low">("medium");
  const [codec, setCodec] = useState<"h264" | "hevc">("h264");
  const [resolution, setResolution] = useState<"original" | "1080" | "720" | "480">("original");
  const [container, setContainer] = useState<"mp4" | "mov">("mp4");
  const [muted, setMuted] = useState(false);
  const [replacementAudio, setReplacementAudio] = useState<string | null>(null);
  const [maskCoverage, setMaskCoverage] = useState<"crop" | "full">("crop");
  const [busy, setBusy] = useState<string | null>(null);
  const [inspector, setInspector] = useState(true);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const TL = timelineDuration(clips);

  useEffect(() => {
    const off = window.reflecto?.onVideoLoad?.((p) => {
      if (p.url) setSrc(fileUrl(p.url));
    });
    return () => { off?.(); };
  }, []);

  // Reset the project when the source changes (standalone clips/masks don't transfer).
  useEffect(() => {
    setClips([]);
    setSelectedClip(null);
    setMasks([]);
    setSelectedMask(null);
    setCrop(null);
    setCurrent(0);
  }, [src]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const seekEditorTime = (t: number) => {
    const v = videoRef.current;
    const clamped = Math.min(Math.max(t, 0), TL);
    setCurrent(clamped);
    if (v && clips.length) {
      const loc = locationAtEditorTime(clips, clamped);
      if (loc) v.currentTime = loc.sourceTime;
    } else if (v) {
      v.currentTime = clamped;
    }
  };

  const nativePoint = (e: React.MouseEvent, el: HTMLVideoElement) => {
    const r = el.getBoundingClientRect();
    const sx = el.videoWidth / r.width;
    const sy = el.videoHeight / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const onDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!cropping && !maskTool) {
      // Click selects the topmost mask under the cursor for editing.
      const p = nativePoint(e, e.currentTarget);
      const hit = [...masks].reverse().find((m) => p.x >= m.x - 8 && p.x <= m.x + m.width + 8 && p.y >= m.y - 8 && p.y <= m.y + m.height + 8);
      setSelectedMask(hit ? hit.id : null);
      return;
    }
    const p = nativePoint(e, e.currentTarget);
    drag.current = p;
    setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const onMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!drag.current) return;
    const p = nativePoint(e, e.currentTarget);
    setDraft({
      x: Math.min(drag.current.x, p.x),
      y: Math.min(drag.current.y, p.y),
      w: Math.abs(p.x - drag.current.x),
      h: Math.abs(p.y - drag.current.y),
    });
  };
  const onUp = () => {
    if (!draft || !drag.current) { drag.current = null; return; }
    if (draft.w > 8 && draft.h > 8) {
      if (cropping) setCrop({ x: draft.x, y: draft.y, w: draft.w, h: draft.h });
      if (maskTool) {
        const m: Mask = {
          id: crypto.randomUUID(), type: maskTool,
          x: draft.x, y: draft.y, width: draft.w, height: draft.h,
          coverage: maskCoverage, start: null, end: null, amount: 16,
        };
        setMasks((list) => [...list, m]);
        setSelectedMask(m.id);
      }
    }
    setDraft(null);
    drag.current = null;
    if (cropping) setCropping(false);
    if (maskTool) setMaskTool(null);
  };

  const splitAtPlayhead = () => {
    if (!clips.length) return;
    const loc = locationAtEditorTime(clips, current);
    if (!loc) return;
    setClips((list) => splitClipAt(list, loc.sourceTime, () => crypto.randomUUID()));
  };

  const maskActive = (m: Mask) =>
    (m.start ?? 0) <= current + 1e-6 && current <= (m.end ?? TL) + 1e-6;

  const doExport = async (kind: "video" | "m4a" | "wav") => {
    if (!src) return;
    setBusy(kind);
    try {
      const norm = normalizeClips(clips, duration);
      const dest = await window.reflecto?.exportVideo?.({
        src: src.replace(/^file:\/+/, ""),
        trimStart: norm[0]?.sourceStart ?? 0,
        trimEnd: norm[norm.length - 1]?.sourceEnd ?? duration,
        clips: norm,
        crop: crop ? { x: crop.x, y: crop.y, width: crop.w, height: crop.h } : null,
        masks: masks.map((m) => ({
          type: m.type, x: m.x, y: m.y, width: m.width, height: m.height,
          coverage: m.coverage, start: m.start, end: m.end, amount: m.amount,
        })),
        fps,
        crf,
        codec,
        resolution,
        container,
        quality,
        muted,
        audioOnly: kind === "video" ? null : kind,
        replacementAudio,
      });
      if (dest) await window.reflecto?.revealPath?.(dest);
    } finally {
      setBusy(null);
    }
  };

  const pickReplacement = async () => {
    const p = await window.reflecto?.pickAudio?.();
    if (p) setReplacementAudio(p as string);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.key === "s" && !e.ctrlKey) setMaskTool(null);
      if (e.key === "c" && !e.ctrlKey) setCropping((v) => !v);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void doExport("video"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <div style={{
        height: 48, display: "flex", alignItems: "center", gap: 6, padding: "0 12px",
        borderBottom: "1px solid var(--reflecto-separator)", background: "var(--reflecto-panel)",
      }}>
        <button type="button" className="editor-button" onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
        <button type="button" className={`editor-button${cropping ? " selected" : ""}`} onClick={() => { setCropping((v) => !v); setMaskTool(null); }}>Crop</button>
        <button type="button" className={`editor-button${maskTool === "blur" ? " selected" : ""}`} onClick={() => { setMaskTool((t) => t === "blur" ? null : "blur"); setCropping(false); }}>Blur</button>
        <button type="button" className={`editor-button${maskTool === "pixelate" ? " selected" : ""}`} onClick={() => { setMaskTool((t) => t === "pixelate" ? null : "pixelate"); setCropping(false); }}>Pixelate</button>
        <button type="button" className="editor-button" onClick={splitAtPlayhead} title="Split the clip under the playhead">Split</button>
        <button type="button" className="editor-button" onClick={() => { setMasks([]); setCrop(null); setClips((list) => (duration ? [{ id: crypto.randomUUID(), sourceStart: 0, sourceEnd: duration, speed: 1 }] : list)); }}>Reset project</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={() => setInspector((v) => !v)}>Inspector</button>
        <button type="button" className="editor-button" disabled={busy !== null} onClick={() => void doExport("m4a")}>{busy === "m4a" ? "…" : "M4A"}</button>
        <button type="button" className="editor-button" disabled={busy !== null} onClick={() => void doExport("wav")}>{busy === "wav" ? "…" : "WAV"}</button>
        <button type="button" className="editor-button selected" disabled={busy !== null} onClick={() => void doExport("video")}>
          {busy === "video" ? "Exporting…" : "Export"}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {inspector && (
          <aside style={{
            width: 300, borderRight: "1px solid var(--reflecto-separator)",
            background: "var(--reflecto-panel)", padding: 14, overflow: "auto", fontSize: 12,
          }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13 }}>Clips ({clips.length}) · {TL.toFixed(2)}s</h3>
            {clips.map((c, i) => (
              <div key={c.id} style={{
                border: `1px solid ${c.id === selectedClip ? "var(--reflecto-accent)" : "var(--reflecto-border)"}`,
                borderRadius: 8, padding: 8, marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <button type="button" className="editor-button" style={{ fontSize: 11 }} onClick={() => setSelectedClip(c.id)}>
                    Clip {i + 1} · {clipEditorDuration(c).toFixed(2)}s out
                  </button>
                  <button
                    type="button" className="editor-button destructive" style={{ fontSize: 11 }}
                    disabled={clips.length <= 1}
                    onClick={() => {
                      setClips((list) => {
                        const next = list.filter((x) => x.id !== c.id);
                        return next.length ? next : list;
                      });
                      if (selectedClip === c.id) setSelectedClip(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
                {c.id === selectedClip && (
                  <>
                    <Row label={`In ${c.sourceStart.toFixed(2)}s`}>
                      <input type="range" min={0} max={duration || 1} step={0.05} value={c.sourceStart}
                        onChange={(e) => setClips((list) => list.map((x) => x.id === c.id ? { ...x, sourceStart: Math.min(Number(e.target.value), x.sourceEnd - CLIP_MIN_DURATION) } : x))}
                        style={{ width: 130 }} />
                    </Row>
                    <Row label={`Out ${c.sourceEnd.toFixed(2)}s`}>
                      <input type="range" min={0} max={duration || 1} step={0.05} value={c.sourceEnd}
                        onChange={(e) => setClips((list) => list.map((x) => x.id === c.id ? { ...x, sourceEnd: Math.max(Number(e.target.value), x.sourceStart + CLIP_MIN_DURATION) } : x))}
                        style={{ width: 130 }} />
                    </Row>
                    <Row label={`Speed ${c.speed.toFixed(2)}×`}>
                      <input type="range" min={CLIP_MIN_SPEED} max={CLIP_MAX_SPEED} step={0.05} value={c.speed}
                        onChange={(e) => setClips((list) => list.map((x) => x.id === c.id ? { ...x, speed: Number(e.target.value) } : x))}
                        style={{ width: 130 }} />
                    </Row>
                  </>
                )}
              </div>
            ))}
            <h3 style={{ margin: "16px 0 10px", fontSize: 13 }}>Export</h3>
            <Row label="Codec">
              <select value={codec} onChange={(e) => setCodec(e.target.value as "h264" | "hevc")} style={selectStyle}>
                <option value="h264">H.264</option>
                <option value="hevc">HEVC</option>
              </select>
            </Row>
            <Row label="Resolution">
              <select value={resolution} onChange={(e) => setResolution(e.target.value as typeof resolution)} style={selectStyle}>
                <option value="original">Original</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
              </select>
            </Row>
            <Row label="Container">
              <select value={container} onChange={(e) => setContainer(e.target.value as "mp4" | "mov")} style={selectStyle}>
                <option value="mp4">MP4</option>
                <option value="mov">MOV</option>
              </select>
            </Row>
            <Row label="Quality">
              <select
                value={quality}
                onChange={(e) => {
                  const q = e.target.value as "high" | "medium" | "low";
                  setQuality(q);
                  setCrf(QUALITY_CRF[q]);
                }}
                style={selectStyle}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </Row>
            <Row label={`CRF ${crf}`}>
              <input type="range" min={16} max={34} value={crf} onChange={(e) => setCrf(Number(e.target.value))} style={{ width: 130 }} />
            </Row>
            <Row label="Frame rate">
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))} style={selectStyle}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </Row>
            <Row label="Mute audio">
              <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
            </Row>
            <Row label="Replacement audio">
              <span style={{ display: "flex", gap: 6, alignItems: "center", maxWidth: "60%" }}>
                <button type="button" className="editor-button bordered" style={{ fontSize: 11 }} onClick={() => void pickReplacement()}>
                  {replacementAudio ? "Change…" : "Choose…"}
                </button>
                {replacementAudio && (
                  <button type="button" className="editor-button" style={{ fontSize: 11 }} onClick={() => setReplacementAudio(null)}>Clear</button>
                )}
              </span>
            </Row>
            {replacementAudio && (
              <div style={{ fontSize: 11, color: "var(--reflecto-secondary)", marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis" }}>
                {(replacementAudio as string).split(/[/\\]/).pop()} (flat from 0, clamped to timeline)
              </div>
            )}
            <Row label="Mask coverage">
              <select value={maskCoverage} onChange={(e) => setMaskCoverage(e.target.value as "crop" | "full")} style={selectStyle}>
                <option value="crop">Crop only</option>
                <option value="full">Full frame</option>
              </select>
            </Row>
            <h3 style={{ margin: "16px 0 10px", fontSize: 13 }}>Masks ({masks.length})</h3>
            {masks.map((m) => (
              <div key={m.id} style={{
                border: `1px solid ${m.id === selectedMask ? "var(--reflecto-accent)" : "var(--reflecto-border)"}`,
                borderRadius: 8, padding: 8, marginBottom: 8,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <button type="button" className="editor-button" style={{ fontSize: 11 }} onClick={() => setSelectedMask(m.id)}>
                    {m.type} · {m.coverage}
                  </button>
                  <button
                    type="button" className="editor-button destructive" style={{ fontSize: 11 }}
                    onClick={() => {
                      setMasks((list) => list.filter((x) => x.id !== m.id));
                      if (selectedMask === m.id) setSelectedMask(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
                {m.id === selectedMask && (
                  <>
                    <Row label={`Amount ${Math.round(m.amount)}`}>
                      <input type="range" min={4} max={80} step={1} value={m.amount}
                        onChange={(e) => setMasks((list) => list.map((x) => x.id === m.id ? { ...x, amount: Number(e.target.value) } : x))}
                        style={{ width: 130 }} />
                    </Row>
                    <Row label="Start (s, empty=all)">
                      <input
                        type="number" min={0} max={TL} step={0.1} placeholder="all"
                        value={m.start ?? ""}
                        onChange={(e) => setMasks((list) => list.map((x) => x.id === m.id ? { ...x, start: e.target.value === "" ? null : Number(e.target.value) } : x))}
                        style={{ width: 90 }}
                      />
                    </Row>
                    <Row label="End (s, empty=all)">
                      <input
                        type="number" min={0} max={TL} step={0.1} placeholder="all"
                        value={m.end ?? ""}
                        onChange={(e) => setMasks((list) => list.map((x) => x.id === m.id ? { ...x, end: e.target.value === "" ? null : Number(e.target.value) } : x))}
                        style={{ width: 90 }}
                      />
                    </Row>
                    <Row label="Effect">
                      <select
                        value={m.type}
                        onChange={(e) => setMasks((list) => list.map((x) => x.id === m.id ? { ...x, type: e.target.value as "blur" | "pixelate" } : x))}
                        style={selectStyle}
                      >
                        <option value="blur">Blur</option>
                        <option value="pixelate">Pixelate</option>
                      </select>
                    </Row>
                  </>
                )}
              </div>
            ))}
            {crop && <div style={{ marginTop: 8 }}>Crop {Math.round(crop.w)}×{Math.round(crop.h)}</div>}
          </aside>
        )}
        <div style={{ flex: 1, display: "grid", placeItems: "center", background: "#111", padding: 20, minWidth: 0 }}>
          {src ? (
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%" }}>
              <video
                ref={videoRef}
                src={src}
                style={{ maxWidth: "100%", maxHeight: "70vh", background: "#000", display: "block", cursor: cropping || maskTool ? "crosshair" : "default" }}
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration || 0;
                  setDuration(d);
                  setClips([{ id: crypto.randomUUID(), sourceStart: 0, sourceEnd: d, speed: 1 }]);
                  setSelectedClip(null);
                  setCurrent(0);
                }}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  // Map source playback position back onto the edited timeline.
                  if (clips.length && duration) {
                    const ed = editorTimeForSourceTime(clips, t);
                    if (ed != null) setCurrent(ed);
                  } else {
                    setCurrent(t);
                  }
                }}
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
              />
              {(masks.length > 0 || draft || crop) && videoRef.current && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  {masks.map((m) => {
                    const v = videoRef.current!;
                    const sx = v.clientWidth / v.videoWidth;
                    const sy = v.clientHeight / v.videoHeight;
                    const active = maskActive(m);
                    return (
                      <div
                        key={m.id}
                        onClick={() => setSelectedMask(m.id)}
                        style={{
                          position: "absolute",
                          left: m.x * sx,
                          top: m.y * sy,
                          width: m.width * sx,
                          height: m.height * sy,
                          background: m.type === "blur" ? "rgba(80,80,120,0.35)" : "rgba(0,0,0,0.28)",
                          backdropFilter: m.type === "blur" ? "blur(6px)" : "none",
                          imageRendering: m.type === "pixelate" ? "pixelated" : undefined,
                          outline: m.id === selectedMask ? "2px solid #007aff" : active ? "1px solid rgba(255,255,255,0.9)" : "1px dashed rgba(255,255,255,0.4)",
                          pointerEvents: "auto",
                          cursor: "pointer",
                        }}
                        title={`${m.type} ${m.start ?? 0}s–${m.end ?? TL.toFixed(1)}s amount ${Math.round(m.amount)}`}
                      />
                    );
                  })}
                  {draft && (
                    <div style={{
                      position: "absolute",
                      left: draft.x * (videoRef.current.clientWidth / videoRef.current.videoWidth),
                      top: draft.y * (videoRef.current.clientHeight / videoRef.current.videoHeight),
                      width: draft.w * (videoRef.current.clientWidth / videoRef.current.videoWidth),
                      height: draft.h * (videoRef.current.clientHeight / videoRef.current.videoHeight),
                      outline: "1px dashed #007aff",
                    }}
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: "#888" }}>No recording loaded</div>
          )}
        </div>
      </div>
      <div style={{
        height: 88, borderTop: "1px solid var(--reflecto-separator)",
        background: "var(--reflecto-panel)", padding: "10px 16px",
      }}>
        <input
          type="range"
          min={0}
          max={TL || duration || 1}
          step={0.01}
          value={current}
          onChange={(e) => seekEditorTime(Number(e.target.value))}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 6 }}>
          <span>{fmt(current)}</span>
          <span>{clips.length} clip{clips.length === 1 ? "" : "s"} · {fmt(TL)} edited</span>
          <span>{fmt(duration)} source</span>
        </div>
      </div>
    </div>
  );
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${cs}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span>{label}</span>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  font: "500 12px var(--font-system)",
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--reflecto-border)",
  background: "var(--reflecto-panel)",
  color: "var(--reflecto-label)",
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<VideoStudio />);
