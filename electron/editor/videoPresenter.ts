import { BrowserWindow } from "electron";
import path from "node:path";
import { preloadPath } from "../paths";

let videoWin: BrowserWindow | null = null;

export function openVideoEditor(filePath: string) {
  if (videoWin && !videoWin.isDestroyed()) {
    videoWin.focus();
    videoWin.webContents.send("video:load", { url: filePath });
    return;
  }
  videoWin = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: "Reflecto Studio",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      webSecurity: false,
    },
  });
  videoWin.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) videoWin.loadURL(`${devURL}/src/entries/video.html?src=${encodeURIComponent(filePath)}`);
  else videoWin.loadFile(path.join(__dirname, "../dist/src/entries/video.html"), {
    search: `src=${encodeURIComponent(filePath)}`,
  });
  videoWin.once("ready-to-show", () => {
    videoWin?.show();
    videoWin?.webContents.send("video:load", { url: filePath });
  });
  videoWin.on("closed", () => { videoWin = null; });
}
