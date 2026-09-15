import { BrowserWindow, screen } from "electron";
import path from "node:path";

/**
 * Port of Sources/Views/ToastWindow.swift.
 * Top-center floating toast, 2.5s default duration, fade + 10pt slide.
 */

let toastWin: BrowserWindow | null = null;
let hideTimer: NodeJS.Timeout | null = null;

export interface ToastPayload {
  title?: string;
  message: string;
  icon?: "success" | "error" | "info" | "eyedropper" | "ocr";
  durationMs?: number;
  displayId?: number;
}

export function showToast(payload: ToastPayload) {
  const display =
    screen.getAllDisplays().find((d) => d.id === payload.displayId) ??
    screen.getPrimaryDisplay();
  const { workArea } = display;
  const width = 320;
  const height = 64;

  if (!toastWin || toastWin.isDestroyed()) {
    toastWin = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        // Internal chrome only — nodeIntegration lets the data: URL talk to ipcRenderer.
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    toastWin.setAlwaysOnTop(true, "screen-saver");
    const html = toastHTML();
    toastWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  const x = Math.round(workArea.x + workArea.width / 2 - width / 2);
  const y = Math.round(workArea.y + 12);
  toastWin.setBounds({ x, y, width, height });
  toastWin.showInactive();
  toastWin.webContents.send("toast:show", payload);

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toastWin?.hide();
  }, payload.durationMs ?? 2500);
}

function toastHTML(): string {
  return `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>
  html,body{margin:0;background:transparent;font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden}
  #card{display:flex;align-items:center;gap:12px;margin:4px 8px;padding:11px 16px;border-radius:14px;
    background:rgba(40,40,40,.82);backdrop-filter:blur(24px);color:#fff;
    box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(-10px);
    transition:opacity .28s ease-out,transform .28s ease-out}
  #card.show{opacity:1;transform:translateY(0)}
  #icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,.12);font-size:16px;flex:0 0 auto}
  #title{font-size:13px;font-weight:600;line-height:1.2}
  #msg{font-size:12px;opacity:.8;line-height:1.3}
</style></head><body>
<div id="card"><div id="icon"></div><div><div id="title"></div><div id="msg"></div></div></div>
<script>
  const { ipcRenderer } = require('electron');
  const icons = { success:'✓', error:'!', info:'i', eyedropper:'◎', ocr:'T' };
  ipcRenderer.on('toast:show', (_e, p) => {
    const card = document.getElementById('card');
    document.getElementById('icon').textContent = icons[p.icon||'info'] || 'i';
    document.getElementById('title').textContent = p.title || '';
    document.getElementById('msg').textContent = p.message || '';
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
  });
</script></body></html>`;
}
