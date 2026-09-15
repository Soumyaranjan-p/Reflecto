import { BrowserWindow, nativeImage } from "electron";
import path from "node:path";
import { preloadPath } from "../paths";
import {
  defaultBeautifierConfig,
  type BeautifierConfig,
} from "../../src/shared/beautifierTypes";

/**
 * Runs BeautifierRenderer in a hidden offscreen BrowserWindow.
 */

let worker: BrowserWindow | null = null;
let ready: Promise<void> | null = null;

function ensureWorker(): Promise<BrowserWindow> {
  if (worker && !worker.isDestroyed() && ready) {
    return ready.then(() => worker!);
  }
  worker = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      offscreen: true,
    },
  });
  ready = new Promise((resolve) => {
    worker!.webContents.once("did-finish-load", () => resolve());
    const devURL = process.env.VITE_DEV_SERVER_URL;
    if (devURL) worker!.loadURL(`${devURL}/src/entries/beautifier.html`);
    else worker!.loadFile(path.join(__dirname, "../dist/src/entries/beautifier.html"));
  });
  return ready.then(() => worker!);
}

export async function beautifyPNG(
  png: Buffer,
  config: BeautifierConfig = defaultBeautifierConfig,
): Promise<Buffer> {
  if (config.style.kind === "none") return png;
  const win = await ensureWorker();
  const dataUrl = nativeImage.createFromBuffer(png).toDataURL();
  const result = await win.webContents.executeJavaScript(
    `window.__reflectoBeautify(${JSON.stringify(dataUrl)}, ${JSON.stringify(config)})`,
    true,
  ) as string;
  const base64 = result.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(base64, "base64");
}

export { defaultBeautifierConfig };
export type { BeautifierConfig };
