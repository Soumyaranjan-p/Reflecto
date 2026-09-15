import { contextBridge, ipcRenderer } from "electron";

const api = {
  dismissPopover: () => ipcRenderer.send("tray:dismiss"),
  dismissAndRun: (kind: string) => ipcRenderer.send("tray:dismissAndRun", kind),
  openSettings: () => ipcRenderer.send("tray:openSettings"),
  openGallery: () => ipcRenderer.send("tray:openGallery"),
  quitApp: () => ipcRenderer.send("app:quit"),

  startRegionSelection: (allowsWindowSelection?: boolean) =>
    ipcRenderer.invoke("capture:startRegionSelection", allowsWindowSelection),
  completeRegion: (payload: unknown) => ipcRenderer.invoke("regionoverlay:complete", payload),
  cancelRegion: () => ipcRenderer.invoke("regionoverlay:cancel"),
  performCapture: (request: unknown) => ipcRenderer.invoke("capture:perform", request),
  listWindows: () => ipcRenderer.invoke("capture:listWindows"),
  captureWindowById: (id: string) => ipcRenderer.invoke("capture:windowById", id),
  windowPickerSelect: (id: string) => ipcRenderer.send("windowpicker:select", id),
  windowPickerCancel: () => ipcRenderer.send("windowpicker:cancel"),
  copyDataUrl: (dataUrl: string) => ipcRenderer.invoke("files:copyDataUrl", dataUrl),
  saveDataUrl: (dataUrl: string) => ipcRenderer.invoke("files:saveDataUrl", dataUrl),
  exportDataUrl: (dataUrl: string) => ipcRenderer.invoke("files:exportDataUrl", dataUrl),
  shareDataUrl: (dataUrl: string) => ipcRenderer.invoke("files:shareDataUrl", dataUrl),
  revealPath: (filePath: string) => ipcRenderer.invoke("files:reveal", filePath),
  onRegionStart: (callback: (...args: unknown[]) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on("regionoverlay:start", listener);
    return () => ipcRenderer.removeListener("regionoverlay:start", listener);
  },
  offRegionStart: (callback: (...args: unknown[]) => void) =>
    ipcRenderer.removeListener("regionoverlay:start", callback as never),

  getDeckState: () => ipcRenderer.invoke("deck:getState"),
  deckTool: (url: string, tool: string) => ipcRenderer.send("deck:tool", url, tool),
  deckSaveAll: () => ipcRenderer.send("deck:save-all"),
  deckClearAll: () => ipcRenderer.send("deck:clear-all"),
  deckHover: (url: string, hovering: boolean) => ipcRenderer.send("deck:hover", url, hovering),
  deckDragStart: (url: string) => ipcRenderer.send("deck:drag-start", url),
  deckOpenEdit: (url: string) => ipcRenderer.invoke("deck:open-edit", url),
  onDeckState: (callback: (state: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("deck:state", listener);
    return () => ipcRenderer.removeListener("deck:state", listener);
  },

  historyRecents: () => ipcRenderer.invoke("history:recents"),
  historyOpen: (filePath: string) => ipcRenderer.invoke("history:open", filePath),
  pinsHasAny: () => ipcRenderer.invoke("pins:hasAny"),
  pinsUnpinAll: () => ipcRenderer.invoke("pins:unpinAll"),

  settingsSnapshot: () => ipcRenderer.invoke("settings:snapshot"),
  settingsSetPref: (key: string, value: unknown) => ipcRenderer.invoke("settings:setPref", key, value),
  settingsSetLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  settingsResetOverlay: () => ipcRenderer.invoke("settings:resetOverlay"),
  settingsSetShortcut: (action: number, shortcut: unknown) => ipcRenderer.invoke("settings:setShortcut", action, shortcut),
  r2TestConnection: () => ipcRenderer.invoke("settings:r2Test"),
  galleryList: (filter?: { kind?: string; query?: string }) => ipcRenderer.invoke("gallery:list", filter),
  galleryOpen: (filePath: string) => ipcRenderer.invoke("gallery:open", filePath),
  galleryDelete: (id: string) => ipcRenderer.invoke("gallery:delete", id),
  onGalleryRefresh: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("gallery:refresh", listener);
    return () => ipcRenderer.removeListener("gallery:refresh", listener);
  },

  recordingStart: () => ipcRenderer.send("recording:start"),
  recordingStartDisplay: (displayId?: number) => ipcRenderer.send("recording:startDisplay", displayId),
  recordingStartWindow: (title: string) => ipcRenderer.send("recording:startWindow", title),
  recordingStartArea: () => ipcRenderer.send("recording:startArea"),
  recordingStop: () => ipcRenderer.send("recording:stop"),
  recordingDiscard: () => ipcRenderer.send("recording:discard"),
  recordingPause: () => ipcRenderer.send("recording:pause"),
  recordingResume: () => ipcRenderer.send("recording:resume"),
  recordingRestart: () => ipcRenderer.send("recording:restart"),
  recordingHide: () => ipcRenderer.send("recording:hide"),
  recordingSetOptionsMode: (v: boolean) => ipcRenderer.send("recording:setOptionsMode", v),
  recordingListScreens: () => ipcRenderer.invoke("recording:listScreens"),
  recordingListWindows: () => ipcRenderer.invoke("recording:listWindows"),
  recordingListDevices: () => ipcRenderer.invoke("recording:listDevices"),
  captureBarAction: (kind: string) => ipcRenderer.send("capturebar:action", kind),
  onRecordingState: (callback: (state: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("recording:state", listener);
    return () => ipcRenderer.removeListener("recording:state", listener);
  },

  exportVideo: (req: unknown) => ipcRenderer.invoke("video:export", req),
  onVideoLoad: (callback: (payload: { url: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { url: string }) => callback(p);
    ipcRenderer.on("video:load", listener);
    return () => ipcRenderer.removeListener("video:load", listener);
  },

  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPref: (key: string, value: unknown) => ipcRenderer.invoke("prefs:set", key, value),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  pickFolder: () => ipcRenderer.invoke("dialog:pickFolder"),
  onBus: (channel: string, callback: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: unknown) => callback(p);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onEditorLoad: (callback: (payload: { url: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { url: string }) => callback(p);
    ipcRenderer.on("editor:load", listener);
    return () => ipcRenderer.removeListener("editor:load", listener);
  },
};

contextBridge.exposeInMainWorld("electron", api);
contextBridge.exposeInMainWorld("reflecto", api);
export type ReflectoAPI = typeof api;
