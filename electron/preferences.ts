import Store from "electron-store";
import {
  defaultBeautifierConfig,
  type BeautifierConfig,
} from "../src/shared/beautifierTypes";

/**
 * Port of Sources/Models/AppPreferences.swift + Sources/App/BetterShot/BetterShotPreferences.swift.
 * Keys and defaults preserved 1:1 where they apply to Windows.
 */
export interface ReflectoPreferences {
  captureRegionOnRelease: boolean;
  lastRegionRect: { x: number; y: number; width: number; height: number } | null;
  overlayCardSize: "small" | "medium" | "large";
  overlayEdgeMargin: number;
  overlayPosition: "bottomRight" | "bottomLeft";
  overlayDismissDelay: number;
  overlayToolLayout: string;
  overlayAlwaysShowActions: boolean;
  keepInDeckUntilSaved: boolean;
  openEditorAfterCapture: boolean;
  openEditorAfterRecording: boolean;
  copyAfterCapture: boolean;
  autoStart: boolean;
  shortcuts: Record<string, { keyCode: number; modifiers: number; enabled: boolean } | null>;
  saveFolder: string | null;
  exportDirectory: string | null;
  launchAtLogin: boolean;
  exportFormat: "png" | "jpeg";
  exportQuality: number;
  selfTimerDelay: number;
  /** Default Look — bs_defaultBeautifierConfig */
  defaultBeautifierConfig: BeautifierConfig;
  /** Cloudflare R2 sharing (R2CredentialStore keys). */
  r2AccountID: string;
  r2Bucket: string;
  r2PublicBaseURL: string;
  r2AccessKeyID: string;
  r2SecretAccessKey: string;
}

export const defaultPreferences: ReflectoPreferences = {
  captureRegionOnRelease: false,
  lastRegionRect: null,
  overlayCardSize: "small",
  overlayEdgeMargin: 20,
  overlayPosition: "bottomRight",
  overlayDismissDelay: 5,
  overlayToolLayout: "",
  overlayAlwaysShowActions: false,
  keepInDeckUntilSaved: false,
  openEditorAfterCapture: false,
  openEditorAfterRecording: true,
  copyAfterCapture: false,
  autoStart: false,
  shortcuts: {},
  saveFolder: null,
  exportDirectory: null,
  launchAtLogin: false,
  exportFormat: "png",
  exportQuality: 0.9,
  selfTimerDelay: 0,
  defaultBeautifierConfig: { ...defaultBeautifierConfig },
  r2AccountID: "",
  r2Bucket: "",
  r2PublicBaseURL: "",
  r2AccessKeyID: "",
  r2SecretAccessKey: "",
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

export function overlayDismisses(after: number): boolean {
  return after < 16;
}
