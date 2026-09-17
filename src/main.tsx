import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./theme/chrome.css";
import { TrayPanel } from "./tray/TrayPanel";

interface RecentRecord {
  filename: string;
  kind: "screenshot" | "recording";
  id?: string;
  path?: string;
}

function TrayEntry() {
  const api = window.reflecto;
  const [version, setVersion] = useState("1.0.0");
  const [recents, setRecents] = useState<RecentRecord[]>([]);
  const [hasPinned, setHasPinned] = useState(false);
  const [hints, setHints] = useState<Record<string, string | null>>({});

  useEffect(() => {
    void api?.getAppVersion().then((v) => setVersion(String(v)));
    void api?.historyRecents().then((list) => setRecents(list as RecentRecord[]));
    void api?.pinsHasAny().then((v) => setHasPinned(Boolean(v)));
    // Live shortcut labels (TrayGridButton shows a hint only when bound,
    // like MenuBarContentView.shortcut).
    void api?.settingsSnapshot().then((snap: unknown) => {
      const s = (snap as { shortcuts?: Record<string, { label: string; enabled: boolean } | null> })?.shortcuts;
      if (!s) return;
      const next: Record<string, string | null> = {};
      for (const id of ["1", "2", "3", "4", "5", "6", "7"]) {
        const e = s[id];
        next[id] = e && e.enabled ? e.label : null;
      }
      setHints(next);
    });
  }, [api]);

  return (
    <TrayPanel
      version={version}
      recents={recents}
      hasPinnedWindows={hasPinned}
      hints={hints}
      onCapture={(kind) => api?.dismissAndRun(kind)}
      onRecordingOptions={() => api?.dismissAndRun("recordingOptions")}
      onOpenGallery={() => api?.openGallery()}
      onOpenRecent={(record) => {
        api?.dismissPopover();
        if (record.path) void api?.historyOpen(record.path);
      }}
      onUnpinAll={() => {
        void api?.pinsUnpinAll();
        api?.dismissPopover();
      }}
      onOpenSettings={() => api?.openSettings()}
      onQuit={() => api?.quitApp()}
    />
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<TrayEntry />);
