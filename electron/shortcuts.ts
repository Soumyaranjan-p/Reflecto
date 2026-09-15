import { globalShortcut } from "electron";
import { getPref, setPref } from "./preferences";

/**
 * Port of Sources/Services/ShortcutCatalog.swift + ShortcutService.swift.
 *
 * - Action IDs are preserved exactly (must never be renumbered).
 * - PLATFORM GAP: macOS kVK_* key codes differ from Windows virtual key codes.
 *   We store Windows VK codes and map Cmd→Ctrl in every default.
 * - Win key is deliberately never used in defaults (shell reserves it).
 */
export enum Action {
  region = 1,
  fullscreen = 2,
  window = 3,
  ocr = 4,
  colorPicker = 5,
  recording = 6,
  recordingOptions = 7,
  mediaGallery = 10,
  restoreLastCapture = 11,
  pinLastCapture = 12,
  openImage = 13,
  openSettings = 14,
  unpinAll = 16,
  previousRegion = 20,
  timedRegion = 21,
  regionCopy = 22,
  regionSave = 23,
  regionEdit = 24,
  regionPin = 25,
  ocrSingleLine = 30,
  recordArea = 40,
  stopRecording = 41,
  pauseRecording = 42,
  restartRecording = 43,
  discardRecording = 44,
  togglePreviews = 50,
  savePreviews = 51,
  closePreviews = 52,
}

export const VK = {
  A: 0x41, C: 0x43, B: 0x42, H: 0x48, L: 0x4c, O: 0x4f, P: 0x50, R: 0x52,
  S: 0x53, T: 0x54, V: 0x56, X: 0x58, Z: 0x5a,
  Digit1: 0x31, Digit2: 0x32, Digit3: 0x33, Digit4: 0x34, Digit5: 0x35, Digit0: 0x30,
  Space: 0x20, Delete: 0x2e, Esc: 0x1b, Return: 0x0d,
  Minus: 0xbd, Equal: 0xbb,
} as const;

const MOD_ALT = 1, MOD_CTRL = 2, MOD_SHIFT = 4, MOD_WIN = 8;

export interface Shortcut {
  keyCode: number;
  modifiers: number;
  enabled: boolean;
}

export function toAccelerator(s: Shortcut): string {
  const parts: string[] = [];
  if (s.modifiers & MOD_CTRL) parts.push("Control");
  if (s.modifiers & MOD_ALT) parts.push("Alt");
  if (s.modifiers & MOD_SHIFT) parts.push("Shift");
  if (s.modifiers & MOD_WIN) parts.push("Super");
  parts.push(vkName(s.keyCode));
  return parts.join("+");
}

function vkName(vk: number): string {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk);
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk);
  const map: Record<number, string> = {
    [VK.Space]: "Space", [VK.Delete]: "Delete", [VK.Esc]: "Esc", [VK.Return]: "Return",
    [VK.Minus]: "-", [VK.Equal]: "=",
  };
  return map[vk] ?? `Key${vk}`;
}

export function displayString(s: Shortcut): string {
  const parts: string[] = [];
  if (s.modifiers & MOD_CTRL) parts.push("Ctrl");
  if (s.modifiers & MOD_ALT) parts.push("Alt");
  if (s.modifiers & MOD_SHIFT) parts.push("Shift");
  if (s.modifiers & MOD_WIN) parts.push("Win");
  parts.push(vkName(s.keyCode));
  return parts.join("+");
}

/** Default shortcuts — BetterShot Cmd+Shift+N becomes Ctrl+Shift+N. */
export function defaultShortcut(action: Action): Shortcut | null {
  switch (action) {
    case Action.region: return { keyCode: VK.Digit4, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.fullscreen: return { keyCode: VK.Digit3, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.ocr: return { keyCode: VK.O, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.colorPicker: return { keyCode: VK.C, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.recording: return { keyCode: VK.Digit2, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.recordingOptions: return { keyCode: VK.Digit5, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    default: return null;
  }
}

export const ACTION_TITLE: Record<number, string> = {
  [Action.region]: "Capture Region",
  [Action.fullscreen]: "Capture Fullscreen",
  [Action.window]: "Capture Window",
  [Action.ocr]: "Capture Text",
  [Action.colorPicker]: "Pick Color",
  [Action.recording]: "Capture & Recording Bar",
  [Action.recordingOptions]: "Recording Options",
  [Action.mediaGallery]: "Open Media Gallery",
  [Action.restoreLastCapture]: "Restore Last Capture",
  [Action.pinLastCapture]: "Pin Last Capture",
  [Action.openImage]: "Open Image from File",
  [Action.openSettings]: "Open Settings",
  [Action.unpinAll]: "Unpin All Captures",
  [Action.previousRegion]: "Capture Previous Region",
  [Action.timedRegion]: "Capture Region with Timer",
  [Action.regionCopy]: "Capture Region & Copy",
  [Action.regionSave]: "Capture Region & Save",
  [Action.regionEdit]: "Capture Region & Annotate",
  [Action.regionPin]: "Capture Region & Pin",
  [Action.ocrSingleLine]: "Capture Text without Line Breaks",
  [Action.recordArea]: "Record Area",
  [Action.stopRecording]: "Stop & Save Recording",
  [Action.pauseRecording]: "Pause / Resume Recording",
  [Action.restartRecording]: "Restart Recording",
  [Action.discardRecording]: "Discard Recording",
  [Action.togglePreviews]: "Hide / Show Capture Deck",
  [Action.savePreviews]: "Save All Captures in Deck",
  [Action.closePreviews]: "Close All Captures in Deck",
};

export function effectiveShortcut(action: Action): Shortcut | null {
  const stored = getPref("shortcuts")[String(action)];
  return stored ?? defaultShortcut(action);
}

type Handler = () => void;
const handlers = new Map<Action, Handler>();
const registeredAccels: string[] = [];

/** Bind an action handler. Call registerShortcuts() after all bindings. */
export function onShortcut(action: Action, handler: Handler) {
  handlers.set(action, handler);
}

export function registerShortcuts() {
  unregisterShortcuts();
  for (const [action, handler] of handlers) {
    const s = effectiveShortcut(action);
    if (!s || !s.enabled) continue;
    const accel = toAccelerator(s);
    try {
      const ok = globalShortcut.register(accel, handler);
      if (ok) registeredAccels.push(accel);
      else console.warn(`[Reflecto] accelerator in use: ${accel} (action ${action})`);
    } catch (e) {
      console.warn(`[Reflecto] failed to register ${accel} for action ${action}:`, e);
    }
  }
}

export function unregisterShortcuts() {
  for (const accel of registeredAccels) {
    try { globalShortcut.unregister(accel); } catch { /* ignore */ }
  }
  registeredAccels.length = 0;
}

export function shortcutLabel(action: Action): string | undefined {
  const s = effectiveShortcut(action);
  return s ? displayString(s) : undefined;
}

export function setShortcutBinding(action: Action, shortcut: Shortcut | null) {
  const current = { ...getPref("shortcuts") };
  current[String(action)] = shortcut;
  setPref("shortcuts", current);
  registerShortcuts();
}
