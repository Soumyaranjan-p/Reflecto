import { Tray, Menu, nativeImage, BrowserWindow, screen, app } from "electron";
import path from "node:path";
import { emitBus } from "./bus";

/**
 * Port of Sources/Views/MenuBarPopoverController.swift.
 * PLATFORM GAP: macOS popover animates from the menu bar with a spring;
 * Windows tray balloons/notifications don't exist, so we position a frameless
 * window above the tray icon and animate via CSS (scale 0.94→1, blur 4→0).
 */
let tray: Tray | null = null;
let popover: BrowserWindow | null = null;

const POPOVER_WIDTH = 296 + 16; // content 296 + 8pt horizontal padding each side
const POPOVER_BODY_HEIGHT = 460; // measured content height; refined at runtime
const ARROW_HEIGHT = 9;

export function createTray(): Tray {
  const iconPath = path.join(__dirname, "../build/tray.ico");
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
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
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
      },
    });
    const devURL = process.env.VITE_DEV_SERVER_URL;
    if (devURL) popover.loadURL(`${devURL}/src/entries/tray.html`);
    else popover.loadFile("dist/src/entries/tray.html");
    popover.on("blur", () => popover?.hide()); // dismiss on focus loss, like NSPopover
  }

  const [trayX] = getTrayBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(Math.min(Math.max(trayX - POPOVER_WIDTH / 2, workArea.x), workArea.x + workArea.width - POPOVER_WIDTH));
  const y = workArea.y; // just below taskbar; arrow points up at the icon
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

export { emitBus };
