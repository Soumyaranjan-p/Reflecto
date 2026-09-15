import React from "react";
import { createRoot } from "react-dom/client";
import "./theme/chrome.css";
import { TrayPanel } from "./tray/TrayPanel";

export interface ReflectoAPI {
  dismissPopover: () => void;
  dismissAndRun: (kind: string) => void;
  performCapture: (request: unknown) => Promise<unknown>;
  onBus: (channel: string, callback: (payload: unknown) => void) => void;
}

declare global {
  interface Window { reflecto?: ReflectoAPI; }
}

const api = window.reflecto;

function TrayEntry() {
  return (
    <TrayPanel
      version="1.0.0"
      recents={[]}
      hasPinnedWindows={false}
      onCapture={(kind) => {
        api?.dismissAndRun(kind);
      }}
      onRecordingOptions={() => api?.dismissAndRun("recordingOptions")}
      onOpenGallery={() => api?.dismissAndRun("mediaGallery")}
      onOpenRecent={() => api?.dismissPopover()}
      onUnpinAll={() => api?.dismissPopover()}
      onOpenSettings={() => api?.dismissPopover()}
      onQuit={() => api?.dismissPopover()}
    />
  );
}

function App() {
  return <TrayEntry />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
