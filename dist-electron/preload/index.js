"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// preload/index.ts
var index_exports = {};
module.exports = __toCommonJS(index_exports);
var import_electron = require("electron");
var api = {
  dismissPopover: () => import_electron.ipcRenderer.send("tray:dismiss"),
  dismissAndRun: (kind) => import_electron.ipcRenderer.send("tray:dismissAndRun", kind),
  openSettings: () => import_electron.ipcRenderer.send("tray:openSettings"),
  openGallery: () => import_electron.ipcRenderer.send("tray:openGallery"),
  quitApp: () => import_electron.ipcRenderer.send("app:quit"),
  startRegionSelection: (allowsWindowSelection) => import_electron.ipcRenderer.invoke("capture:startRegionSelection", allowsWindowSelection),
  completeRegion: (payload) => import_electron.ipcRenderer.invoke("regionoverlay:complete", payload),
  cancelRegion: () => import_electron.ipcRenderer.invoke("regionoverlay:cancel"),
  performCapture: (request) => import_electron.ipcRenderer.invoke("capture:perform", request),
  listWindows: () => import_electron.ipcRenderer.invoke("capture:listWindows"),
  captureWindowById: (id) => import_electron.ipcRenderer.invoke("capture:windowById", id),
  windowPickerSelect: (id) => import_electron.ipcRenderer.send("windowpicker:select", id),
  windowPickerCancel: () => import_electron.ipcRenderer.send("windowpicker:cancel"),
  copyDataUrl: (dataUrl) => import_electron.ipcRenderer.invoke("files:copyDataUrl", dataUrl),
  saveDataUrl: (dataUrl) => import_electron.ipcRenderer.invoke("files:saveDataUrl", dataUrl),
  exportDataUrl: (dataUrl) => import_electron.ipcRenderer.invoke("files:exportDataUrl", dataUrl),
  shareDataUrl: (dataUrl) => import_electron.ipcRenderer.invoke("files:shareDataUrl", dataUrl),
  revealPath: (filePath) => import_electron.ipcRenderer.invoke("files:reveal", filePath),
  onRegionStart: (callback) => {
    const listener = (_e, ...args) => callback(...args);
    import_electron.ipcRenderer.on("regionoverlay:start", listener);
    return () => import_electron.ipcRenderer.removeListener("regionoverlay:start", listener);
  },
  offRegionStart: (callback) => import_electron.ipcRenderer.removeListener("regionoverlay:start", callback),
  getDeckState: () => import_electron.ipcRenderer.invoke("deck:getState"),
  deckTool: (url, tool) => import_electron.ipcRenderer.send("deck:tool", url, tool),
  deckSaveAll: () => import_electron.ipcRenderer.send("deck:save-all"),
  deckClearAll: () => import_electron.ipcRenderer.send("deck:clear-all"),
  deckHover: (url, hovering) => import_electron.ipcRenderer.send("deck:hover", url, hovering),
  deckDragStart: (url) => import_electron.ipcRenderer.send("deck:drag-start", url),
  deckOpenEdit: (url) => import_electron.ipcRenderer.invoke("deck:open-edit", url),
  onDeckState: (callback) => {
    const listener = (_e, state) => callback(state);
    import_electron.ipcRenderer.on("deck:state", listener);
    return () => import_electron.ipcRenderer.removeListener("deck:state", listener);
  },
  historyRecents: () => import_electron.ipcRenderer.invoke("history:recents"),
  historyOpen: (filePath) => import_electron.ipcRenderer.invoke("history:open", filePath),
  pinsHasAny: () => import_electron.ipcRenderer.invoke("pins:hasAny"),
  pinsUnpinAll: () => import_electron.ipcRenderer.invoke("pins:unpinAll"),
  settingsSnapshot: () => import_electron.ipcRenderer.invoke("settings:snapshot"),
  settingsSetPref: (key, value) => import_electron.ipcRenderer.invoke("settings:setPref", key, value),
  settingsSetLaunchAtLogin: (enabled) => import_electron.ipcRenderer.invoke("settings:setLaunchAtLogin", enabled),
  settingsResetOverlay: () => import_electron.ipcRenderer.invoke("settings:resetOverlay"),
  settingsSetShortcut: (action, shortcut) => import_electron.ipcRenderer.invoke("settings:setShortcut", action, shortcut),
  onboardingComplete: (openBar) => import_electron.ipcRenderer.invoke("onboarding:complete", openBar),
  onboardingStatus: () => import_electron.ipcRenderer.invoke("onboarding:status"),
  r2TestConnection: () => import_electron.ipcRenderer.invoke("settings:r2Test"),
  galleryList: (filter) => import_electron.ipcRenderer.invoke("gallery:list", filter),
  galleryOpen: (filePath) => import_electron.ipcRenderer.invoke("gallery:open", filePath),
  galleryDelete: (id) => import_electron.ipcRenderer.invoke("gallery:delete", id),
  onGalleryRefresh: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("gallery:refresh", listener);
    return () => import_electron.ipcRenderer.removeListener("gallery:refresh", listener);
  },
  recordingStart: () => import_electron.ipcRenderer.send("recording:start"),
  recordingStartDisplay: (sourceId, displayId) => import_electron.ipcRenderer.send("recording:startDisplay", sourceId, displayId),
  recordingStartWindow: (sourceId, title) => import_electron.ipcRenderer.send("recording:startWindow", sourceId, title),
  recordingStartArea: () => import_electron.ipcRenderer.send("recording:startArea"),
  recordingStop: () => import_electron.ipcRenderer.send("recording:stop"),
  recordingDiscard: () => import_electron.ipcRenderer.send("recording:discard"),
  recordingPause: () => import_electron.ipcRenderer.send("recording:pause"),
  recordingResume: () => import_electron.ipcRenderer.send("recording:resume"),
  recordingRestart: () => import_electron.ipcRenderer.send("recording:restart"),
  recordingHide: () => import_electron.ipcRenderer.send("recording:hide"),
  recordingSetOptionsMode: (v) => import_electron.ipcRenderer.send("recording:setOptionsMode", v),
  recordingListScreens: () => import_electron.ipcRenderer.invoke("recording:listScreens"),
  recordingListWindows: () => import_electron.ipcRenderer.invoke("recording:listWindows"),
  recordingListDevices: () => import_electron.ipcRenderer.invoke("recording:listDevices"),
  recordingWorkerEvent: (kind, payload) => import_electron.ipcRenderer.send("recording:worker-event", kind, payload),
  recordingSaveBlob: (bytes) => import_electron.ipcRenderer.invoke("recording:save-blob", bytes),
  captureBarAction: (kind) => import_electron.ipcRenderer.send("capturebar:action", kind),
  onRecordingState: (callback) => {
    const listener = (_e, state) => callback(state);
    import_electron.ipcRenderer.on("recording:state", listener);
    return () => import_electron.ipcRenderer.removeListener("recording:state", listener);
  },
  exportVideo: (req) => import_electron.ipcRenderer.invoke("video:export", req),
  onVideoLoad: (callback) => {
    const listener = (_e, p) => callback(p);
    import_electron.ipcRenderer.on("video:load", listener);
    return () => import_electron.ipcRenderer.removeListener("video:load", listener);
  },
  getPrefs: () => import_electron.ipcRenderer.invoke("prefs:get"),
  setPref: (key, value) => import_electron.ipcRenderer.invoke("prefs:set", key, value),
  getAppVersion: () => import_electron.ipcRenderer.invoke("app:version"),
  pickFolder: () => import_electron.ipcRenderer.invoke("dialog:pickFolder"),
  onBus: (channel, callback) => {
    const listener = (_e, p) => callback(p);
    import_electron.ipcRenderer.on(channel, listener);
    return () => import_electron.ipcRenderer.removeListener(channel, listener);
  },
  onEditorLoad: (callback) => {
    const listener = (_e, p) => callback(p);
    import_electron.ipcRenderer.on("editor:load", listener);
    return () => import_electron.ipcRenderer.removeListener("editor:load", listener);
  }
};
import_electron.contextBridge.exposeInMainWorld("electron", api);
import_electron.contextBridge.exposeInMainWorld("reflecto", api);
//# sourceMappingURL=index.js.map
