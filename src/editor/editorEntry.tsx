import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";
import {
  defaultBeautifierConfig,
  GRADIENT_PRESETS,
  type BeautifierConfig,
} from "../shared/beautifierTypes";
import { renderBeautifierFromImage } from "../shared/beautifierRender";
import {
  SWATCHES,
  TOOLS,
  isRedaction,
  supportsColor,
  supportsStroke,
  type Annotation,
  type AnnotationTool,
  type EditorMode,
  type Point,
} from "./types";
import {
  annotationBounds,
  applyHandle,
  drawAnnotations,
  drawSelection,
  hitHandle,
  hitTest,
  type Handle,
} from "./draw";

function fileUrl(src: string): string {
  if (!src || src.startsWith("file:") || src.startsWith("data:") || src.startsWith("http")) return src;
  return `file:///${src.replace(/\\/g, "/")}`;
}

function EditorApp() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [src, setSrc] = useState(fileUrl(params.get("src") || ""));
  const [tool, setTool] = useState<EditorMode>("arrow");
  const [color, setColor] = useState(SWATCHES[1].color);
  const [stroke, setStroke] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  const [redactionStrength, setRedactionStrength] = useState(0.7);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [counter, setCounter] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [inspector, setInspector] = useState(true);
  const [look, setLook] = useState<BeautifierConfig>({ ...defaultBeautifierConfig });
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  const [busy, setBusy] = useState<"copy" | "save" | "export" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{
    handle: Handle;
    origin: Point;
    base: Annotation;
    snapshot: Annotation[];
  } | null>(null);
  const cropRef = useRef<{ start: Point; current: Point } | null>(null);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const off = window.reflecto?.onEditorLoad?.((payload) => {
      if (payload.url) setSrc(fileUrl(payload.url));
    });
    void window.reflecto?.getPrefs?.().then((prefs: any) => {
      if (prefs?.defaultBeautifierConfig) {
        setLook({ ...defaultBeautifierConfig, ...prefs.defaultBeautifierConfig, border: { ...defaultBeautifierConfig.border, ...prefs.defaultBeautifierConfig.border } });
      }
    });
    return () => { off?.(); };
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      setAnnotations([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(null);
      setCounter(1);
    };
    img.src = src;
  }, [src]);

  const visible = useMemo(
    () => [...annotations, ...(draft ? [draft] : [])],
    [annotations, draft],
  );

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize.w) return;
    const off = document.createElement("canvas");
    off.width = imgSize.w;
    off.height = imgSize.h;
    const octx = off.getContext("2d")!;
    drawAnnotations(octx, img, imgSize.w, imgSize.h, visible);
    const framed = tool === "crop"
      ? off
      : renderBeautifierFromImage(off, imgSize.w, imgSize.h, look);
    canvas.width = framed.width;
    canvas.height = framed.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(framed, 0, 0);
    const scale = canvas.getBoundingClientRect().width / canvas.width || 1;
    const selected = visible.find((a) => a.id === selectedId);
    if (selected && tool === "select") drawSelection(ctx, selected, scale);
    if (tool === "crop" && cropRect) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.drawImage(off, cropRect.x, cropRect.y, cropRect.w, cropRect.h, cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
      ctx.restore();
    }
  }, [visible, imgSize, look, selectedId, tool, cropRect]);

  useEffect(() => { paint(); }, [paint]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !imgSize.w) return;
    const pad = 48;
    const zx = (view.clientWidth - pad) / Math.max(imgSize.w, 1);
    const zy = (view.clientHeight - pad) / Math.max(imgSize.h, 1);
    const next = Math.min(1, zx, zy);
    setFitZoom(next);
    setZoom(next);
  }, [imgSize.w, imgSize.h]);

  const pushHistory = (next: Annotation[]) => {
    setUndoStack((s) => [...s, annotations]);
    setRedoStack([]);
    setAnnotations(next);
  };

  const undo = () => {
    setUndoStack((s) => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => [...r, annotations]);
      setAnnotations(prev);
      setSelectedId(null);
      return s.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((s) => {
      if (!s.length) return s;
      const next = s[s.length - 1];
      setUndoStack((u) => [...u, annotations]);
      setAnnotations(next);
      return s.slice(0, -1);
    });
  };

  const toCanvas = (e: React.MouseEvent | MouseEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const selectTool = (next: EditorMode) => {
    setTool((cur) => {
      if (cur === next && next !== "select") return "select";
      return next;
    });
    if (next !== "crop") setCropRect(null);
    if (next !== "select") setSelectedId(null);
  };

  const onDown = (e: React.MouseEvent) => {
    if (textDraft) return;
    const p = toCanvas(e);
    if (tool === "crop") {
      cropRef.current = { start: p, current: p };
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === "select") {
      const hit = [...annotations].reverse().find((a) => hitTest(a, p));
      if (hit) {
        setSelectedId(hit.id);
        const handle = hitHandle(p, annotationBounds(hit)) ?? "move";
        dragRef.current = { handle, origin: p, base: hit, snapshot: annotations };
      } else {
        setSelectedId(null);
      }
      return;
    }
    if (tool === "numberedCircle") {
      pushHistory([...annotations, {
        id: crypto.randomUUID(), tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        color, stroke, counter,
      }]);
      setCounter((c) => c + 1);
      return;
    }
    if (tool === "text") {
      setTextDraft({ x: p.x, y: p.y, value: "" });
      return;
    }
    setDraft({
      id: crypto.randomUUID(),
      tool: tool as AnnotationTool,
      x1: p.x, y1: p.y, x2: p.x, y2: p.y,
      color, stroke, fontSize,
      redactionStrength: isRedaction(tool as AnnotationTool) ? redactionStrength : undefined,
      points: tool === "freehand" ? [p] : undefined,
    });
  };

  const onMove = (e: React.MouseEvent) => {
    const p = toCanvas(e);
    if (cropRef.current) {
      cropRef.current.current = p;
      const s = cropRef.current.start;
      setCropRect({
        x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
      });
      return;
    }
    if (dragRef.current) {
      const { handle, origin, base } = dragRef.current;
      const next = applyHandle(handle, p.x - origin.x, p.y - origin.y, base);
      setAnnotations((list) => list.map((a) => (a.id === base.id ? next : a)));
      return;
    }
    if (!draft) return;
    setDraft({
      ...draft,
      x2: p.x,
      y2: p.y,
      points: draft.points ? [...draft.points, p] : undefined,
    });
  };

  const onUp = () => {
    if (cropRef.current) {
      cropRef.current = null;
      return;
    }
    if (dragRef.current) {
      const snapshot = dragRef.current.snapshot;
      dragRef.current = null;
      setUndoStack((s) => [...s, snapshot]);
      setRedoStack([]);
      return;
    }
    if (!draft) return;
    const w = Math.abs(draft.x2 - draft.x1);
    const h = Math.abs(draft.y2 - draft.y1);
    if ((draft.tool === "freehand" && (draft.points?.length ?? 0) < 2) || (draft.tool !== "freehand" && w < 2 && h < 2)) {
      setDraft(null);
      return;
    }
    pushHistory([...annotations, draft]);
    setDraft(null);
  };

  const applyCrop = () => {
    if (!cropRect || cropRect.w < 4 || cropRect.h < 4 || !imgRef.current) return;
    const img = imgRef.current;
    const off = document.createElement("canvas");
    off.width = Math.round(cropRect.w);
    off.height = Math.round(cropRect.h);
    const ctx = off.getContext("2d")!;
    ctx.drawImage(img, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, off.width, off.height);
    const cropped = new Image();
    cropped.onload = () => {
      imgRef.current = cropped;
      setImgSize({ w: cropped.naturalWidth, h: cropped.naturalHeight });
      const dx = cropRect.x, dy = cropRect.y;
      setAnnotations((list) => list.map((a) => ({
        ...a,
        x1: a.x1 - dx, y1: a.y1 - dy, x2: a.x2 - dx, y2: a.y2 - dy,
        points: a.points?.map((p) => ({ x: p.x - dx, y: p.y - dy })),
      })));
      setCropRect(null);
      setTool("select");
    };
    cropped.src = off.toDataURL("image/png");
  };

  const compositeDataUrl = (): string => {
    const img = imgRef.current;
    if (!img) return "";
    const off = document.createElement("canvas");
    off.width = imgSize.w;
    off.height = imgSize.h;
    const octx = off.getContext("2d")!;
    drawAnnotations(octx, img, imgSize.w, imgSize.h, annotations);
    const framed = renderBeautifierFromImage(off, imgSize.w, imgSize.h, look);
    return framed.toDataURL("image/png");
  };

  const copyOut = async () => {
    setBusy("copy");
    try { await window.reflecto?.copyDataUrl?.(compositeDataUrl()); }
    finally { setBusy(null); }
  };

  const saveOut = async () => {
    setBusy("save");
    try { await window.reflecto?.saveDataUrl?.(compositeDataUrl()); }
    finally { setBusy(null); }
  };

  const exportOut = async () => {
    setBusy("export");
    try { await window.reflecto?.exportDataUrl?.(compositeDataUrl()); }
    finally { setBusy(null); }
  };

  const shareOut = async () => {
    const dataUrl = compositeDataUrl();
    await window.reflecto?.shareDataUrl?.(dataUrl);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textDraft) {
        if (e.key === "Escape") setTextDraft(null);
        return;
      }
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (meta && e.key.toLowerCase() === "s") { e.preventDefault(); void saveOut(); return; }
      if (meta && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); void copyOut(); return; }
      if (meta && e.key.toLowerCase() === "c" && !e.shiftKey && selectedId) return;
      if (meta && e.key === "=") { e.preventDefault(); setZoom((z) => Math.min(4, z * 1.15)); return; }
      if (meta && e.key === "-") { e.preventDefault(); setZoom((z) => Math.max(0.1, z / 1.15)); return; }
      if (meta && e.key === "0") { e.preventDefault(); setZoom(1); return; }
      if (meta && e.key === "1") { e.preventDefault(); setZoom(fitZoom); return; }
      if (meta && e.key.toLowerCase() === "a") { e.preventDefault(); if (annotations[0]) setSelectedId(annotations[0].id); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          pushHistory(annotations.filter((a) => a.id !== selectedId));
          setSelectedId(null);
        }
        return;
      }
      if (e.key === "Escape") {
        if (tool === "crop") { setCropRect(null); setTool("select"); }
        else setSelectedId(null);
        return;
      }
      if (e.key === "Enter" && tool === "crop") { applyCrop(); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, EditorMode> = {
        h: "select", r: "rectangle", o: "ellipse", l: "line", a: "arrow",
        t: "text", p: "pixelate", b: "blur", c: "crop", "1": "numberedCircle",
      };
      const next = map[e.key.toLowerCase()];
      if (next && !meta) selectTool(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const commitText = () => {
    if (!textDraft) return;
    if (textDraft.value.trim()) {
      pushHistory([...annotations, {
        id: crypto.randomUUID(), tool: "text",
        x1: textDraft.x, y1: textDraft.y, x2: textDraft.x, y2: textDraft.y,
        color, stroke, text: textDraft.value, fontSize,
      }]);
    }
    setTextDraft(null);
  };

  const canvasStyle: React.CSSProperties = {
    width: imgSize.w ? imgSize.w * zoom : undefined,
    height: imgSize.h ? imgSize.h * zoom : undefined,
    maxWidth: "none",
    boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
    cursor: tool === "select" ? "default" : "crosshair",
    display: imgSize.w ? "block" : "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <div style={{
        height: "var(--toolbar-height)", display: "flex", alignItems: "center", gap: 2,
        padding: "0 12px", borderBottom: "1px solid var(--reflecto-separator)",
        background: "var(--reflecto-panel)", overflowX: "auto",
      }}>
        <select
          value={look.aspectRatio}
          onChange={(e) => setLook({ ...look, aspectRatio: e.target.value as BeautifierConfig["aspectRatio"] })}
          style={selectStyle}
          title="Aspect ratio"
        >
          {["auto", "1:1", "4:3", "3:2", "16:9", "9:16"].map((r) => (
            <option key={r} value={r}>{r === "auto" ? "Original" : r}</option>
          ))}
        </select>
        <button
          type="button"
          className={`editor-button${tool === "crop" ? " selected" : ""}`}
          onClick={() => selectTool("crop")}
          title="Crop — click again to cancel"
          aria-label="Crop"
        >
          Crop
        </button>
        <div className="divider-v" style={{ height: 24, margin: "0 6px" }} />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`editor-button${tool === t.id ? " selected" : ""}`}
            onClick={() => selectTool(t.id)}
            title={`${t.help}${t.key ? ` (${t.key})` : ""}`}
            aria-label={t.help}
            style={{ minWidth: 32, padding: "0 7px" }}
          >
            {t.label}
          </button>
        ))}
        <div className="divider-v" style={{ height: 24, margin: "0 6px" }} />
        {supportsColor(tool === "crop" ? "select" : tool) && (
          <>
            {SWATCHES.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.title}
                aria-label={s.title}
                onClick={() => setColor(s.color)}
                style={{
                  width: 16, height: 16, borderRadius: 8, border: color === s.color ? "2px solid var(--reflecto-accent)" : "1px solid rgba(128,128,128,0.4)",
                  background: s.color, padding: 0, margin: "0 2px",
                }}
              />
            ))}
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Custom color" />
          </>
        )}
        {supportsStroke(tool === "crop" ? "select" : tool) && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--reflecto-secondary)" }}>
            {stroke}px
            <input type="range" min={1} max={24} value={stroke} onChange={(e) => setStroke(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        )}
        {tool === "text" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--reflecto-secondary)" }}>
            {fontSize}pt
            <input type="range" min={10} max={96} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        )}
        {isRedaction(tool === "crop" ? "select" : tool as AnnotationTool) && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--reflecto-secondary)" }}>
            Strength
            <input type="range" min={0.2} max={1} step={0.05} value={redactionStrength} onChange={(e) => setRedactionStrength(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={undo} disabled={!undoStack.length}>Undo</button>
        <button type="button" className="editor-button" onClick={redo} disabled={!redoStack.length}>Redo</button>
        <button type="button" className="editor-button" onClick={() => setZoom((z) => Math.max(0.1, z / 1.15))} title="Zoom out">−</button>
        <span style={{ fontSize: 11, minWidth: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="editor-button" onClick={() => setZoom((z) => Math.min(4, z * 1.15))} title="Zoom in">+</button>
        <button type="button" className="editor-button" onClick={() => setZoom(fitZoom)}>Fit</button>
        <button type="button" className="editor-button" onClick={() => setZoom(1)}>100%</button>
        <button type="button" className="editor-button" onClick={() => setInspector((v) => !v)} aria-label="Toggle inspector">Inspector</button>
      </div>

      {tool === "crop" && (
        <div style={{
          height: 40, display: "flex", alignItems: "center", gap: 8, padding: "0 16px",
          borderBottom: "1px solid var(--reflecto-separator)", background: "var(--reflecto-panel)", fontSize: 12,
        }}>
          <span style={{ color: "var(--reflecto-secondary)" }}>
            Drag to crop{cropRect ? ` · ${Math.round(cropRect.w)}×${Math.round(cropRect.h)}` : ""} · Enter applies, Esc cancels
          </span>
          <div style={{ flex: 1 }} />
          <button type="button" className="editor-button" onClick={() => { setCropRect(null); setTool("select"); }}>Cancel</button>
          <button type="button" className="editor-button selected" onClick={applyCrop} disabled={!cropRect}>Apply crop</button>
        </div>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {inspector && (
          <aside style={{
            width: "var(--inspector-width)", borderRight: "1px solid var(--reflecto-separator)",
            background: "var(--reflecto-panel)", padding: 14, overflow: "auto",
          }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 13 }}>Background</h3>
            <label style={rowStyle}>
              Fill
              <select
                value={look.style.kind === "gradient" ? look.style.id : look.style.kind === "solid" ? "solid" : "none"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "none") setLook({ ...look, style: { kind: "none" } });
                  else if (v === "solid") setLook({ ...look, style: { kind: "solid", rgb: [245, 245, 247] } });
                  else setLook({ ...look, style: { kind: "gradient", id: v } });
                }}
                style={selectStyle}
              >
                <option value="none">No Background</option>
                <option value="solid">Solid</option>
                {GRADIENT_PRESETS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
            {look.style.kind === "solid" && (
              <label style={rowStyle}>
                Color
                <input
                  type="color"
                  value={`#${look.style.rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`}
                  onChange={(e) => {
                    const hex = e.target.value.replace("#", "");
                    setLook({
                      ...look,
                      style: { kind: "solid", rgb: [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)] },
                    });
                  }}
                />
              </label>
            )}
            <Slider
              label="Padding"
              value={look.padding}
              min={0} max={0.45} step={0.01}
              display={`${Math.round(look.padding * 100)}%`}
              disabled={look.style.kind === "none"}
              onChange={(v) => setLook({ ...look, padding: v })}
            />
            <Slider
              label="Corners"
              value={look.cornerRadius}
              min={0} max={0.12} step={0.001}
              display={`${Math.round(look.cornerRadius * 1000) / 10}`}
              disabled={look.style.kind === "none"}
              onChange={(v) => setLook({ ...look, cornerRadius: v })}
            />
            <Slider
              label="Shadow"
              value={look.shadowStrength}
              min={0} max={1} step={0.01}
              display={`${Math.round(look.shadowStrength * 100)}%`}
              disabled={look.style.kind === "none"}
              onChange={(v) => setLook({ ...look, shadowStrength: v })}
            />

            <h3 style={{ margin: "18px 0 10px", fontSize: 13 }}>Border</h3>
            <label style={rowStyle}>
              Enabled
              <input
                type="checkbox"
                checked={Boolean(look.border?.enabled)}
                onChange={(e) => setLook({ ...look, border: { ...look.border, enabled: e.target.checked } })}
              />
            </label>
            <label style={rowStyle}>
              Color
              <input
                type="color"
                value={look.border?.color ?? "#ffffff"}
                onChange={(e) => setLook({ ...look, border: { ...look.border, color: e.target.value } })}
              />
            </label>
            <Slider
              label="Thickness"
              value={look.border?.thickness ?? 0.012}
              min={0.002} max={0.06} step={0.001}
              display={`${Math.round((look.border?.thickness ?? 0.012) * 1000) / 10}`}
              disabled={!look.border?.enabled}
              onChange={(v) => setLook({ ...look, border: { ...look.border, thickness: v } })}
            />
            <Slider
              label="Opacity"
              value={look.border?.opacity ?? 1}
              min={0.1} max={1} step={0.05}
              display={`${Math.round((look.border?.opacity ?? 1) * 100)}%`}
              disabled={!look.border?.enabled}
              onChange={(v) => setLook({ ...look, border: { ...look.border, opacity: v } })}
            />

            <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Objects</h3>
            <div style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>{annotations.length} annotations</div>
          </aside>
        )}
        <div
          ref={viewRef}
          style={{
            flex: 1, overflow: "auto", display: "grid", placeItems: "center",
            padding: 24, background: "#111", position: "relative",
          }}
        >
          <canvas
            ref={canvasRef}
            style={canvasStyle}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          />
          {textDraft && canvasRef.current && (
            <textarea
              autoFocus
              value={textDraft.value}
              onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                if (e.key === "Escape") setTextDraft(null);
              }}
              style={{
                position: "absolute",
                left: canvasRef.current.getBoundingClientRect().left - (viewRef.current?.getBoundingClientRect().left ?? 0) + textDraft.x * zoom,
                top: canvasRef.current.getBoundingClientRect().top - (viewRef.current?.getBoundingClientRect().top ?? 0) + textDraft.y * zoom,
                font: `${fontSize * zoom}px Segoe UI`,
                color,
                background: "rgba(0,0,0,0.35)",
                border: "1px solid #007aff",
                minWidth: 120,
                minHeight: 32,
              }}
            />
          )}
        </div>
      </div>

      <footer style={{
        height: "var(--footer-height)", display: "flex", alignItems: "center", gap: 8,
        padding: "0 16px", borderTop: "1px solid var(--reflecto-separator)",
        background: "var(--reflecto-panel)",
      }}>
        <span style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>
          {imgSize.w ? `${imgSize.w}×${imgSize.h}` : "Loading…"}
        </span>
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={() => void shareOut()}>Share</button>
        <button type="button" className="editor-button" disabled={busy === "copy"} onClick={() => void copyOut()}>Copy</button>
        <button type="button" className="editor-button" disabled={busy === "export"} onClick={() => void exportOut()}>Export</button>
        <button type="button" className="editor-button selected" disabled={busy === "save"} onClick={() => void saveOut()}>Save</button>
      </footer>
    </div>
  );
}

function Slider({
  label, value, min, max, step, display, disabled, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; disabled?: boolean; onChange: (v: number) => void;
}) {
  return (
    <label style={{ ...rowStyle, opacity: disabled ? 0.45 : 1 }}>
      <span>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 120 }} />
        <span style={{ fontSize: 11, minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{display}</span>
      </span>
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  fontSize: 12, marginBottom: 10,
};

const selectStyle: React.CSSProperties = {
  font: "500 12px var(--font-system)",
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--reflecto-border)",
  background: "var(--reflecto-panel)",
  color: "var(--reflecto-label)",
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<EditorApp />);
