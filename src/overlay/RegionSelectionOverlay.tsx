import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

/**
 * Port of Sources/Capture/RegionSelectionOverlay.swift SelectionView:
 * drag-to-select, 8 handles + move, ghost reuse, guide lines, Enter/Esc/A/Space.
 */

interface Rect { x: number; y: number; width: number; height: number }
interface Point { x: number; y: number }
interface StartPayload {
  displayId: number;
  bounds: Rect;
  ghost: Rect | null;
  allowsWindowSelection: boolean;
  capturesOnRelease: boolean;
}

type RegionHandle =
  | "topLeft" | "top" | "topRight" | "right"
  | "bottomRight" | "bottom" | "bottomLeft" | "left" | "move";

function RegionSelectionOverlay() {
  const [config, setConfig] = useState<StartPayload | null>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [adjust, setAdjust] = useState<{
    handle: RegionHandle;
    origin: Point;
    base: Rect;
  } | null>(null);
  const [mouse, setMouse] = useState<Point | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const handler = (...args: unknown[]) => setConfig(args[0] as StartPayload);
    const off = window.electron?.onRegionStart(handler);
    return () => { off?.(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!config) return;
      if (event.key === "Escape") {
        window.electron?.cancelRegion();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        if (config.allowsWindowSelection) {
          window.electron?.completeRegion({ kind: "window", displayId: config.displayId });
        }
        return;
      }
      if (event.key === "Enter") {
        if (selection) complete(selection);
        else if (config.ghost) complete(config.ghost);
        return;
      }
      if (!selection && event.key.toLowerCase() === "a" && config.ghost) {
        complete(config.ghost);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !config) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = "rgba(0,0,0,.30)";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    let rect: Rect | null = null;
    if (adjust) {
      rect = applyHandle(
        adjust.handle,
        { x: (mouse?.x ?? adjust.origin.x) - adjust.origin.x, y: (mouse?.y ?? adjust.origin.y) - adjust.origin.y },
        adjust.base,
        { x: 0, y: 0, width: innerWidth, height: innerHeight },
      );
    } else if (dragStart && dragCurrent) {
      rect = normalized(dragStart, dragCurrent);
    } else {
      rect = selection;
    }

    if (!rect && config.ghost) drawGhost(ctx, config.ghost, mouse);
    if (rect) drawSelection(ctx, rect, Boolean(selection || adjust));
    if (!rect && mouse) {
      ctx.strokeStyle = "rgba(255,255,255,.4)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(mouse.x, 0);
      ctx.lineTo(mouse.x, innerHeight);
      ctx.moveTo(0, mouse.y);
      ctx.lineTo(innerWidth, mouse.y);
      ctx.stroke();
    }
  }, [config, dragStart, dragCurrent, selection, mouse, adjust]);

  if (!config) return null;

  const complete = (rect: Rect) =>
    window.electron?.completeRegion({ kind: "region", rect, displayId: config.displayId });

  const cursorFor = (): string => {
    if (adjust) return cursorForHandle(adjust.handle);
    if (selection && mouse) {
      const h = hitHandle(mouse, selection);
      if (h) return cursorForHandle(h);
    }
    return selection ? "move" : "crosshair";
  };

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, cursor: cursorFor() }}
      onMouseMove={(e) => {
        const p = point(e);
        setMouse(p);
        if (dragStart) setDragCurrent(p);
      }}
      onMouseDown={(e) => {
        const p = point(e);
        if (selection) {
          const handle = hitHandle(p, selection);
          if (handle) {
            setAdjust({ handle, origin: p, base: selection });
            return;
          }
          // Click outside selection starts a new drag
          setSelection(null);
        }
        if (!selection && config.ghost) {
          const g = config.ghost;
          if (p.x >= g.x && p.x <= g.x + g.width && p.y >= g.y && p.y <= g.y + g.height) {
            complete(g);
            return;
          }
        }
        setDragStart(p);
        setDragCurrent(p);
      }}
      onMouseUp={(e) => {
        const p = point(e);
        if (adjust) {
          const next = applyHandle(
            adjust.handle,
            { x: p.x - adjust.origin.x, y: p.y - adjust.origin.y },
            adjust.base,
            { x: 0, y: 0, width: innerWidth, height: innerHeight },
          );
          setSelection(next);
          setAdjust(null);
          return;
        }
        if (!dragStart) return;
        const rect = normalized(dragStart, p);
        setDragStart(null);
        setDragCurrent(null);
        if (rect.width > 3 && rect.height > 3) {
          if (config.capturesOnRelease) complete(rect);
          else setSelection(rect);
        } else if (!selection && config.ghost) {
          complete(config.ghost);
        } else if (!selection) {
          window.electron?.cancelRegion();
        }
      }}
    />
  );
}

function point(e: React.MouseEvent): Point {
  return { x: e.clientX, y: e.clientY };
}

function normalized(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Port of RegionAdjustment.handle */
function hitHandle(at: Point, rect: Rect, hitRadius = 8): RegionHandle | null {
  const corners: Array<[RegionHandle, Point]> = [
    ["topLeft", { x: rect.x, y: rect.y }],
    ["topRight", { x: rect.x + rect.width, y: rect.y }],
    ["bottomRight", { x: rect.x + rect.width, y: rect.y + rect.height }],
    ["bottomLeft", { x: rect.x, y: rect.y + rect.height }],
  ];
  for (const [h, p] of corners) {
    if (Math.hypot(p.x - at.x, p.y - at.y) <= hitRadius) return h;
  }
  const edges: Array<[RegionHandle, Point, Point]> = [
    ["top", { x: rect.x + rect.width / 2, y: rect.y }, { x: 24, y: 6 }],
    ["bottom", { x: rect.x + rect.width / 2, y: rect.y + rect.height }, { x: 24, y: 6 }],
    ["left", { x: rect.x, y: rect.y + rect.height / 2 }, { x: 6, y: 24 }],
    ["right", { x: rect.x + rect.width, y: rect.y + rect.height / 2 }, { x: 6, y: 24 }],
  ];
  for (const [h, p, r] of edges) {
    if (Math.abs(p.x - at.x) <= r.x && Math.abs(p.y - at.y) <= r.y) return h;
  }
  if (
    at.x >= rect.x && at.x <= rect.x + rect.width &&
    at.y >= rect.y && at.y <= rect.y + rect.height
  ) {
    return "move";
  }
  return null;
}

/** Port of RegionAdjustment.apply */
function applyHandle(handle: RegionHandle, delta: Point, base: Rect, bounds: Rect): Rect {
  let { x, y, width, height } = base;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  switch (handle) {
    case "move":
      x = clamp(x + delta.x, bounds.x, bounds.x + bounds.width - width);
      y = clamp(y + delta.y, bounds.y, bounds.y + bounds.height - height);
      break;
    case "topLeft":
      x += delta.x; y += delta.y; width -= delta.x; height -= delta.y; break;
    case "top":
      y += delta.y; height -= delta.y; break;
    case "topRight":
      width += delta.x; y += delta.y; height -= delta.y; break;
    case "right":
      width += delta.x; break;
    case "bottomRight":
      width += delta.x; height += delta.y; break;
    case "bottom":
      height += delta.y; break;
    case "bottomLeft":
      x += delta.x; width -= delta.x; height += delta.y; break;
    case "left":
      x += delta.x; width -= delta.x; break;
  }
  if (width < 4) { if (handle.includes("Left") || handle === "left") x = base.x + base.width - 4; width = 4; }
  if (height < 4) { if (handle.includes("top") || handle === "top") y = base.y + base.height - 4; height = 4; }
  return { x, y, width, height };
}

function cursorForHandle(h: RegionHandle): string {
  switch (h) {
    case "topLeft":
    case "bottomRight":
      return "nwse-resize";
    case "topRight":
    case "bottomLeft":
      return "nesw-resize";
    case "top":
    case "bottom":
      return "ns-resize";
    case "left":
    case "right":
      return "ew-resize";
    case "move":
      return "move";
  }
}

function drawGhost(ctx: CanvasRenderingContext2D, r: Rect, mouse: Point | null) {
  const hover = Boolean(
    mouse && mouse.x >= r.x && mouse.x <= r.x + r.width &&
    mouse.y >= r.y && mouse.y <= r.y + r.height,
  );
  ctx.fillStyle = hover ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)";
  ctx.fillRect(r.x, r.y, r.width, r.height);
  ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,.8)";
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.width - 1, r.height - 1);
  ctx.setLineDash([]);
  drawLabel(ctx, `${Math.round(r.width)} × ${Math.round(r.height)} · ↩ / A / click to reuse`, r);
}

function drawSelection(ctx: CanvasRenderingContext2D, r: Rect, handles: boolean) {
  ctx.clearRect(r.x, r.y, r.width, r.height);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  drawLabel(
    ctx,
    `${Math.round(r.width)} × ${Math.round(r.height)}${handles ? " · drag to adjust · ↩ to confirm · esc" : ""}`,
    r,
  );
  if (handles) {
    for (const p of [
      { x: r.x, y: r.y },
      { x: r.x + r.width / 2, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height / 2 },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x + r.width / 2, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
      { x: r.x, y: r.y + r.height / 2 },
    ]) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, r: Rect) {
  ctx.font = "500 11px Consolas,monospace";
  const w = ctx.measureText(text).width + 12;
  const x = r.x + r.width / 2 - w / 2;
  const y = Math.max(2, r.y - 28);
  ctx.fillStyle = "rgba(0,0,0,.7)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 20, 4);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x + 6, y + 14);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<RegionSelectionOverlay />);
