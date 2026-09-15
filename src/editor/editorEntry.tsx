import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

/**
 * Port of AnnotationEditorWindow — left inspector, top tool strip, canvas.
 * Tools: select, arrow, rect, ellipse, line, freehand, text, counter, highlight, blur, pixelate, crop.
 */

type Tool =
  | "select" | "arrow" | "rectangle" | "ellipse" | "line"
  | "freehand" | "text" | "counter" | "highlight" | "blur" | "pixelate" | "crop";

interface Annotation {
  id: string;
  tool: Tool;
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  stroke: number;
  text?: string;
  counter?: number;
  points?: Array<{ x: number; y: number }>;
}

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: "select", label: "Select" },
  { id: "arrow", label: "Arrow" },
  { id: "rectangle", label: "Rect" },
  { id: "ellipse", label: "Ellipse" },
  { id: "line", label: "Line" },
  { id: "freehand", label: "Draw" },
  { id: "counter", label: "Counter" },
  { id: "text", label: "Text" },
  { id: "highlight", label: "Highlight" },
  { id: "blur", label: "Blur" },
  { id: "pixelate", label: "Pixelate" },
  { id: "crop", label: "Crop" },
];

function EditorApp() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [src, setSrc] = useState(params.get("src") || "");
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState("#ff3b30");
  const [stroke, setStroke] = useState(4);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [undoStack, setUndoStack] = useState<Annotation[][]>([]);
  const [redoStack, setRedoStack] = useState<Annotation[][]>([]);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [counter, setCounter] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const off = window.reflecto?.onEditorLoad?.((payload) => {
      if (payload.url) setSrc(payload.url.startsWith("file:") ? payload.url : `file:///${payload.url.replace(/\\/g, "/")}`);
    });
    if (src && !src.startsWith("file:") && !src.startsWith("data:")) {
      setSrc(`file:///${src.replace(/\\/g, "/")}`);
    }
    return () => { off?.(); };
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = src;
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgSize.w) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = imgSize.w;
    canvas.height = imgSize.h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    for (const a of [...annotations, ...(draft ? [draft] : [])]) drawAnnotation(ctx, a);
  }, [annotations, draft, imgSize, src]);

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

  const toCanvas = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const onDown = (e: React.MouseEvent) => {
    if (tool === "select") return;
    const p = toCanvas(e);
    if (tool === "counter") {
      pushHistory([...annotations, {
        id: crypto.randomUUID(), tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        color, stroke, counter,
      }]);
      setCounter((c) => c + 1);
      return;
    }
    if (tool === "text") {
      const text = prompt("Text");
      if (!text) return;
      pushHistory([...annotations, {
        id: crypto.randomUUID(), tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        color, stroke, text,
      }]);
      return;
    }
    setDraft({
      id: crypto.randomUUID(), tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y,
      color, stroke, points: tool === "freehand" ? [p] : undefined,
    });
  };

  const onMove = (e: React.MouseEvent) => {
    if (!draft) return;
    const p = toCanvas(e);
    setDraft({
      ...draft,
      x2: p.x,
      y2: p.y,
      points: draft.points ? [...draft.points, p] : undefined,
    });
  };

  const onUp = () => {
    if (!draft) return;
    // Second click on active tool returns to select for crop-like tools after commit.
    pushHistory([...annotations, draft]);
    setDraft(null);
    if (tool === "crop") setTool("select");
  };

  const exportPNG = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const dest = await window.reflecto?.saveDataUrl?.(dataUrl);
    if (dest) {
      /* saved + copied */
    }
  };

  const copyOut = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    await window.reflecto?.copyDataUrl?.(dataUrl);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <div style={{
        height: "var(--toolbar-height)", display: "flex", alignItems: "center", gap: 4,
        padding: "0 10px", borderBottom: "1px solid var(--reflecto-separator)",
        background: "var(--reflecto-panel)", overflowX: "auto",
      }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`editor-button${tool === t.id ? " selected" : ""}`}
            onClick={() => setTool((cur) => (cur === t.id && t.id !== "select" ? "select" : t.id))}
            title={t.label}
            aria-label={t.label}
          >
            {t.label}
          </button>
        ))}
        <div className="divider-v" style={{ height: 24, margin: "0 6px" }} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Color" />
        <input
          type="range" min={1} max={24} value={stroke}
          onChange={(e) => setStroke(Number(e.target.value))}
          title="Stroke"
          style={{ width: 80 }}
        />
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={undo}>Undo</button>
        <button type="button" className="editor-button" onClick={redo}>Redo</button>
        <button type="button" className="editor-button" onClick={() => void copyOut()}>Copy</button>
        <button type="button" className="editor-button selected" onClick={() => void exportPNG()}>Save</button>
      </div>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <aside style={{
          width: "var(--inspector-width)", borderRight: "1px solid var(--reflecto-separator)",
          background: "var(--reflecto-panel)", padding: 14, overflow: "auto",
        }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 13 }}>Background</h3>
          <p style={{ fontSize: 12, color: "var(--reflecto-secondary)", marginTop: 0 }}>
            Default Look framing (padding, corners, shadow, gradients) applies on export — full beautifier controls match BetterShot General defaults.
          </p>
          <h3 style={{ margin: "16px 0 8px", fontSize: 13 }}>Stroke</h3>
          <div style={{ fontSize: 12 }}>{stroke}px · {color}</div>
          <h3 style={{ margin: "16px 0 8px", fontSize: 13 }}>Annotations</h3>
          <div style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>{annotations.length} objects</div>
        </aside>
        <div style={{
          flex: 1, overflow: "auto", display: "grid", placeItems: "center",
          padding: 24, background: "#111",
        }}>
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: "100%", maxHeight: "100%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
              cursor: tool === "select" ? "default" : "crosshair",
            }}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
          />
        </div>
      </div>
    </div>
  );
}

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation) {
  ctx.save();
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (a.tool === "highlight") {
    ctx.globalAlpha = 0.35;
    ctx.fillRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
    ctx.restore();
    return;
  }
  if (a.tool === "blur" || a.tool === "pixelate") {
    const x = Math.min(a.x1, a.x2), y = Math.min(a.y1, a.y2);
    const w = Math.abs(a.x2 - a.x1), h = Math.abs(a.y2 - a.y1);
    if (w > 2 && h > 2) {
      try {
        const sample = ctx.getImageData(x, y, w, h);
        const block = a.tool === "pixelate" ? 12 : 1;
        if (a.tool === "pixelate") {
          for (let py = 0; py < h; py += block) {
            for (let px = 0; px < w; px += block) {
              const i = ((py * w) + px) * 4;
              ctx.fillStyle = `rgba(${sample.data[i]},${sample.data[i + 1]},${sample.data[i + 2]},1)`;
              ctx.fillRect(x + px, y + py, block, block);
            }
          }
        } else {
          ctx.filter = "blur(8px)";
          ctx.drawImage(ctx.canvas, x, y, w, h, x, y, w, h);
          ctx.filter = "none";
        }
      } catch { /* tainted canvas */ }
    }
    ctx.restore();
    return;
  }
  if (a.tool === "rectangle" || a.tool === "crop") {
    ctx.strokeRect(Math.min(a.x1, a.x2), Math.min(a.y1, a.y2), Math.abs(a.x2 - a.x1), Math.abs(a.y2 - a.y1));
  } else if (a.tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      (a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2,
      Math.abs(a.x2 - a.x1) / 2, Math.abs(a.y2 - a.y1) / 2,
      0, 0, Math.PI * 2,
    );
    ctx.stroke();
  } else if (a.tool === "line") {
    ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2); ctx.stroke();
  } else if (a.tool === "arrow") {
    drawArrow(ctx, a.x1, a.y1, a.x2, a.y2, a.stroke);
  } else if (a.tool === "freehand" && a.points?.length) {
    ctx.beginPath();
    ctx.moveTo(a.points[0].x, a.points[0].y);
    for (const p of a.points) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  } else if (a.tool === "text" && a.text) {
    ctx.font = `${Math.max(14, a.stroke * 4)}px Segoe UI`;
    ctx.fillText(a.text, a.x1, a.y1);
  } else if (a.tool === "counter") {
    const r = Math.max(12, a.stroke * 3);
    ctx.beginPath(); ctx.arc(a.x1, a.y1, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${r}px Segoe UI`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(a.counter ?? 1), a.x1, a.y1);
  }
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, stroke: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 10 + stroke * 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<EditorApp />);
