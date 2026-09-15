import { BrowserWindow, ipcMain, screen, clipboard } from "electron";
import path from "node:path";
import fs from "node:fs";
import { getPref } from "../preferences";
import { DeckStaging } from "./deckStaging";
import { copyImageToClipboard, saveCapture } from "./fileActions";
import {
  MAX_DECK_ITEMS,
  cardMetrics,
  panelSizeForCount,
  parseToolLayout,
  type OverlayCardSize,
  type OverlayTool,
} from "./overlayLayout";
import { decodeThumbnail } from "../history/store";
import { showToast } from "../toast/toast";
import { pinCapture } from "./pin";
import { openAnnotateEditor as openEditorWindow } from "../editor/annotatePresenter";
import { preloadPath } from "../paths";
import { isR2Configured, uploadShare } from "../sharing/r2";

/**
 * Port of Sources/Preview/PreviewOverlay.swift.
 * Frameless always-on-top deck panel; max 5 cards; newest at bottom.
 */

export interface DeckItemState {
  url: string;
  thumbnail: string | null;
  kind: "screenshot" | "recording";
  saving: boolean;
}

export interface DeckState {
  items: DeckItemState[];
  cardSize: OverlayCardSize;
  edgeMargin: number;
  position: "bottomRight" | "bottomLeft";
  alwaysShowActions: boolean;
  toolLayout: ReturnType<typeof parseToolLayout>;
  hasStagedItems: boolean;
  controlScale: number;
  thumbW: number;
  thumbH: number;
}

let panel: BrowserWindow | null = null;
let items: string[] = [];
const savingItems = new Set<string>();
const dismissTimers = new Map<string, NodeJS.Timeout>();
let targetDisplayId: number | undefined;
let lastCaptureUrl: string | null = null;

export function getLastCaptureUrl(): string | null {
  return lastCaptureUrl;
}

export function showOnDeck(filePath: string, displayId?: number, automaticallyDismiss = true) {
  refreshFromPrefs();
  cancelScheduledDismiss(filePath);
  items = items.filter((u) => u !== filePath);
  items.push(filePath);
  lastCaptureUrl = filePath;

  while (items.length > MAX_DECK_ITEMS) {
    const evicted = items[0];
    removeFromDeck(evicted);
  }

  targetDisplayId = displayId;
  ensurePanel();
  positionPanel();
  pushState();
  panel?.showInactive();

  if (automaticallyDismiss) scheduleDismiss(filePath);
}

export function removeFromDeck(filePath: string) {
  cancelScheduledDismiss(filePath);
  DeckStaging.discard(filePath);
  items = items.filter((u) => u !== filePath);
  savingItems.delete(filePath);
  if (items.length === 0) {
    dismissDeck();
  } else {
    positionPanel();
    pushState();
  }
}

export function dismissDeck() {
  for (const t of dismissTimers.values()) clearTimeout(t);
  dismissTimers.clear();
  for (const url of [...items]) DeckStaging.discard(url);
  items = [];
  savingItems.clear();
  if (panel && !panel.isDestroyed()) {
    panel.hide();
  }
  pushState();
}

export function clearAll() {
  dismissDeck();
}

export function hideDeck() {
  panel?.hide();
}

export function toggleDeckVisibility() {
  if (items.length === 0) return;
  if (panel?.isVisible()) hideDeck();
  else {
    ensurePanel();
    positionPanel();
    panel?.showInactive();
  }
}

function isVideo(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".mov" || ext === ".mp4" || ext === ".webm";
}

function hasStagedItems(): boolean {
  return items.some((u) => DeckStaging.isStaged(u) || isVideo(u));
}

function saveOne(filePath: string): boolean {
  try {
    if (DeckStaging.isStaged(filePath)) {
      const promoted = DeckStaging.promote(filePath);
      if (DeckStaging.isStaged(promoted)) throw new Error("promote failed");
    } else {
      saveCapture(filePath);
    }
    return true;
  } catch {
    cancelScheduledDismiss(filePath);
    showToast({
      title: "Couldn't save capture",
      message: "The capture is still in the deck. Check the save folder in General settings and try Save again.",
      icon: "error",
      displayId: targetDisplayId,
    });
    return false;
  }
}

export function saveItem(filePath: string) {
  if (savingItems.has(filePath)) return;
  if (isVideo(filePath)) {
    // Video save lands with recording deliverable (Phase 7). Treat as copy-to-folder for now.
    savingItems.add(filePath);
    pushState();
    try {
      saveCapture(filePath);
      removeFromDeck(filePath);
      showToast({ message: "Recording saved!", icon: "success", displayId: targetDisplayId });
    } catch (err) {
      showToast({
        title: "Couldn't save recording",
        message: err instanceof Error ? err.message : String(err),
        icon: "error",
        displayId: targetDisplayId,
      });
    } finally {
      savingItems.delete(filePath);
      pushState();
    }
    return;
  }
  if (!saveOne(filePath)) return;
  showToast({
    message: "Screenshot saved!",
    icon: "success",
    displayId: targetDisplayId,
  });
  removeFromDeck(filePath);
}

export function saveAll() {
  let saved = 0;
  const snapshot = [...items];
  for (const url of snapshot) {
    if (isVideo(url)) {
      saveItem(url);
    } else if (saveOne(url)) {
      saved += 1;
      removeFromDeck(url);
    }
  }
  if (saved > 0) {
    showToast({
      message: saved === 1 ? "Screenshot saved!" : `${saved} screenshots saved!`,
      icon: "success",
      displayId: targetDisplayId,
    });
  }
}

export function copyItem(filePath: string) {
  try {
    copyImageToClipboard(filePath);
    removeFromDeck(filePath);
  } catch (err) {
    cancelScheduledDismiss(filePath);
    showToast({
      title: "Copy Failed",
      message: err instanceof Error ? err.message : String(err),
      icon: "error",
      displayId: targetDisplayId,
    });
  }
}

export function editItem(filePath: string) {
  const retained = DeckStaging.retain(filePath);
  if (DeckStaging.isStaged(retained)) {
    showToast({
      title: "Couldn't save capture",
      message: "The capture is still in the deck. Check available disk space and retry.",
      icon: "error",
      displayId: targetDisplayId,
    });
    return;
  }
  removeFromDeck(filePath);
  // Image editor window — opened in a follow-up feature; for now open via shell preview path toast.
  void openAnnotateEditor(retained);
}

async function openAnnotateEditor(filePath: string) {
  const { emitBus } = await import("../bus");
  emitBus("editor:open", { url: filePath });
  openEditorWindow(filePath);
}

export function pinItem(filePath: string) {
  const retained = DeckStaging.retain(filePath);
  if (DeckStaging.isStaged(retained)) {
    showToast({
      title: "Couldn't save capture",
      message: "The capture is still in the deck.",
      icon: "error",
      displayId: targetDisplayId,
    });
    return;
  }
  pinCapture(retained, targetDisplayId);
  removeFromDeck(filePath);
}

export function performTool(filePath: string, tool: OverlayTool) {
  switch (tool) {
    case "pin": pinItem(filePath); break;
    case "dismiss": removeFromDeck(filePath); break;
    case "edit": editItem(filePath); break;
    case "share": void shareItem(filePath); break;
    case "save": saveItem(filePath); break;
    case "copy": copyItem(filePath); break;
  }
}

export async function shareItem(filePath: string) {
  cancelScheduledDismiss(filePath);
  if (!isR2Configured()) {
    showToast({
      title: "Set up cloud sharing",
      message: "Add your cloud account in Settings → Sharing, then try again.",
      icon: "info",
      displayId: targetDisplayId,
    });
    return;
  }
  const retained = DeckStaging.retain(filePath);
  if (DeckStaging.isStaged(retained)) {
    showToast({
      title: "Couldn't prepare capture",
      message: "The screenshot is still in the deck. Check available disk space and retry.",
      icon: "error",
      displayId: targetDisplayId,
    });
    return;
  }
  showToast({
    title: "Uploading…",
    message: "Sharing to your cloud bucket",
    icon: "info",
    displayId: targetDisplayId,
    durationMs: 4000,
  });
  try {
    const url = await uploadShare(retained);
    clipboard.writeText(url);
    showToast({
      title: "Link copied",
      message: url,
      icon: "success",
      displayId: targetDisplayId,
      durationMs: 5000,
    });
    scheduleDismiss(filePath);
  } catch (err) {
    showToast({
      title: "Upload failed",
      message: err instanceof Error ? err.message : String(err),
      icon: "error",
      displayId: targetDisplayId,
    });
  }
}

function cancelScheduledDismiss(filePath: string) {
  const t = dismissTimers.get(filePath);
  if (t) clearTimeout(t);
  dismissTimers.delete(filePath);
}

function scheduleDismiss(filePath: string) {
  cancelScheduledDismiss(filePath);
  if (!items.includes(filePath)) return;
  const delay = getPref("overlayDismissDelay");
  const never = 16;
  if (!(delay < never)) return;
  if (DeckStaging.isStaged(filePath) && getPref("keepInDeckUntilSaved")) return;

  dismissTimers.set(
    filePath,
    setTimeout(() => {
      if (items.includes(filePath)) removeFromDeck(filePath);
    }, delay * 1000),
  );
}

function refreshFromPrefs() {
  // no-op placeholder; values read live in buildState
}

function buildState(): DeckState {
  const cardSize = (getPref("overlayCardSize") as OverlayCardSize) || "small";
  const edgeMargin = getPref("overlayEdgeMargin") ?? 20;
  const metrics = cardMetrics(cardSize);
  return {
    items: items.map((url) => ({
      url,
      thumbnail: decodeThumbnail(url, Math.max(metrics.thumbW, metrics.thumbH) * 2),
      kind: isVideo(url) ? "recording" : "screenshot",
      saving: savingItems.has(url),
    })),
    cardSize,
    edgeMargin,
    position: getPref("overlayPosition") ?? "bottomRight",
    alwaysShowActions: getPref("overlayAlwaysShowActions") ?? false,
    toolLayout: parseToolLayout(getPref("overlayToolLayout")),
    hasStagedItems: hasStagedItems(),
    controlScale: metrics.controlScale,
    thumbW: metrics.thumbW,
    thumbH: metrics.thumbH,
  };
}

function pushState() {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send("deck:state", buildState());
  }
}

function ensurePanel() {
  if (panel && !panel.isDestroyed()) return;
  panel = new BrowserWindow({
    width: 174,
    height: 142,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
    },
  });
  panel.setAlwaysOnTop(true, "floating");
  const devURL = process.env.VITE_DEV_SERVER_URL;
  if (devURL) panel.loadURL(`${devURL}/src/entries/preview.html`);
  else panel.loadFile(path.join(__dirname, "../dist/src/entries/preview.html"));
  panel.webContents.on("did-finish-load", () => pushState());
  panel.on("closed", () => { panel = null; });
}

function positionPanel() {
  if (!panel || panel.isDestroyed()) return;
  const cardSize = (getPref("overlayCardSize") as OverlayCardSize) || "small";
  const edgeMargin = getPref("overlayEdgeMargin") ?? 20;
  const size = panelSizeForCount(cardSize, edgeMargin, Math.max(items.length, 1));
  const display =
    screen.getAllDisplays().find((d) => d.id === targetDisplayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { workArea } = display;
  const position = getPref("overlayPosition") ?? "bottomRight";
  const x =
    position === "bottomLeft"
      ? workArea.x
      : workArea.x + workArea.width - size.width;
  const y = workArea.y + workArea.height - size.height;
  panel.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(size.width), height: Math.round(size.height) });
}

export function registerDeckIpc() {
  ipcMain.handle("deck:getState", () => buildState());
  ipcMain.on("deck:tool", (_e, url: string, tool: OverlayTool) => performTool(url, tool));
  ipcMain.on("deck:save-all", () => saveAll());
  ipcMain.on("deck:clear-all", () => clearAll());
  ipcMain.on("deck:hover", (_e, url: string, hovering: boolean) => {
    if (hovering) cancelScheduledDismiss(url);
    else scheduleDismiss(url);
  });
  ipcMain.on("deck:drag-start", (e, url: string) => {
    const retained = DeckStaging.retain(url);
    if (!DeckStaging.isStaged(retained) && fs.existsSync(retained)) {
      e.sender.startDrag({
        file: retained,
        icon: require("electron").nativeImage.createFromPath(retained).resize({ width: 64, height: 64 }),
      });
    }
  });
  ipcMain.handle("deck:open-edit", (_e, url: string) => {
    editItem(url);
  });
}
