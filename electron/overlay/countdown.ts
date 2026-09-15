import { BrowserWindow, screen } from "electron";

/**
 * Port of Sources/Capture/CountdownOverlay.swift.
 * Full-screen dimmed countdown digits before timed captures / recordings.
 */

let wins: BrowserWindow[] = [];

export async function showCountdown(seconds: number, displayId?: number): Promise<void> {
  if (seconds <= 0) return;
  const displays = displayId != null
    ? screen.getAllDisplays().filter((d) => d.id === displayId)
    : [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())];

  for (const display of displays) {
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
      focusable: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(countdownHTML())}`);
    win.showInactive();
    wins.push(win);
  }

  for (let i = seconds; i > 0; i -= 1) {
    for (const w of wins) {
      if (!w.isDestroyed()) w.webContents.send("countdown:tick", i);
    }
    await sleep(1000);
  }
  dismissCountdown();
}

export function dismissCountdown() {
  for (const w of wins) {
    if (!w.isDestroyed()) w.destroy();
  }
  wins = [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function countdownHTML(): string {
  return `<!doctype html>
<html><head><meta charset="UTF-8"/>
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:rgba(0,0,0,.35);
    font-family:"Segoe UI",system-ui,sans-serif;display:grid;place-items:center}
  #n{font-size:min(28vw,180px);font-weight:600;color:#fff;text-shadow:0 4px 24px rgba(0,0,0,.45);
    opacity:0;transform:scale(1.15);transition:opacity .18s ease-out,transform .18s ease-out}
  #n.show{opacity:1;transform:scale(1)}
</style></head><body>
<div id="n"></div>
<script>
const { ipcRenderer } = require('electron');
const el = document.getElementById('n');
ipcRenderer.on('countdown:tick', (_e, n) => {
  el.classList.remove('show');
  el.textContent = String(n);
  void el.offsetWidth;
  el.classList.add('show');
});
</script></body></html>`;
}
