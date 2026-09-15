import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface Rect { x: number; y: number; width: number; height: number }
interface StartPayload {
  displayId: number;
  bounds: Rect;
  ghost: Rect | null;
  allowsWindowSelection: boolean;
  capturesOnRelease: boolean;
}

function RegionSelectionOverlay() {
  const [config, setConfig] = useState<StartPayload | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const handler = (_event: unknown, payload: StartPayload) => setConfig(payload);
    window.electron?.onRegionStart(handler);
    return () => window.electron?.offRegionStart(handler);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return window.electron?.cancelRegion();
      if (event.key === " ") {
        event.preventDefault();
        if (config?.allowsWindowSelection) return window.electron?.completeRegion({ kind: "window", displayId: config.displayId });
      }
      if (event.key === "Enter") {
        if (selection) return complete(selection);
        if (config?.ghost) return complete(config.ghost);
      }
      if (!selection && event.key.toLowerCase() === "a" && config?.ghost) complete(config.ghost);
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
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.fillStyle = "rgba(0,0,0,.30)"; ctx.fillRect(0, 0, innerWidth, innerHeight);
    const rect = dragStart && dragCurrent ? normalized(dragStart, dragCurrent) : selection;
    if (!rect && config.ghost) drawGhost(ctx, config.ghost, mouse);
    if (rect) drawSelection(ctx, rect, Boolean(selection));
    if (!rect && mouse) {
      ctx.strokeStyle = "rgba(255,255,255,.4)"; ctx.lineWidth = .5;
      ctx.beginPath(); ctx.moveTo(mouse.x, 0); ctx.lineTo(mouse.x, innerHeight); ctx.moveTo(0, mouse.y); ctx.lineTo(innerWidth, mouse.y); ctx.stroke();
    }
  }, [config, dragStart, dragCurrent, selection, mouse]);

  if (!config) return null;
  const complete = (rect: Rect) => window.electron?.completeRegion({ kind: "region", rect, displayId: config.displayId });
  return (
    <canvas ref={canvasRef}
      style={{ position: "fixed", inset: 0, cursor: selection ? "move" : "crosshair" }}
      onMouseMove={(e) => { const p = point(e); setMouse(p); if (dragStart) setDragCurrent(p); }}
      onMouseDown={(e) => { const p = point(e); if (selection) { setSelection(null); } setDragStart(p); setDragCurrent(p); }}
      onMouseUp={(e) => {
        if (!dragStart) return;
        const rect = normalized(dragStart, point(e)); setDragStart(null); setDragCurrent(null);
        if (rect.width > 3 && rect.height > 3) config.capturesOnRelease ? complete(rect) : setSelection(rect);
        else if (!selection && config.ghost) complete(config.ghost);
        else if (!selection) window.electron?.cancelRegion();
      }}
    />
  );
  function point(e: React.MouseEvent) { return { x: e.clientX, y: e.clientY }; }
}
function normalized(a: {x:number;y:number}, b: {x:number;y:number}): Rect { return { x: Math.min(a.x,b.x), y: Math.min(a.y,b.y), width: Math.abs(a.x-b.x), height: Math.abs(a.y-b.y) }; }
function drawGhost(ctx: CanvasRenderingContext2D, r: Rect, mouse: {x:number;y:number}|null) { const hover = Boolean(mouse && mouse.x>=r.x && mouse.x<=r.x+r.width && mouse.y>=r.y && mouse.y<=r.y+r.height); ctx.fillStyle = hover ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)"; ctx.fillRect(r.x,r.y,r.width,r.height); ctx.strokeStyle = hover ? "#fff" : "rgba(255,255,255,.8)"; ctx.setLineDash([6,4]); ctx.strokeRect(r.x+.5,r.y+.5,r.width-1,r.height-1); ctx.setLineDash([]); drawLabel(ctx, `${Math.round(r.width)} × ${Math.round(r.height)} · ↩ / A / click to reuse`, r); }
function drawSelection(ctx: CanvasRenderingContext2D, r: Rect, handles: boolean) { ctx.clearRect(r.x,r.y,r.width,r.height); ctx.strokeStyle="#fff"; ctx.lineWidth=1.5; ctx.strokeRect(r.x,r.y,r.width,r.height); drawLabel(ctx, `${Math.round(r.width)} × ${Math.round(r.height)}${handles ? " · drag to adjust · ↩ to confirm · esc" : ""}`,r); if(handles) for(const p of [{x:r.x,y:r.y},{x:r.x+r.width/2,y:r.y},{x:r.x+r.width,y:r.y},{x:r.x+r.width,y:r.y+r.height/2},{x:r.x+r.width,y:r.y+r.height},{x:r.x+r.width/2,y:r.y+r.height},{x:r.x,y:r.y+r.height},{x:r.x,y:r.y+r.height/2}]) { ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill(); } }
function drawLabel(ctx: CanvasRenderingContext2D, text: string, r: Rect) { ctx.font="500 11px Consolas,monospace"; const w=ctx.measureText(text).width+12; const x=r.x+r.width/2-w/2,y=Math.max(2,r.y-28);ctx.fillStyle="rgba(0,0,0,.7)";ctx.roundRect(x,y,w,20,4);ctx.fill();ctx.fillStyle="#fff";ctx.fillText(text,x+6,y+14); }

const root = document.getElementById("root"); if(root) createRoot(root).render(<RegionSelectionOverlay />);
