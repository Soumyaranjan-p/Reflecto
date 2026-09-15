import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface Mask {
  id: string;
  type: "blur" | "pixelate";
  x: number;
  y: number;
  width: number;
  height: number;
}

function fileUrl(src: string): string {
  if (!src || src.startsWith("file:") || src.startsWith("http")) return src;
  return `file:///${src.replace(/\\/g, "/")}`;
}

function VideoStudio() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [src, setSrc] = useState(fileUrl(params.get("src") || ""));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [cropping, setCropping] = useState(false);
  const [maskTool, setMaskTool] = useState<"blur" | "pixelate" | null>(null);
  const [masks, setMasks] = useState<Mask[]>([]);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fps, setFps] = useState(30);
  const [crf, setCrf] = useState(20);
  const [busy, setBusy] = useState(false);
  const [inspector, setInspector] = useState(true);
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const off = window.reflecto?.onVideoLoad?.((p) => {
      if (p.url) setSrc(fileUrl(p.url));
    });
    return () => { off?.(); };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const nativePoint = (e: React.MouseEvent, el: HTMLVideoElement) => {
    const r = el.getBoundingClientRect();
    const sx = el.videoWidth / r.width;
    const sy = el.videoHeight / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const onDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!cropping && !maskTool) return;
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
      if (maskTool) setMasks((m) => [...m, { id: crypto.randomUUID(), type: maskTool, x: draft.x, y: draft.y, width: draft.w, height: draft.h }]);
    }
    setDraft(null);
    drag.current = null;
    if (cropping) setCropping(false);
    if (maskTool) setMaskTool(null);
  };

  const exportVideo = async () => {
    if (!src) return;
    setBusy(true);
    try {
      const dest = await window.reflecto?.exportVideo?.({
        src: src.replace(/^file:\/+/, ""),
        trimStart,
        trimEnd: trimEnd || duration,
        crop: crop ? { x: crop.x, y: crop.y, width: crop.w, height: crop.h } : null,
        masks,
        fps,
        crf,
      });
      if (dest) await window.reflecto?.revealPath?.(dest);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
      if (e.key === "s" && !e.ctrlKey) setMaskTool(null);
      if (e.key === "c" && !e.ctrlKey) setCropping((v) => !v);
      if (e.key === "Home") { const v = videoRef.current; if (v) v.currentTime = trimStart; }
      if (e.key === "End") { const v = videoRef.current; if (v) v.currentTime = trimEnd || duration; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void exportVideo(); }
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
        <button type="button" className="editor-button" onClick={() => { setMasks([]); setCrop(null); }}>Clear effects</button>
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={() => setInspector((v) => !v)}>Inspector</button>
        <button type="button" className="editor-button selected" disabled={busy} onClick={() => void exportVideo()}>
          {busy ? "Exporting…" : "Export"}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {inspector && (
          <aside style={{
            width: 280, borderRight: "1px solid var(--reflecto-separator)",
            background: "var(--reflecto-panel)", padding: 14, overflow: "auto", fontSize: 12,
          }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13 }}>Clip</h3>
            <Row label={`Start ${trimStart.toFixed(2)}s`}>
              <input type="range" min={0} max={duration || 1} step={0.05} value={trimStart} onChange={(e) => setTrimStart(Math.min(Number(e.target.value), (trimEnd || duration) - 0.1))} style={{ width: 140 }} />
            </Row>
            <Row label={`End ${(trimEnd || duration).toFixed(2)}s`}>
              <input type="range" min={0} max={duration || 1} step={0.05} value={trimEnd || duration} onChange={(e) => setTrimEnd(Math.max(Number(e.target.value), trimStart + 0.1))} style={{ width: 140 }} />
            </Row>
            <h3 style={{ margin: "16px 0 10px", fontSize: 13 }}>Export</h3>
            <Row label="Frame rate">
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))} style={selectStyle}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </Row>
            <Row label={`Quality (CRF ${crf})`}>
              <input type="range" min={16} max={28} value={crf} onChange={(e) => setCrf(Number(e.target.value))} style={{ width: 140 }} />
            </Row>
            <h3 style={{ margin: "16px 0 10px", fontSize: 13 }}>Masks</h3>
            <div style={{ color: "var(--reflecto-secondary)" }}>{masks.length} blur/pixelate regions</div>
            {crop && <div style={{ marginTop: 8 }}>Crop {Math.round(crop.w)}×{Math.round(crop.h)}</div>}
          </aside>
        )}
        <div style={{ flex: 1, display: "grid", placeItems: "center", background: "#111", padding: 20, minWidth: 0 }}>
          {src ? (
            <video
              ref={videoRef}
              src={src}
              style={{ maxWidth: "100%", maxHeight: "100%", background: "#000", cursor: cropping || maskTool ? "crosshair" : "default" }}
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration || 0;
                setDuration(d);
                setTrimEnd(d);
              }}
              onTimeUpdate={(e) => {
                const t = e.currentTarget.currentTime;
                setCurrent(t);
                if (trimEnd && t >= trimEnd) {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = trimStart;
                  setPlaying(false);
                }
              }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
            />
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
          max={duration || 1}
          step={0.01}
          value={current}
          onChange={(e) => {
            const t = Number(e.target.value);
            setCurrent(t);
            if (videoRef.current) videoRef.current.currentTime = t;
          }}
          style={{ width: "100%" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, marginTop: 6 }}>
          <span>{fmt(current)}</span>
          <span>{fmt(trimStart)} – {fmt(trimEnd || duration)} kept</span>
          <span>{fmt(duration)}</span>
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
