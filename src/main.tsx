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

  useEffect(() => {
    void api?.getAppVersion().then((v) => setVersion(String(v)));
    void api?.historyRecents().then((list) => setRecents(list as RecentRecord[]));
    void api?.pinsHasAny().then((v) => setHasPinned(Boolean(v)));
  }, [api]);

  return (
    <TrayPanel
      version={version}
      recents={recents}
      hasPinnedWindows={hasPinned}
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
