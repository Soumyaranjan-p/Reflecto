import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface RecState {
  state: "idle" | "countdown" | "recording" | "paused";
  optionsMode: boolean;
  elapsedMs: number;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function RecordingBar() {
  const [rec, setRec] = useState<RecState>({ state: "idle", optionsMode: true, elapsedMs: 0 });

  useEffect(() => {
    const off = window.reflecto?.onRecordingState((s) => setRec(s as RecState));
    return () => { off?.(); };
  }, []);

  const idle = rec.state === "idle" || rec.state === "countdown";

  return (
    <div style={{ padding: 8 }}>
      <div
        className="glass-floating"
        style={{
          height: idle ? 56 : 30,
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
        }}
      >
        {idle ? (
          <>
            <BarBtn label="Record Screen" accent onClick={() => window.reflecto?.recordingStart()} />
            <BarBtn label="Record Area" onClick={() => window.reflecto?.recordingStart()} />
            <div className="divider-v" style={{ height: 24 }} />
            <BarBtn label="Close" onClick={() => window.reflecto?.recordingHide()} />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => window.reflecto?.recordingStop()}
              style={stopBtn}
              title="Stop & Save"
              aria-label="Stop & Save"
            >
              <span style={{
                width: 10, height: 10, borderRadius: 2, background: "#fff", display: "inline-block",
              }} />
            </button>
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums",
              minWidth: 48,
            }}>
              {formatTime(rec.elapsedMs)}
            </span>
            <BarBtn
              label={rec.state === "paused" ? "Resume" : "Pause"}
              onClick={() =>
                rec.state === "paused"
                  ? window.reflecto?.recordingResume()
                  : window.reflecto?.recordingPause()
              }
            />
            <BarBtn label="Restart" onClick={() => window.reflecto?.recordingRestart()} />
            <BarBtn label="Discard" destructive onClick={() => window.reflecto?.recordingDiscard()} />
          </>
        )}
      </div>
    </div>
  );
}

function BarBtn({
  label, onClick, accent, destructive,
}: {
  label: string;
  onClick: () => void;
  accent?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={`editor-button${accent ? " selected" : ""}${destructive ? " destructive" : ""}`}
      style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

const stopBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", border: "none",
  background: "#ff3b30", display: "grid", placeItems: "center", cursor: "default",
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<RecordingBar />);
