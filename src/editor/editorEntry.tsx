import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";
import {
  cameraHasEffect,
  defaultBeautifierConfig,
  normalizeBeautifierConfig,
  GRADIENT_PRESETS,
  SOLID_PRESETS,
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
import { TOOL_ICONS, CropIcon, SmartRedactIcon } from "./toolIcons";
import { DEFAULT_FONT_ID, fontSources, fontStackFor } from "./fonts";

function fileUrl(src: string): string {
  if (!src || src.startsWith("file:") || src.startsWith("data:") || src.startsWith("http")) return src;
  return `file:///${src.replace(/\\/g, "/")}`;
}

/** Sidecar lookup needs a plain fs path; data:/http: URLs have no sidecar. */
function fsPathFor(url: string): string | null {
  if (url.startsWith("file://")) {
    try {
      return decodeURI(url.replace(/^file:\/\/\//, ""));
    } catch {
      return null;
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(url)) return url;
  return null;
}

function EditorApp() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [src, setSrc] = useState(fileUrl(params.get("src") || ""));
  const [tool, setTool] = useState<EditorMode>("arrow");
  const [color, setColor] = useState(SWATCHES[1].color);
  const [stroke, setStroke] = useState(4);
  const [fontSize, setFontSize] = useState(28);
  // New-text defaults (AnnotationEditorModel textFontSize/textIsBold/...).
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlign] = useState<"left" | "center" | "right">("left");
  const [textFontFamily, setTextFontFamily] = useState<string>(DEFAULT_FONT_ID);
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
  const [look, setLook] = useState<BeautifierConfig>(() => normalizeBeautifierConfig(defaultBeautifierConfig));
  const [textDraft, setTextDraft] = useState<{ annotationId: string | null; x: number; y: number; value: string } | null>(null);
  // Undo base for an in-progress re-edit (live keystrokes bypass history).
  const editSnapshotRef = useRef<Annotation[] | null>(null);
  const [busy, setBusy] = useState<"copy" | "save" | "export" | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartMsg, setSmartMsg] = useState<string | null>(null);
  const [hasSidecar, setHasSidecar] = useState(false);
  // Last applied crop in pre-crop coords. Shapes are already shifted at save
  // time, so this is provenance/validation metadata — never re-applied on load
  // (BetterShot parity: crop rides along as the base image, not the document).
  const lastCropRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{
    handle: Handle;
    origin: Point;
    base: Annotation;
    snapshot: Annotation[];
    grabAngle?: number;
  } | null>(null);
  const cropRef = useRef<{ start: Point; current: Point } | null>(null);
  const shiftRef = useRef(false);
  const rotateBaseRef = useRef<Annotation[] | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Shift") shiftRef.current = true; };
    const up = (e: KeyboardEvent) => { if (e.key === "Shift") shiftRef.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const off = window.reflecto?.onEditorLoad?.((payload) => {
      if (payload.url) setSrc(fileUrl(payload.url));
    });
    void window.reflecto?.getPrefs?.().then((prefs: any) => {
      if (prefs?.defaultBeautifierConfig) {
        setLook(normalizeBeautifierConfig(prefs.defaultBeautifierConfig));
      }
    });
    return () => { off?.(); };
  }, []);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    // Auto-detect the edit document (BetterShot AnnotationEditorModel.load):
    // sidecar present -> render from the untouched base + restore shapes and
    // background; otherwise open the flat image with prefs defaults.
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      setAnnotations(doc?.shapes ?? []);
      if (doc) {
        setLook(normalizeBeautifierConfig(doc.background));
        const counters = doc.shapes.map((a) => a.counter ?? 0);
        setCounter(Math.max(0, ...counters) + 1);
        setHasSidecar(true);
        lastCropRef.current = doc.crop;
      } else {
        setCounter(1);
        setHasSidecar(false);
        lastCropRef.current = null;
      }
      setUndoStack([]);
      setRedoStack([]);
      setSelectedId(null);
    };
    let doc: {
      shapes: Annotation[];
      background: BeautifierConfig;
      canvas: { w: number; h: number };
      crop: { x: number; y: number; w: number; h: number } | null;
    } | null = null;
    void (async () => {
      const fp = fsPathFor(src);
      if (fp) {
        try {
          const loaded = (await window.reflecto?.editorLoadSidecar?.(fp)) as {
            doc?: typeof doc;
            basePath?: string | null;
          } | null;
          if (cancelled) return;
          if (loaded?.doc) {
            doc = loaded.doc;
            img.src = loaded.basePath ? fileUrl(loaded.basePath) : src;
            return;
          }
        } catch {
          // Corrupt sidecar -> flat open (BetterShot try? decode semantics).
        }
      }
      if (!cancelled) img.src = src;
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  const visible = useMemo(
    // The shape under an open caret is hidden while editing (it renders live
    // in the overlay instead), mirroring AnnoTextEditorOverlay.
    () => [...annotations.filter((a) => a.id !== textDraft?.annotationId), ...(draft ? [draft] : [])],
    [annotations, draft, textDraft],
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
    const p = toCanvas(e);
    // A press anywhere commits whatever is being typed, unless it lands on
    // that same shape (AnnoEditor.pointerDown).
    if (textDraft) {
      const landed = [...annotations].reverse().find((a) => hitTest(a, p));
      if (!textDraft.annotationId || landed?.id !== textDraft.annotationId) {
        commitText();
      } else {
        return;
      }
    }
    if (tool === "crop") {
      cropRef.current = { start: p, current: p };
      setCropRect({ x: p.x, y: p.y, w: 0, h: 0 });
      return;
    }
    if (tool === "select") {
      const hit = [...annotations].reverse().find((a) => hitTest(a, p));
      if (hit) {
        setSelectedId(hit.id);
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        const s = rect && canvas && canvas.width ? rect.width / canvas.width || 1 : 1;
        const hb = annotationBounds(hit);
        const handle = hitHandle(p, hb, s) ?? "move";
        const grabAngle = handle === "rotate"
          ? Math.atan2(p.y - (hb.y + hb.h / 2), p.x - (hb.x + hb.w / 2))
          : undefined;
        dragRef.current = { handle, origin: p, base: hit, snapshot: annotations, grabAngle };
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
      // Clicking existing text edits it; clicking empty canvas starts new text.
      // preventDefault: without it the browser moves focus to the document
      // body on mouse-up, instantly blurring the autofocused textarea and
      // committing (clearing) the just-created empty draft.
      e.preventDefault();
      const hit = [...annotations].reverse().find((a) => a.tool === "text" && hitTest(a, p));
      if (hit) {
        editSnapshotRef.current = annotations;
        setSelectedId(hit.id);
        setTextDraft({ annotationId: hit.id, x: hit.x1, y: hit.y1, value: hit.text ?? "" });
      } else {
        setTextDraft({ annotationId: null, x: p.x, y: p.y, value: "" });
      }
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
      const { handle, origin, base, grabAngle } = dragRef.current;
      if (handle === "rotate") {
        const b = annotationBounds(base);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const ang = Math.atan2(p.y - cy, p.x - cx);
        let rot = (base.rotation ?? 0) + (ang - (grabAngle ?? ang));
        // Shift snaps to 15°.
        if (shiftRef.current) {
          rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
        }
        rot = Math.atan2(Math.sin(rot), Math.cos(rot));
        const next = { ...base, rotation: rot };
        setAnnotations((list) => list.map((a) => (a.id === base.id ? next : a)));
        return;
      }
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
      lastCropRef.current = { x: dx, y: dy, w: cropRect.w, h: cropRect.h };
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
    try {
      const img = imgRef.current;
      if (img && imgSize.w) {
        // Pristine source (no annotations) becomes the `<stem>.base.png`
        // companion; the composite is the display deliverable.
        const base = document.createElement("canvas");
        base.width = imgSize.w;
        base.height = imgSize.h;
        base.getContext("2d")!.drawImage(img, 0, 0);
        await window.reflecto?.saveDocument?.({
          dataUrl: compositeDataUrl(),
          baseDataUrl: base.toDataURL("image/png"),
          doc: { shapes: annotations, background: look, canvas: imgSize, crop: lastCropRef.current },
        });
      } else {
        await window.reflecto?.saveDataUrl?.(compositeDataUrl());
      }
    } finally {
      setBusy(null);
    }
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

  const smartRedact = async () => {
    const img = imgRef.current;
    if (!img || !imgSize.w || smartBusy) return;
    setSmartBusy(true);
    setSmartMsg("Scanning for sensitive text…");
    try {
      // OCR the pristine source (annotations would confuse the recognizer).
      const off = document.createElement("canvas");
      off.width = imgSize.w;
      off.height = imgSize.h;
      off.getContext("2d")!.drawImage(img, 0, 0);
      const res = await window.reflecto?.smartRedact?.({
        dataUrl: off.toDataURL("image/png"),
        width: imgSize.w,
        height: imgSize.h,
      }) as { boxes: Array<{ kind: string; x: number; y: number; w: number; h: number }>; wordCount: number } | undefined;
      const boxes = res?.boxes ?? [];
      if (!boxes.length) {
        setSmartMsg(`No sensitive text found (${res?.wordCount ?? 0} words scanned)`);
        return;
      }
      pushHistory([
        ...annotations,
        ...boxes.map((b) => ({
          id: crypto.randomUUID(),
          tool: "blur" as const,
          x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h,
          color: "#000000", stroke: 4,
          redactionStrength: 0.85,
        })),
      ]);
      setSmartMsg(`Smart Redact: ${boxes.length} region${boxes.length === 1 ? "" : "s"} (${res?.wordCount ?? 0} words scanned)`);
    } catch (err) {
      setSmartMsg(`Smart Redact failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSmartBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textDraft) {
        // Esc commits the typed text (cancelOperation -> stopEditingText);
        // an empty shape is discarded, never kept blank.
        if (e.key === "Escape") commitText();
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
    const draft = textDraft;
    if (!draft) return;
    setTextDraft(null);
    if (draft.annotationId) {
      // Re-edit: keystrokes already updated the shape live; commit as ONE
      // undo step from the pre-edit snapshot (empty text deletes the shape,
      // mirroring stopEditingText).
      const base = editSnapshotRef.current ?? annotations;
      editSnapshotRef.current = null;
      const text = draft.value;
      if (!text.trim()) {
        setUndoStack((s) => [...s, base]);
        setRedoStack([]);
        setAnnotations(base.filter((a) => a.id !== draft.annotationId));
        if (selectedId === draft.annotationId) setSelectedId(null);
        return;
      }
      setUndoStack((s) => [...s, base]);
      setRedoStack([]);
      setAnnotations((list) => list.map((a) => (a.id === draft.annotationId ? { ...a, text } : a)));
      return;
    }
    if (draft.value.trim()) {
      pushHistory([...annotations, {
        id: crypto.randomUUID(), tool: "text",
        x1: draft.x, y1: draft.y, x2: draft.x, y2: draft.y,
        color, stroke, text: draft.value, fontSize, fontFamily: textFontFamily,
        bold: textBold, italic: textItalic, underline: textUnderline, align: textAlign,
      }]);
    }
  };
  // Text style controls edit the selected text shape when one is selected,
  // else the defaults for new text (AnnotationEditorModel setters).
  const selectedText = annotations.find((a) => a.id === selectedId && a.tool === "text") ?? null;
  const effBold = selectedText ? !!selectedText.bold : textBold;
  const effItalic = selectedText ? !!selectedText.italic : textItalic;
  const effUnderline = selectedText ? !!selectedText.underline : textUnderline;
  const effAlign = selectedText?.align ?? textAlign;
  const effFontSize = selectedText?.fontSize ?? fontSize;
  const effFontFamily = selectedText?.fontFamily ?? textFontFamily;
  const setTextStyle = (patch: { bold?: boolean; italic?: boolean; underline?: boolean; align?: "left" | "center" | "right"; fontSize?: number; fontFamily?: string }) => {
    if (selectedText) {
      pushHistory(annotations.map((a) => (a.id === selectedText.id ? { ...a, ...patch } : a)));
      return;
    }
    if (patch.bold !== undefined) setTextBold(patch.bold);
    if (patch.italic !== undefined) setTextItalic(patch.italic);
    if (patch.underline !== undefined) setTextUnderline(patch.underline);
    if (patch.align !== undefined) setTextAlign(patch.align);
    if (patch.fontSize !== undefined) setFontSize(patch.fontSize);
    if (patch.fontFamily !== undefined) setTextFontFamily(patch.fontFamily);
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
          style={{ minWidth: 32, padding: "0 6px" }}
        >
          <CropIcon />
        </button>
        <div className="divider-v" style={{ height: 24, margin: "0 6px" }} />
        {TOOLS.map((t) => {
          const ToolIcon = TOOL_ICONS[t.id];
          return (
            <button
              key={t.id}
              type="button"
              className={`editor-button${tool === t.id ? " selected" : ""}`}
              onClick={() => selectTool(t.id)}
              title={`${t.help}${t.key ? ` (${t.key})` : ""}`}
              aria-label={t.help}
              aria-pressed={tool === t.id}
              style={{ minWidth: 32, padding: "0 6px" }}
            >
              {ToolIcon ? <ToolIcon /> : t.label}
            </button>
          );
        })}
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
        {(tool === "text" || selectedText) && (
          <>
            <select
              value={effFontFamily}
              onChange={(e) => setTextStyle({ fontFamily: e.target.value })}
              style={{ ...selectStyle, maxWidth: 130 }}
              title="Font family"
              aria-label="Font family"
            >
              {fontSources().map((f) => (
                <option key={f.id} value={f.id}>{f.title}</option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--reflecto-secondary)" }}>
              {effFontSize}pt
              <input type="range" min={10} max={96} value={effFontSize} onChange={(e) => setTextStyle({ fontSize: Number(e.target.value) })} style={{ width: 90 }} />
            </label>
            <button
              type="button"
              className={`editor-button${effBold ? " selected" : ""}`}
              onClick={() => setTextStyle({ bold: !effBold })}
              title="Bold"
              aria-label="Bold"
              aria-pressed={effBold}
              style={{ minWidth: 32, padding: "0 6px", fontWeight: 700 }}
            >
              B
            </button>
            <button
              type="button"
              className={`editor-button${effItalic ? " selected" : ""}`}
              onClick={() => setTextStyle({ italic: !effItalic })}
              title="Italic"
              aria-label="Italic"
              aria-pressed={effItalic}
              style={{ minWidth: 32, padding: "0 6px", fontStyle: "italic" }}
            >
              I
            </button>
            <button
              type="button"
              className={`editor-button${effUnderline ? " selected" : ""}`}
              onClick={() => setTextStyle({ underline: !effUnderline })}
              title="Underline"
              aria-label="Underline"
              aria-pressed={effUnderline}
              style={{ minWidth: 32, padding: "0 6px", textDecoration: "underline" }}
            >
              U
            </button>
            <select
              value={effAlign}
              onChange={(e) => setTextStyle({ align: e.target.value as "left" | "center" | "right" })}
              style={selectStyle}
              title="Text alignment"
              aria-label="Text alignment"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </>
        )}
        {isRedaction(tool === "crop" ? "select" : tool as AnnotationTool) && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--reflecto-secondary)" }}>
            Strength
            <input type="range" min={0.2} max={1} step={0.05} value={redactionStrength} onChange={(e) => setRedactionStrength(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        )}
        <div className="divider-v" style={{ height: 24, margin: "0 6px" }} />
        <button
          type="button"
          className="editor-button"
          onClick={() => void smartRedact()}
          disabled={smartBusy || !imgSize.w}
          title={smartBusy ? "Scanning for sensitive text…" : "Smart Redact — auto-detect emails, cards, tokens and blur them"}
          aria-label="Smart Redact"
          style={{ minWidth: 32, padding: "0 6px", opacity: smartBusy ? 0.6 : 1 }}
        >
          <SmartRedactIcon />
        </button>
        {smartMsg && (
          <span style={{ fontSize: 11, color: "var(--reflecto-secondary)", whiteSpace: "nowrap" }}>{smartMsg}</span>
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
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginBottom: 10 }}>
                  {SOLID_PRESETS.map((p) => {
                    const active = look.style.kind === "solid" &&
                      look.style.rgb[0] === p.rgb[0] && look.style.rgb[1] === p.rgb[1] && look.style.rgb[2] === p.rgb[2];
                    return (
                      <button
                        key={p.id}
                        type="button"
                        title={p.name}
                        aria-label={`Solid ${p.name}`}
                        aria-pressed={active}
                        onClick={() => setLook({ ...look, style: { kind: "solid", rgb: [...p.rgb] as [number, number, number] } })}
                        style={{
                          aspectRatio: "1",
                          borderRadius: 6,
                          border: active ? "2px solid var(--reflecto-accent)" : "1px solid rgba(128,128,128,0.4)",
                          background: `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`,
                          padding: 0,
                          cursor: "default",
                        }}
                      />
                    );
                  })}
                </div>
                <label style={rowStyle}>
                  Custom
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
              </>
            )}
            {look.style.kind === "gradient" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 10 }}>
                {GRADIENT_PRESETS.map((g) => {
                  const active = look.style.kind === "gradient" && look.style.id === g.id;
                  const stops = g.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(", ");
                  return (
                    <button
                      key={g.id}
                      type="button"
                      title={g.name}
                      aria-label={`Gradient ${g.name}`}
                      aria-pressed={active}
                      onClick={() => setLook({ ...look, style: { kind: "gradient", id: g.id } })}
                      style={{
                        aspectRatio: "16 / 10",
                        borderRadius: 6,
                        border: active ? "2px solid var(--reflecto-accent)" : "1px solid rgba(128,128,128,0.4)",
                        background: `linear-gradient(to bottom, ${stops})`,
                        padding: 0,
                        cursor: "default",
                      }}
                    />
                  );
                })}
              </div>
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

            <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Camera</h3>
            <div style={{ fontSize: 11, color: "var(--reflecto-secondary)", marginBottom: 8 }}>
              True perspective projection of the screenshot over its background.
            </div>
            {([
              ["Tilt X", "tiltXDegrees", -45, 45, 1, "°"],
              ["Tilt Y", "tiltYDegrees", -45, 45, 1, "°"],
              ["Rotate X", "rotationXDegrees", -45, 45, 1, "°"],
              ["Rotate Y", "rotationYDegrees", -45, 45, 1, "°"],
              ["Roll", "rollDegrees", -180, 180, 1, "°"],
              ["FOV", "fieldOfViewDegrees", 18, 80, 1, "°"],
              ["Zoom", "zoom", 0.4, 2.5, 0.01, "×"],
              ["Pan X", "panX", -0.5, 0.5, 0.01, ""],
              ["Pan Y", "panY", -0.5, 0.5, 0.01, ""],
            ] as const).map(([label, key, min, max, step, unit]) => (
              <Slider
                key={key}
                label={label}
                value={look.camera?.[key] ?? 0}
                min={min} max={max} step={step}
                display={`${look.camera?.[key] ?? 0}${unit}`}
                onChange={(v) => setLook({ ...look, camera: { ...look.camera, [key]: v } })}
              />
            ))}
            <button
              type="button" className="editor-button" style={{ marginTop: 6 }}
              onClick={() => setLook({ ...look, camera: { ...look.camera, panX: 0, panY: 0, tiltXDegrees: 0, tiltYDegrees: 0, rotationXDegrees: 0, rotationYDegrees: 0, rollDegrees: 0, fieldOfViewDegrees: 24, zoom: 1 } })}
              disabled={!cameraHasEffect(look.camera)}
            >
              Reset camera
            </button>

            <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Scene Blur</h3>
            <label style={rowStyle}>
              Enabled
              <input
                type="checkbox"
                checked={Boolean(look.progressiveBlur?.isEnabled)}
                onChange={(e) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, isEnabled: e.target.checked } })}
              />
            </label>
            <label style={rowStyle}>
              Mode
              <select
                value={look.progressiveBlur?.mode ?? "radial"}
                onChange={(e) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, mode: e.target.value as "radial" | "directional" } })}
                style={selectStyle}
              >
                <option value="radial">Radial</option>
                <option value="directional">Directional</option>
              </select>
            </label>
            <label style={rowStyle}>
              Applies to
              <select
                value={look.progressiveBlur?.edgeMode ?? "bleed"}
                onChange={(e) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, edgeMode: e.target.value as "clipped" | "bleed" } })}
                style={selectStyle}
              >
                <option value="bleed">Scene</option>
                <option value="clipped">Screenshot</option>
              </select>
            </label>
            <Slider label="Strength" value={look.progressiveBlur?.strength ?? 18} min={0} max={60} step={1} display={`${Math.round(look.progressiveBlur?.strength ?? 18)}`} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, strength: v } })} />
            <Slider label="Falloff" value={look.progressiveBlur?.falloff ?? 0.55} min={0} max={1} step={0.01} display={`${Math.round((look.progressiveBlur?.falloff ?? 0.55) * 100)}%`} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, falloff: v } })} />
            <Slider label="Focus size" value={look.progressiveBlur?.focusSize ?? 0.45} min={0} max={1} step={0.01} display={`${Math.round((look.progressiveBlur?.focusSize ?? 0.45) * 100)}%`} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, focusSize: v } })} />
            <Slider label="Focus X" value={look.progressiveBlur?.focusPosition?.x ?? 0.5} min={0} max={1} step={0.01} display={`${Math.round((look.progressiveBlur?.focusPosition?.x ?? 0.5) * 100)}%`} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, focusPosition: { ...look.progressiveBlur.focusPosition, x: v } } })} />
            <Slider label="Focus Y" value={look.progressiveBlur?.focusPosition?.y ?? 0.5} min={0} max={1} step={0.01} display={`${Math.round((look.progressiveBlur?.focusPosition?.y ?? 0.5) * 100)}%`} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, focusPosition: { ...look.progressiveBlur.focusPosition, y: v } } })} />
            <Slider label="Direction" value={look.progressiveBlur?.directionDegrees ?? 0} min={-180} max={180} step={1} display={`${Math.round(look.progressiveBlur?.directionDegrees ?? 0)}°`} disabled={look.progressiveBlur?.mode !== "directional"} onChange={(v) => setLook({ ...look, progressiveBlur: { ...look.progressiveBlur, directionDegrees: v } })} />

            <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Watermark</h3>
            <label style={rowStyle}>
              Text
              <input
                type="text"
                value={look.watermark?.text ?? ""}
                onChange={(e) => setLook({ ...look, watermark: { ...look.watermark, text: e.target.value } })}
                placeholder="© name"
                style={{ ...selectStyle, width: 140 }}
              />
            </label>
            <Slider label="Opacity" value={look.watermark?.opacity ?? 0.18} min={0} max={0.75} step={0.01} display={`${Math.round((look.watermark?.opacity ?? 0.18) * 100)}%`} onChange={(v) => setLook({ ...look, watermark: { ...look.watermark, opacity: v } })} />
            <Slider label="Size" value={look.watermark?.fontSize ?? 72} min={8} max={200} step={1} display={`${Math.round(look.watermark?.fontSize ?? 72)}`} onChange={(v) => setLook({ ...look, watermark: { ...look.watermark, fontSize: v } })} />
            <Slider label="Angle" value={look.watermark?.rotationDegrees ?? 45} min={-90} max={90} step={1} display={`${Math.round(look.watermark?.rotationDegrees ?? 45)}°`} onChange={(v) => setLook({ ...look, watermark: { ...look.watermark, rotationDegrees: v } })} />
            <Slider label="Density" value={look.watermark?.density ?? 4} min={2} max={8} step={1} display={`${Math.round(look.watermark?.density ?? 4)}`} onChange={(v) => setLook({ ...look, watermark: { ...look.watermark, density: v } })} />
            <label style={rowStyle}>
              Color
              <input
                type="color"
                value={look.watermark?.color ?? "#e6e6e6"}
                onChange={(e) => setLook({ ...look, watermark: { ...look.watermark, color: e.target.value } })}
              />
            </label>

            <h3 style={{ margin: "18px 0 8px", fontSize: 13 }}>Objects</h3>
            <div style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>{annotations.length} annotations</div>
            {(() => {
              const selected = annotations.find((a) => a.id === selectedId);
              if (!selected) return null;
              const deg = Math.round(((selected.rotation ?? 0) * 180) / Math.PI);
              const setRotation = (nextDeg: number, commit: boolean) => {
                const rot = (nextDeg * Math.PI) / 180;
                if (commit) {
                  const base = rotateBaseRef.current ?? annotations;
                  rotateBaseRef.current = null;
                  setUndoStack((s) => [...s, base]);
                  setRedoStack([]);
                  setAnnotations((list) => list.map((a) => (a.id === selected.id ? { ...a, rotation: rot } : a)));
                } else {
                  if (!rotateBaseRef.current) rotateBaseRef.current = annotations;
                  setAnnotations((list) => list.map((a) => (a.id === selected.id ? { ...a, rotation: rot } : a)));
                }
              };
              return (
                <div style={{ marginTop: 10 }}>
                  <label style={{ ...rowStyle, marginBottom: 4 }}>
                    <span>Rotation</span>
                    <span style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{deg}°</span>
                  </label>
                  <input
                    type="range" min={-180} max={180} step={1} value={deg}
                    onChange={(e) => setRotation(Number(e.target.value), false)}
                    onMouseUp={() => setRotation(deg, true)}
                    onTouchEnd={() => setRotation(deg, true)}
                    onBlur={() => { if (rotateBaseRef.current) setRotation(deg, true); }}
                    style={{ width: "100%" }}
                    title="Rotate selected shape (drag the circle handle too)"
                  />
                  <button
                    type="button" className="editor-button" style={{ marginTop: 6 }}
                    onClick={() => {
                      rotateBaseRef.current = null;
                      pushHistory(annotations.map((a) => (a.id === selected.id ? { ...a, rotation: 0 } : a)));
                    }}
                    disabled={!selected.rotation}
                  >
                    Reset rotation
                  </button>
                </div>
              );
            })()}
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
          {textDraft && canvasRef.current && (() => {
            // Native textarea = native caret, drag-select, word select, arrows,
            // IME (AnnoTextEditorOverlay rationale). Live-updates the shape
            // without history; commit collapses to one undo step.
            const editingAnn = textDraft.annotationId
              ? annotations.find((a) => a.id === textDraft.annotationId) ?? null
              : null;
            const tColor = editingAnn?.color ?? color;
            const tSize = (editingAnn?.fontSize ?? fontSize) * zoom;
            const tStack = fontStackFor(editingAnn?.fontFamily ?? textFontFamily);
            const tBold = editingAnn ? !!editingAnn.bold : textBold;
            const tItalic = editingAnn ? !!editingAnn.italic : textItalic;
            const tAlign = editingAnn?.align ?? "left";
            const rot = editingAnn?.rotation ?? 0;
            return (
              <textarea
                autoFocus
                value={textDraft.value}
                onChange={(e) => {
                  const value = e.target.value;
                  setTextDraft({ ...textDraft, value });
                  if (textDraft.annotationId) {
                    const id = textDraft.annotationId;
                    setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, text: value } : a)));
                  }
                }}
                onBlur={commitText}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
                  // Stop here so the window-level key handler (stale draft
                  // closure) can't commit a second copy of the same text.
                  if (e.key === "Escape") { e.stopPropagation(); commitText(); }
                }}
                style={{
                  position: "absolute",
                  left: canvasRef.current.getBoundingClientRect().left - (viewRef.current?.getBoundingClientRect().left ?? 0) + textDraft.x * zoom,
                  top: canvasRef.current.getBoundingClientRect().top - (viewRef.current?.getBoundingClientRect().top ?? 0) + textDraft.y * zoom,
                  font: `${tItalic ? "italic " : ""}${tBold ? "700 " : ""}${tSize}px ${tStack}`,
                  textAlign: tAlign,
                  color: tColor,
                  caretColor: tColor,
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid #007aff",
                  minWidth: 120,
                  minHeight: 32,
                  transform: rot ? `rotate(${rot}rad)` : undefined,
                  transformOrigin: "top left",
                }}
              />
            );
          })()}
        </div>
      </div>

      <footer style={{
        height: "var(--footer-height)", display: "flex", alignItems: "center", gap: 8,
        padding: "0 16px", borderTop: "1px solid var(--reflecto-separator)",
        background: "var(--reflecto-panel)",
      }}>
        <span style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>
          {imgSize.w ? `${imgSize.w}×${imgSize.h}${hasSidecar ? " · editable" : ""}` : "Loading…"}
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
