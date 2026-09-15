import { Tray, Menu, nativeImage, BrowserWindow, screen, app, ipcMain } from "electron";
import path from "node:path";
import { preloadPath } from "./paths";

/**
 * Port of Sources/Views/MenuBarPopoverController.swift.
 * PLATFORM GAP: macOS popover animates from the menu bar with a spring;
 * Windows tray balloons/notifications don't exist, so we position a frameless
 * window above the tray icon and animate via CSS (scale 0.94→1, blur 4→0).
 */
let tray: Tray | null = null;
let popover: BrowserWindow | null = null;

const POPOVER_WIDTH = 296 + 16; // content 296 + 8pt horizontal padding each side
const POPOVER_BODY_HEIGHT = 480;
const ARROW_HEIGHT = 9;

export function createTray(): Tray {
  const iconPath = path.join(__dirname, "../build/tray.png");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAhklEQVQoz2NgGDTgPxTjBf+hgImJCawGqAakGqBqmBqAahhqAKphqAGghqEGgBqGGgBqGGoAqGGoAaCGoQaAGoYaAGoYagCoYagBoIahBoAahhoAahhqAKhhqAGghqEGgBqGGgBqGGoAqGGoAaCGoQaAGoYaAGoYagCoYagBoIahBgYpAAC7WxGZb0zqUQAAAABJRU5ErkJggg==") : icon);
  tray.setToolTip("Reflecto");

  // Native context menu shown on right-click. Left click opens the popover,
  // matching MenuBarPopoverController's behavior.
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Reflecto", click: () => togglePopover() },
    { type: "separator" },
    { label: "Quit Reflecto", click: () => app.quit() },
  ]));

  tray.on("click", () => togglePopover());
  return tray;
}

export function togglePopover() {
  if (popover?.isVisible()) {
    popover.hide();
    return;
  }
  showPopover();
}

function showPopover() {
  if (!popover) {
    popover = new BrowserWindow({
      width: POPOVER_WIDTH,
      height: POPOVER_BODY_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true, // PLATFORM GAP: LSUIElement equivalent on Windows
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
      },
    });
    const devURL = process.env.VITE_DEV_SERVER_URL;
    if (devURL) popover.loadURL(`${devURL}/src/entries/tray.html`);
    else popover.loadFile("dist/src/entries/tray.html");
    popover.on("blur", () => popover?.hide()); // dismiss on focus loss, like NSPopover
  }

  const [trayX, trayY] = getTrayBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(Math.min(Math.max(trayX - POPOVER_WIDTH / 2, workArea.x), workArea.x + workArea.width - POPOVER_WIDTH));
  // Windows taskbar is usually bottom; place the panel just above the tray icon.
  const y = Math.round(
    trayY > workArea.y + workArea.height / 2
      ? Math.min(trayY - POPOVER_BODY_HEIGHT, workArea.y + workArea.height - POPOVER_BODY_HEIGHT)
      : Math.max(trayY + 8, workArea.y),
  );
  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
}

function getTrayBounds(): [number, number] {
  // PLATFORM GAP: Electron's tray.getBounds() can be flaky on Windows with
  // hidden icons; fall back to the horizontal center of the work area.
  try {
    const b = tray!.getBounds();
    return [b.x + b.width / 2, b.y];
  } catch {
    const { workArea } = screen.getPrimaryDisplay();
    return [workArea.x + workArea.width / 2, workArea.y];
  }
}

export function getPopover(): BrowserWindow | null {
  return popover;
}

export function dismissPopover() {
  popover?.hide();
}

// Used by capture actions to let popover dismissal settle before capturing
// (200ms in MenuBarContentView.dismissAndRun).
export function dismissAndRun(action: () => void) {
  dismissPopover();
  setTimeout(action, 200);
}

let captureHandler: ((kind: string) => void) | null = null;

/** Main registers one handler for tray-initiated capture kinds. */
export function setCaptureHandler(fn: (kind: string) => void) {
  captureHandler = fn;
}

export function registerTrayIpc() {
  ipcMain.on("tray:dismiss", () => dismissPopover());
  ipcMain.on("tray:dismissAndRun", (_e, kind: string) => {
    dismissAndRun(() => captureHandler?.(kind));
  });
}

export { ARROW_HEIGHT };
