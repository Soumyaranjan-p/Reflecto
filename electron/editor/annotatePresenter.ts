import { BrowserWindow } from "electron";
import path from "node:path";
import { preloadPath } from "../paths";

/**
 * Port of PreviewPanelPresenter.openEditor / AnnotationEditorWindow.
 * Full annotation toolset lands next; this opens the editor shell with the image loaded.
 */
let editorWin: BrowserWindow | null = null;

export function openAnnotateEditor(filePath: string) {
  if (editorWin && !editorWin.isDestroyed()) {
    editorWin.focus();
    editorWin.webContents.send("editor:load", { url: filePath });
    return;
  }
  editorWin = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "Reflecto Editor",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      webSecurity: false,
    },
  });
  editorWin.setMenuBarVisibility(false);
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) editorWin.loadURL(`${devURL}/src/entries/editor.html?src=${encodeURIComponent(filePath)}`);
  else editorWin.loadFile(path.join(__dirname, "../dist/src/entries/editor.html"), {
    search: `src=${encodeURIComponent(filePath)}`,
  });
  editorWin.once("ready-to-show", () => {
    editorWin?.show();
    editorWin?.webContents.send("editor:load", { url: filePath });
  });
  editorWin.on("closed", () => { editorWin = null; });
}
