import { BrowserWindow, screen, ipcMain, clipboard } from "electron";
import { captureDisplay } from "./windows";
import { showToast } from "../toast/toast";

/**
 * Port of Sources/Capture/ColorPickerOverlay.swift.
 * Full-screen loupe with live hex readout; click copies, Esc cancels.
 */

let pickerWins: BrowserWindow[] = [];
let resolver: ((hex: string | null) => void) | null = null;

export function startColorPicker(): Promise<string | null> {
  return new Promise(async (resolve) => {
    if (resolver) finish(null);
    resolver = resolve;
    pickerWins = [];
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      const source = await captureDisplay(display.id);
      const dataUrl = source.thumbnail.toDataURL();
      const win = new BrowserWindow({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
        },
      });
      win.setAlwaysOnTop(true, "screen-saver");
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(loupeHTML(dataUrl))}`);
      win.show();
      pickerWins.push(win);
    }
  });
}

function finish(hex: string | null) {
  for (const w of pickerWins) {
    if (!w.isDestroyed()) w.destroy();
  }
  pickerWins = [];
  const resolve = resolver;
  resolver = null;
  resolve?.(hex);
}

export function registerColorPickerIpc() {
  ipcMain.on("colorpicker:pick", (_e, hex: string) => {
    if (hex) {
      clipboard.writeText(hex);
      showToast({ title: "Copied", message: `${hex} copied to clipboard`, icon: "eyedropper" });
    }
    finish(hex || null);
  });
  ipcMain.on("colorpicker:cancel", () => finish(null));
}

function loupeHTML(dataUrl: string): string {
  return `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;cursor:none;background:#000}
  canvas#c{position:fixed;inset:0;width:100%;height:100%}
  #loupe{position:fixed;width:120px;height:120px;border-radius:50%;border:2px solid #fff;
    box-shadow:0 0 0 1px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.45);pointer-events:none;
    image-rendering:pixelated;background:#000}
  #label{position:fixed;transform:translate(-50%,8px);padding:4px 8px;border-radius:6px;
    background:rgba(0,0,0,.75);color:#fff;font:600 11px Consolas,monospace;pointer-events:none;
    white-space:nowrap}
  #cross{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;pointer-events:none}
  #cross:before,#cross:after{content:"";position:absolute;background:#fff;box-shadow:0 0 0 1px #000}
  #cross:before{left:5px;top:0;width:2px;height:12px}
  #cross:after{top:5px;left:0;width:12px;height:2px}
</style></head><body>
<canvas id="c"></canvas>
<canvas id="loupe" width="120" height="120"></canvas>
<div id="label">#000000</div>
<div id="cross"></div>
<script>
const { ipcRenderer } = require('electron');
const img = new Image();
img.src = ${JSON.stringify(dataUrl)};
const c = document.getElementById('c');
const loupe = document.getElementById('loupe');
const label = document.getElementById('label');
const cross = document.getElementById('cross');
const ctx = c.getContext('2d');
const lctx = loupe.getContext('2d');
img.onload = () => {
  c.width = img.width; c.height = img.height;
  c.style.width = '100%'; c.style.height = '100%';
  ctx.drawImage(img, 0, 0);
};
function sample(clientX, clientY){
  const sx = Math.min(img.width-1, Math.max(0, Math.round(clientX / innerWidth * img.width)));
  const sy = Math.min(img.height-1, Math.max(0, Math.round(clientY / innerHeight * img.height)));
  const t = document.createElement('canvas'); t.width=1; t.height=1;
  const tctx = t.getContext('2d');
  tctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
  const p = tctx.getImageData(0,0,1,1).data;
  const hex = '#'+[p[0],p[1],p[2]].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
  return { hex, sx, sy };
}
window.addEventListener('mousemove', (e) => {
  if (!img.width) return;
  const { hex, sx, sy } = sample(e.clientX, e.clientY);
  label.textContent = hex;
  label.style.left = e.clientX + 'px';
  label.style.top = (e.clientY + 70) + 'px';
  cross.style.left = e.clientX + 'px';
  cross.style.top = e.clientY + 'px';
  loupe.style.left = (e.clientX + 18) + 'px';
  loupe.style.top = (e.clientY - 130) + 'px';
  lctx.imageSmoothingEnabled = false;
  lctx.clearRect(0,0,120,120);
  lctx.drawImage(img, sx - 7, sy - 7, 15, 15, 0, 0, 120, 120);
  lctx.strokeStyle = 'rgba(255,255,255,.9)';
  lctx.strokeRect(56,56,8,8);
});
window.addEventListener('mousedown', (e) => {
  if (!img.width) return;
  ipcRenderer.send('colorpicker:pick', sample(e.clientX, e.clientY).hex);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') ipcRenderer.send('colorpicker:cancel');
});
</script></body></html>`;
}
