import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface RecState {
  state: "idle" | "countdown" | "recording" | "paused";
  optionsMode: boolean;
  elapsedMs: number;
  microphone: string;
  systemAudio: boolean;
  showCursor: boolean;
  camera: string;
  timer: number;
}

interface Device { id?: string; name?: string; label?: string; kind: string }
interface ScreenSrc { id: string; displayId: string; name: string }
interface WinSrc { id: string; name: string }

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function RecordingBar() {
  const [rec, setRec] = useState<RecState>({
    state: "idle", optionsMode: false, elapsedMs: 0, microphone: "", systemAudio: false, showCursor: true, camera: "", timer: 0,
  });
  const [devices, setDevices] = useState<Device[]>([]);
  const [screens, setScreens] = useState<ScreenSrc[]>([]);
  const [windows, setWindows] = useState<WinSrc[]>([]);

  useEffect(() => {
    const off = window.reflecto?.onRecordingState((s) => setRec(s as RecState));
    void window.reflecto?.recordingListDevices?.().then((d) => setDevices((d as Device[]) ?? []));
    void window.reflecto?.recordingListScreens?.().then((d) => setScreens((d as ScreenSrc[]) ?? []));
    void window.reflecto?.recordingListWindows?.().then((d) => setWindows((d as WinSrc[]) ?? []));
    return () => { off?.(); };
  }, []);

  const idle = rec.state === "idle" || rec.state === "countdown";
  const mics = devices.filter((d) => d.kind === "audio" || d.kind === "audioinput");
  const cams = devices.filter((d) => d.kind === "video" || d.kind === "videoinput");
  const deviceId = (d: Device) => d.id || d.name || "";
  const deviceLabel = (d: Device) => d.label || d.name || deviceId(d);

  return (
    <div style={{ padding: "8px 10px" }}>
      <div
        className="glass-floating"
        style={{
          height: idle ? 64 : 38,
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 6px",
        }}
      >
        {idle ? (
          <>
            <BarIcon label="Area" onClick={() => window.reflecto?.captureBarAction?.("region")} />
            <BarIcon label="Screen" onClick={() => window.reflecto?.captureBarAction?.("fullscreen")} />
            <BarIcon label="Window" onClick={() => window.reflecto?.captureBarAction?.("window")} />
            <BarIcon label="OCR" onClick={() => window.reflecto?.captureBarAction?.("ocr")} />
            <BarIcon label="Color" onClick={() => window.reflecto?.captureBarAction?.("colorPicker")} />
            <div className="divider-v" style={{ height: 28, margin: "0 4px" }} />
            <select
              title="Timer"
              value={rec.timer}
              onChange={(e) => window.reflecto?.setPref?.("selfTimerDelay", Number(e.target.value))}
              style={miniSelect}
            >
              <option value={0}>Timer</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={10}>10s</option>
            </select>
            <BarIcon label="Recording" accent={rec.optionsMode} onClick={() => window.reflecto?.recordingSetOptionsMode?.(!rec.optionsMode)} />
            {rec.optionsMode && (
              <>
                <select
                  title="Display"
                  style={miniSelect}
                  onChange={(e) => {
                    const [sourceId, displayId] = e.target.value.split("||");
                    window.reflecto?.recordingStartDisplay?.(sourceId, displayId ? Number(displayId) : undefined);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Display</option>
                  {screens.map((s, i) => (
                    <option key={s.id} value={`${s.id}||${s.displayId || ""}`}>{s.name || `Screen ${i + 1}`}</option>
                  ))}
                </select>
                <select
                  title="Window"
                  style={miniSelect}
                  onChange={(e) => {
                    const win = windows.find((w) => w.id === e.target.value);
                    if (win) window.reflecto?.recordingStartWindow?.(win.id, win.name);
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Window</option>
                  {windows.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <BarIcon label="Area rec" onClick={() => window.reflecto?.recordingStartArea?.()} />
                <select
                  title="Microphone"
                  style={miniSelect}
                  value={rec.microphone}
                  onChange={(e) => window.reflecto?.setPref?.("recordingMicrophone", e.target.value)}
                >
                  <option value="">Mic off</option>
                  {mics.map((m) => <option key={deviceId(m)} value={deviceId(m)}>{deviceLabel(m)}</option>)}
                </select>
                <select
                  title="Camera"
                  style={miniSelect}
                  value={rec.camera}
                  onChange={(e) => window.reflecto?.setPref?.("recordingCamera", e.target.value)}
                >
                  <option value="">Camera off</option>
                  {cams.map((c) => <option key={deviceId(c)} value={deviceId(c)}>{deviceLabel(c)}</option>)}
                </select>
                <BarIcon
                  label={rec.systemAudio ? "Sys audio" : "No sys audio"}
                  accent={rec.systemAudio}
                  onClick={() => window.reflecto?.setPref?.("recordingSystemAudio", !rec.systemAudio)}
                />
                <BarIcon
                  label={rec.showCursor ? "Cursor" : "No cursor"}
                  onClick={() => window.reflecto?.setPref?.("recordingShowCursor", !rec.showCursor)}
                />
                <select
                  title="Cursor style"
                  style={miniSelect}
                  onChange={(e) => {
                    const v = e.target.value;
                    window.reflecto?.setPref?.("recordingCursorStyle", v);
                    if (v === "hidden") window.reflecto?.setPref?.("recordingShowCursor", false);
                    else window.reflecto?.setPref?.("recordingShowCursor", true);
                  }}
                  defaultValue="recorded"
                >
                  <option value="recorded">Recorded</option>
                  <option value="hidden">Hidden</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="dot">Dot</option>
                  <option value="hand">Hand</option>
                </select>
              </>
            )}
            <div style={{ flex: 1 }} />
            <BarIcon label="Close" onClick={() => window.reflecto?.recordingHide()} />
          </>
        ) : (
          <>
            <button type="button" onClick={() => window.reflecto?.recordingStop()} style={stopBtn} title="Stop & Save" aria-label="Stop & Save">
              <span style={{ width: 10, height: 10, borderRadius: 2, background: "#fff", display: "inline-block" }} />
            </button>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 48 }}>
              {formatTime(rec.elapsedMs)}
            </span>
            <BarIcon
              label={rec.state === "paused" ? "Resume" : "Pause"}
              onClick={() => rec.state === "paused" ? window.reflecto?.recordingResume() : window.reflecto?.recordingPause()}
            />
            <BarIcon label="Restart" onClick={() => window.reflecto?.recordingRestart()} />
            <BarIcon label="Discard" destructive onClick={() => window.reflecto?.recordingDiscard()} />
          </>
        )}
      </div>
    </div>
  );
}

function BarIcon({
  label, onClick, accent, destructive,
}: { label: string; onClick: () => void; accent?: boolean; destructive?: boolean }) {
  return (
    <button
      type="button"
      className={`editor-button${accent ? " selected" : ""}${destructive ? " destructive" : ""}`}
      style={{ minHeight: 32, padding: "0 8px", fontSize: 11, flexDirection: "column" }}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {label}
    </button>
  );
}

const miniSelect: React.CSSProperties = {
  font: "500 11px var(--font-system)",
  padding: "2px 6px",
  borderRadius: 6,
  border: "1px solid var(--reflecto-border)",
  background: "transparent",
  color: "var(--reflecto-label)",
  maxWidth: 120,
};

const stopBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: "50%", border: "none",
  background: "#ff3b30", display: "grid", placeItems: "center", cursor: "default",
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<RecordingBar />);
