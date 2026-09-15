import { BrowserWindow, screen, ipcMain, nativeImage } from "electron";
import path from "node:path";
import fs from "node:fs";

/**
 * Port of Sources/Preview/PinnedScreenshot.swift.
 * Floating pinned capture windows: max longest side 400, cascade +20/−20,
 * scroll-zoom 0.25–4.0, hover close button.
 */

interface PinState {
  id: string;
  win: BrowserWindow;
  filePath: string;
  scale: number;
  baseW: number;
  baseH: number;
}

const pins = new Map<string, PinState>();
let cascade = 0;

export function hasPinnedWindows(): boolean {
  return pins.size > 0;
}

export function pinCapture(filePath: string, displayId?: number) {
  if (!fs.existsSync(filePath)) return;
  const img = nativeImage.createFromPath(filePath);
  const size = img.getSize();
  const longest = Math.max(size.width, size.height);
  const scale = Math.min(1, 400 / longest);
  const baseW = Math.max(80, Math.round(size.width * scale));
  const baseH = Math.max(60, Math.round(size.height * scale));

  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ??
    screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + workArea.width / 2 - baseW / 2 + cascade * 20);
  const y = Math.round(workArea.y + workArea.height / 2 - baseH / 2 - cascade * 20);
  cascade += 1;

  const id = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const win = new BrowserWindow({
    x,
    y,
    width: baseW,
    height: baseH,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      // Internal chrome only — pinned window is a data: URL with ipcRenderer.
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");

  const dataUrl = img.toDataURL();
  const html = pinHTML(id, dataUrl);
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => pins.delete(id));

  pins.set(id, { id, win, filePath, scale: 1, baseW, baseH });
}

export function unpinAll() {
  for (const pin of [...pins.values()]) {
    if (!pin.win.isDestroyed()) pin.win.close();
  }
  pins.clear();
  cascade = 0;
}

export function registerPinIpc() {
  ipcMain.on("pin:close", (_e, id: string) => {
    const pin = pins.get(id);
    if (pin && !pin.win.isDestroyed()) pin.win.close();
  });
  ipcMain.on("pin:zoom", (_e, id: string, deltaY: number) => {
    const pin = pins.get(id);
    if (!pin || pin.win.isDestroyed()) return;
    const next = Math.min(4, Math.max(0.25, pin.scale + deltaY * -0.05));
    pin.scale = next;
    const bounds = pin.win.getBounds();
    // Top-left anchored resize (PinnedScreenshot.anchoredFrame)
    pin.win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: Math.round(pin.baseW * next),
      height: Math.round(pin.baseH * next),
    });
  });
}

function pinHTML(id: string, dataUrl: string): string {
  return `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
  #wrap{position:relative;width:100%;height:100%;border-radius:8px;overflow:hidden;
    box-shadow:0 4px 12px rgba(0,0,0,.4),0 2px 4px rgba(0,0,0,.15);-webkit-app-region:drag}
  img{width:100%;height:100%;object-fit:contain;display:block;background:#111}
  #close{position:absolute;top:4px;right:4px;width:18px;height:18px;border:none;border-radius:50%;
    background:rgba(0,0,0,.55);color:#fff;font-size:12px;line-height:18px;cursor:pointer;
    opacity:0;transition:opacity .15s ease-in-out;-webkit-app-region:no-drag}
  #wrap:hover #close{opacity:1}
</style></head><body>
<div id="wrap">
  <img src="${dataUrl}" alt="Pinned capture"/>
  <button id="close" title="Close" aria-label="Close">×</button>
</div>
<script>
  const { ipcRenderer } = require('electron');
  const id = ${JSON.stringify(id)};
  document.getElementById('close').onclick = () => ipcRenderer.send('pin:close', id);
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    ipcRenderer.send('pin:zoom', id, e.deltaY);
  }, { passive: false });
</script></body></html>`;
}
