import { contextBridge, ipcRenderer } from "electron";

const api = {
  dismissPopover: () => ipcRenderer.send("tray:dismiss"),
  dismissAndRun: (kind: string) => ipcRenderer.send("tray:dismissAndRun", kind),
  startRegionSelection: (allowsWindowSelection?: boolean) => ipcRenderer.invoke("capture:startRegionSelection", allowsWindowSelection),
  completeRegion: (payload: unknown) => ipcRenderer.invoke("regionoverlay:complete", payload),
  cancelRegion: () => ipcRenderer.invoke("regionoverlay:cancel"),
  performCapture: (request: unknown) => ipcRenderer.invoke("capture:perform", request),
  listWindows: () => ipcRenderer.invoke("capture:listWindows"),
  captureWindowById: (id: string) => ipcRenderer.invoke("capture:windowById", id),
  onRegionStart: (callback: (...args: any[]) => void) => ipcRenderer.on("regionoverlay:start", callback),
  offRegionStart: (callback: (...args: any[]) => void) => ipcRenderer.removeListener("regionoverlay:start", callback),
  onBus: (channel: string, callback: (payload: unknown) => void) => ipcRenderer.on(channel, (_e, p) => callback(p)),
};
contextBridge.exposeInMainWorld("electron", api);
contextBridge.exposeInMainWorld("reflecto", api);
export type ReflectoAPI = typeof api;
