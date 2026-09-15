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

// Windows VK codes (subset used by defaults)
export const VK = {
  A: 0x41, C: 0x43, B: 0x42, H: 0x48, L: 0x4c, O: 0x4f, P: 0x50, R: 0x52,
  S: 0x53, T: 0x54, V: 0x56, X: 0x58, Z: 0x5a,
  Digit1: 0x31, Digit0: 0x30,
  Space: 0x20, Delete: 0x2e, Esc: 0x1b, Return: 0x0d,
  Minus: 0xbd, Equal: 0xbb,
} as const;

const MOD_ALT = 1, MOD_CTRL = 2, MOD_SHIFT = 4, MOD_WIN = 8;

export interface Shortcut {
  keyCode: number;
  modifiers: number; // bitfield: 1 alt, 2 ctrl, 4 shift, 8 win
  enabled: boolean;
}

/** Electron accelerator string from a Shortcut. */
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

/** Human-readable display string, e.g. "Ctrl+Shift+C". */
export function displayString(s: Shortcut): string {
  const parts: string[] = [];
  if (s.modifiers & MOD_CTRL) parts.push("Ctrl");
  if (s.modifiers & MOD_ALT) parts.push("Alt");
  if (s.modifiers & MOD_SHIFT) parts.push("Shift");
  if (s.modifiers & MOD_WIN) parts.push("Win");
  parts.push(vkName(s.keyCode));
  return parts.join("+");
}

/** Default shortcuts — exact port of ShortcutCatalog.defaultShortcut, Cmd→Ctrl. */
export function defaultShortcut(action: Action): Shortcut | null {
  switch (action) {
    case Action.region: return { keyCode: VK.A, modifiers: MOD_SHIFT, enabled: true };           // was ⇧⌘A
    case Action.fullscreen: return { keyCode: VK.A, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    case Action.ocr: return { keyCode: VK.O, modifiers: MOD_SHIFT, enabled: true };               // was ⇧⌘O
    case Action.colorPicker: return { keyCode: VK.C, modifiers: MOD_SHIFT, enabled: true };       // was ⇧⌘C
    case Action.recording: return { keyCode: VK.R, modifiers: MOD_SHIFT, enabled: true };         // was ⇧⌘R
    case Action.recordingOptions: return { keyCode: VK.R, modifiers: MOD_SHIFT | MOD_CTRL, enabled: true };
    default: return null;
  }
}

export function effectiveShortcut(action: Action): Shortcut | null {
  const stored = getPref("shortcuts")[String(action)];
  return stored ?? defaultShortcut(action);
}

type Handler = () => void;
const registered: Array<{ id: Action; accel: string; handler: Handler }> = [];

export function onShortcut(action: Action, handler: Handler) {
  const s = effectiveShortcut(action);
  if (!s || !s.enabled) return;
  const accel = toAccelerator(s);
  try {
    globalShortcut.register(accel, handler);
    registered.push({ id: action, accel, handler });
  } catch (e) {
    console.warn(`[Reflecto] failed to register ${accel} for action ${action}:`, e);
  }
}

export function registerShortcuts() {
  onShortcut(Action.region, () => emit("capture", { kind: "region" }));
  onShortcut(Action.fullscreen, () => emit("capture", { kind: "fullscreen" }));
  onShortcut(Action.window, () => emit("capture", { kind: "window" }));
  onShortcut(Action.ocr, () => emit("capture", { kind: "ocr" }));
  onShortcut(Action.colorPicker, () => emit("capture", { kind: "colorPicker" }));
  onShortcut(Action.recording, () => emit("recording", { kind: "start" }));
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll();
  registered.length = 0;
}

// Simple event bus: renderer windows subscribe via IPC.
type Emit = (channel: string, payload: unknown) => void;
const listeners: Emit[] = [];
export function onBusEvent(fn: Emit) { listeners.push(fn); }
function emit(channel: string, payload: unknown) { listeners.forEach((fn) => fn(channel, payload)); }
