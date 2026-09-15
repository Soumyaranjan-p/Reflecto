import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { HistoryStore, decodeThumbnail } from "../history/store";
import { showOnDeck } from "../preview/deck";
import { preloadPath } from "../paths";

/**
 * Port of Sources/Settings/MediaGallery.swift — browse captures with search/filter.
 */

let galleryWin: BrowserWindow | null = null;

export function openGalleryWindow() {
  if (galleryWin && !galleryWin.isDestroyed()) {
    galleryWin.focus();
    galleryWin.webContents.send("gallery:refresh");
    return;
  }
  galleryWin = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Media Gallery",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  galleryWin.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) galleryWin.loadURL(`${devURL}/src/entries/gallery.html`);
  else galleryWin.loadFile(path.join(__dirname, "../dist/src/entries/gallery.html"));
  galleryWin.once("ready-to-show", () => galleryWin?.show());
  galleryWin.on("closed", () => { galleryWin = null; });
}

export function registerGalleryIpc() {
  ipcMain.handle("gallery:list", (_e, filter?: { kind?: string; query?: string }) => {
    let records = HistoryStore.shared.records;
    if (filter?.kind === "screenshot" || filter?.kind === "recording") {
      records = records.filter((r) => r.kind === filter.kind);
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      records = records.filter((r) => r.filename.toLowerCase().includes(q));
    }
    return records.map((r) => {
      const filePath = HistoryStore.shared.displayURLForRecord(r);
      return {
        id: r.id,
        filename: r.filename,
        kind: r.kind,
        createdAt: r.createdAt,
        width: r.pixelWidth,
        height: r.pixelHeight,
        path: filePath,
        thumbnail: decodeThumbnail(filePath, 240),
        shareURL: r.shareURL ?? null,
        exists: fs.existsSync(filePath),
      };
    });
  });
  ipcMain.handle("gallery:open", (_e, filePath: string) => {
    if (fs.existsSync(filePath)) showOnDeck(filePath);
  });
  ipcMain.handle("gallery:delete", (_e, id: string) => {
    const record = HistoryStore.shared.records.find((r) => r.id === id);
    if (record) HistoryStore.shared.deleteRecord(record);
    return true;
  });
}
