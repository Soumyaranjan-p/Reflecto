import Store from "electron-store";

/**
 * Port of Sources/Models/AppPreferences.swift + Sources/App/BetterShot/BetterShotPreferences.swift.
 * Keys and defaults preserved 1:1 where they apply to Windows.
 */
export interface ReflectoPreferences {
  captureRegionOnRelease: boolean;
  lastRegionRect: { x: number; y: number; width: number; height: number } | null;
  overlayCardSize: string;
  overlayEdgeMargin: number;
  overlayPosition: "bottomRight" | "bottomLeft";
  overlayDismissDelay: number;
  overlayToolLayout: string;
  overlayAlwaysShowActions: boolean;
  keepInDeckUntilSaved: boolean;
  openEditorAfterRecording: boolean;
  autoStart: boolean;
  shortcuts: Record<string, { keyCode: number; modifiers: number; enabled: boolean } | null>;
  saveFolder: string | null;
  exportDirectory: string | null;
  launchAtLogin: boolean;
}

export const defaultPreferences: ReflectoPreferences = {
  captureRegionOnRelease: false,
  lastRegionRect: null,
  overlayCardSize: "medium",
  overlayEdgeMargin: 16,
  overlayPosition: "bottomRight",
  overlayDismissDelay: 8,
  overlayToolLayout: "",
  overlayAlwaysShowActions: false,
  keepInDeckUntilSaved: true,
  openEditorAfterRecording: true,
  autoStart: false,
  shortcuts: {},
  saveFolder: null,
  exportDirectory: null,
  launchAtLogin: false,
};

let store: Store<ReflectoPreferences> | null = null;

export function loadPreferences(): Store<ReflectoPreferences> {
  if (!store) {
    store = new Store<ReflectoPreferences>({ defaults: defaultPreferences });
  }
  return store;
}

export function getPref<K extends keyof ReflectoPreferences>(key: K): ReflectoPreferences[K] {
  return loadPreferences().get(key);
}

export function setPref<K extends keyof ReflectoPreferences>(key: K, value: ReflectoPreferences[K]) {
  loadPreferences().set(key, value);
}
