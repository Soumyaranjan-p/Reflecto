import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

type Tab = "general" | "look" | "overlay" | "recording" | "shortcuts" | "sharing";

const GRADIENTS = [
  ["soft-blush", "Blush"],
  ["soft-peach", "Peach"],
  ["soft-mint", "Mint"],
  ["soft-blue", "Powder Blue"],
  ["soft-butter", "Butter"],
  ["soft-lilac", "Lilac"],
  ["soft-sage", "Sage"],
  ["soft-coral", "Coral"],
  ["soft-aqua", "Aqua"],
  ["soft-mauve", "Mauve"],
] as const;

function SettingsApp() {
  const [tab, setTab] = useState<Tab>("general");
  const [snap, setSnap] = useState<any>(null);

  const reload = async () => {
    const s = await window.reflecto?.settingsSnapshot();
    setSnap(s);
  };

  useEffect(() => { void reload(); }, []);

  if (!snap) {
    return <div style={{ padding: 24, color: "var(--reflecto-secondary)" }}>Loading…</div>;
  }

  const prefs = snap.prefs;

  const set = async (key: string, value: unknown) => {
    await window.reflecto?.settingsSetPref(key, value);
    await reload();
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <aside style={{
        width: 180, padding: 12, borderRight: "1px solid var(--reflecto-separator)",
        display: "flex", flexDirection: "column", gap: 4,
        background: "var(--reflecto-panel)",
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, padding: "8px 10px 12px" }}>Settings</div>
        {([
          ["general", "General"],
          ["look", "Default Look"],
          ["overlay", "Capture Deck"],
          ["recording", "Recording"],
          ["shortcuts", "Shortcuts"],
          ["sharing", "Sharing"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`editor-button${tab === id ? " selected" : ""}`}
            style={{ justifyContent: "flex-start" }}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </aside>
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        {tab === "general" && (
          <Section title="General">
            <Toggle
              label="Launch at login"
              checked={Boolean(snap.launchAtLogin)}
              onChange={async (v) => {
                await window.reflecto?.settingsSetLaunchAtLogin(v);
                await reload();
              }}
            />
            <Toggle
              label="Copy after capture"
              checked={Boolean(prefs.copyAfterCapture)}
              onChange={(v) => set("copyAfterCapture", v)}
            />
            <Toggle
              label="Open editor after capture"
              checked={Boolean(prefs.openEditorAfterCapture)}
              onChange={(v) => set("openEditorAfterCapture", v)}
            />
            <Toggle
              label="Open editor after recording"
              checked={Boolean(prefs.openEditorAfterRecording)}
              onChange={(v) => set("openEditorAfterRecording", v)}
            />
            <Toggle
              label="Keep in deck until saved"
              checked={Boolean(prefs.keepInDeckUntilSaved)}
              onChange={(v) => set("keepInDeckUntilSaved", v)}
            />
            <Toggle
              label="Capture region on mouse release"
              checked={Boolean(prefs.captureRegionOnRelease)}
              onChange={(v) => set("captureRegionOnRelease", v)}
            />
            <Row label="Self-timer (seconds)">
              <select
                value={prefs.selfTimerDelay ?? 0}
                onChange={(e) => set("selfTimerDelay", Number(e.target.value))}
                style={selectStyle}
              >
                <option value={0}>Off</option>
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </Row>
            <Row label="Save folder">
              <button
                type="button"
                className="editor-button bordered"
                onClick={async () => {
                  const folder = await window.reflecto?.pickFolder();
                  if (folder) await set("exportDirectory", folder);
                }}
              >
                {prefs.exportDirectory || prefs.saveFolder || "Choose folder…"}
              </button>
            </Row>
            <Row label="Export format">
              <select value={prefs.exportFormat || "png"} onChange={(e) => set("exportFormat", e.target.value)} style={selectStyle}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
              </select>
            </Row>
            <Row label={`JPEG quality (${Math.round((prefs.exportQuality ?? 0.9) * 100)}%)`}>
              <input
                type="range" min={50} max={100} step={1}
                value={Math.round((prefs.exportQuality ?? 0.9) * 100)}
                onChange={(e) => set("exportQuality", Number(e.target.value) / 100)}
                style={{ width: 180 }}
              />
            </Row>
          </Section>
        )}

        {tab === "look" && (
          <Section title="Default Look">
            <p style={{ fontSize: 12, color: "var(--reflecto-secondary)", marginTop: 0 }}>
              Applied to new screenshots when staging. Saved projects keep their own look.
            </p>
            <Row label="Background">
              <select
                value={
                  prefs.defaultBeautifierConfig?.style?.kind === "gradient"
                    ? prefs.defaultBeautifierConfig.style.id
                    : prefs.defaultBeautifierConfig?.style?.kind === "none"
                      ? "none"
                      : "none"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  const cfg = { ...(prefs.defaultBeautifierConfig ?? {}) };
                  cfg.style = v === "none" ? { kind: "none" } : { kind: "gradient", id: v };
                  void set("defaultBeautifierConfig", cfg);
                }}
                style={selectStyle}
              >
                <option value="none">No Background</option>
                {GRADIENTS.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
            </Row>
            <Row label={`Padding (${Math.round((prefs.defaultBeautifierConfig?.padding ?? 0.08) * 100)}%)`}>
              <input
                type="range" min={0} max={45} step={1}
                disabled={prefs.defaultBeautifierConfig?.style?.kind === "none"}
                value={Math.round((prefs.defaultBeautifierConfig?.padding ?? 0.08) * 100)}
                onChange={(e) => {
                  const cfg = { ...prefs.defaultBeautifierConfig, padding: Number(e.target.value) / 100 };
                  void set("defaultBeautifierConfig", cfg);
                }}
                style={{ width: 180 }}
              />
            </Row>
            <Row label={`Corners (${Math.round((prefs.defaultBeautifierConfig?.cornerRadius ?? 0.018) * 1000) / 10})`}>
              <input
                type="range" min={0} max={120} step={1}
                disabled={prefs.defaultBeautifierConfig?.style?.kind === "none"}
                value={Math.round((prefs.defaultBeautifierConfig?.cornerRadius ?? 0.018) * 1000)}
                onChange={(e) => {
                  const cfg = { ...prefs.defaultBeautifierConfig, cornerRadius: Number(e.target.value) / 1000 };
                  void set("defaultBeautifierConfig", cfg);
                }}
                style={{ width: 180 }}
              />
            </Row>
            <Row label={`Shadow (${Math.round((prefs.defaultBeautifierConfig?.shadowStrength ?? 0.36) * 100)}%)`}>
              <input
                type="range" min={0} max={100} step={1}
                disabled={prefs.defaultBeautifierConfig?.style?.kind === "none"}
                value={Math.round((prefs.defaultBeautifierConfig?.shadowStrength ?? 0.36) * 100)}
                onChange={(e) => {
                  const cfg = { ...prefs.defaultBeautifierConfig, shadowStrength: Number(e.target.value) / 100 };
                  void set("defaultBeautifierConfig", cfg);
                }}
                style={{ width: 180 }}
              />
            </Row>
          </Section>
        )}

        {tab === "recording" && (
          <Section title="Recording">
            <Toggle
              label="Show cursor"
              checked={Boolean(prefs.recordingShowCursor)}
              onChange={(v) => set("recordingShowCursor", v)}
            />
            <Row label="Frame rate">
              <select value={prefs.recordingFps || 30} onChange={(e) => set("recordingFps", Number(e.target.value))} style={selectStyle}>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </Row>
            <p style={{ fontSize: 12, color: "var(--reflecto-secondary)" }}>
              Microphone, camera, and display/window/area are chosen on the capture bar (Ctrl+Shift+2 / Recording options). Pause writes a new segment and stitches on stop.
            </p>
          </Section>
        )}

        {tab === "overlay" && (
          <Section title="Capture Deck">
            <Row label="Card size">
              <select
                value={prefs.overlayCardSize}
                onChange={(e) => set("overlayCardSize", e.target.value)}
                style={selectStyle}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </Row>
            <Row label="Position">
              <select
                value={prefs.overlayPosition}
                onChange={(e) => set("overlayPosition", e.target.value)}
                style={selectStyle}
              >
                <option value="bottomRight">Bottom right</option>
                <option value="bottomLeft">Bottom left</option>
              </select>
            </Row>
            <Row label={`Edge margin (${prefs.overlayEdgeMargin}px)`}>
              <input
                type="range" min={0} max={48} step={4}
                value={prefs.overlayEdgeMargin}
                onChange={(e) => set("overlayEdgeMargin", Number(e.target.value))}
                style={{ width: 180 }}
              />
            </Row>
            <Row label={`Auto-dismiss (${prefs.overlayDismissDelay >= 16 ? "Never" : `${prefs.overlayDismissDelay}s`})`}>
              <input
                type="range" min={2} max={16} step={1}
                value={prefs.overlayDismissDelay}
                onChange={(e) => set("overlayDismissDelay", Number(e.target.value))}
                style={{ width: 180 }}
              />
            </Row>
            <Toggle
              label="Always show actions"
              checked={Boolean(prefs.overlayAlwaysShowActions)}
              onChange={(v) => set("overlayAlwaysShowActions", v)}
            />
            <button
              type="button"
              className="editor-button bordered"
              onClick={async () => {
                await window.reflecto?.settingsResetOverlay();
                await reload();
              }}
            >
              Reset overlay settings
            </button>
          </Section>
        )}

        {tab === "shortcuts" && (
          <Section title="Shortcuts">
            <p style={{ fontSize: 12, color: "var(--reflecto-secondary)", marginTop: 0 }}>
              Click a binding, then press a key combination. Global shortcuts need Ctrl, Alt, or Win. Esc clears a custom binding back to default.
            </p>
            {Object.entries(snap.shortcuts as Record<string, { label: string; enabled: boolean } | null>).map(([id, s]) => (
              <Row key={id} label={actionTitle(Number(id))}>
                <button
                  type="button"
                  className="editor-button bordered"
                  onClick={() => captureShortcut(Number(id), reload)}
                >
                  <kbd style={kbdStyle}>{s?.label ?? "Unassigned"}</kbd>
                </button>
              </Row>
            ))}
          </Section>
        )}

        {tab === "sharing" && (
          <Section title="Cloud Sharing">
            <p style={{ fontSize: 12, color: "var(--reflecto-secondary)", marginTop: 0 }}>
              Upload to your own Cloudflare R2 bucket. Shares never leave your storage.
            </p>
            <Row label="Account ID">
              <input
                style={inputStyle}
                value={prefs.r2AccountID || ""}
                onChange={(e) => set("r2AccountID", e.target.value)}
                placeholder="Cloudflare account id"
              />
            </Row>
            <Row label="Bucket">
              <input
                style={inputStyle}
                value={prefs.r2Bucket || ""}
                onChange={(e) => set("r2Bucket", e.target.value)}
              />
            </Row>
            <Row label="Public base URL">
              <input
                style={inputStyle}
                value={prefs.r2PublicBaseURL || ""}
                onChange={(e) => set("r2PublicBaseURL", e.target.value)}
                placeholder="https://share.example.com"
              />
            </Row>
            <Row label="Access key ID">
              <input
                style={inputStyle}
                value={prefs.r2AccessKeyID || ""}
                onChange={(e) => set("r2AccessKeyID", e.target.value)}
              />
            </Row>
            <Row label="Secret access key">
              <input
                style={inputStyle}
                type="password"
                value={prefs.r2SecretAccessKey || ""}
                onChange={(e) => set("r2SecretAccessKey", e.target.value)}
              />
            </Row>
            <button
              type="button"
              className="editor-button bordered"
              onClick={async () => {
                try {
                  await window.reflecto?.r2TestConnection?.();
                  alert("Connection OK");
                } catch (err) {
                  alert(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              Test connection
            </button>
          </Section>
        )}
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 600 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, fontSize: 13 }}>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

const selectStyle: React.CSSProperties = {
  font: "500 12px var(--font-system)",
  padding: "4px 8px",
  borderRadius: 6,
  border: "1px solid var(--reflecto-border)",
  background: "var(--reflecto-panel)",
  color: "var(--reflecto-label)",
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  width: 260,
  maxWidth: "50%",
};

const kbdStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 6,
  background: "rgba(128,128,128,0.12)",
};

function actionTitle(id: number): string {
  const map: Record<number, string> = {
    1: "Capture Region", 2: "Capture Fullscreen", 3: "Capture Window",
    4: "Capture Text", 5: "Pick Color", 6: "Capture & Recording Bar",
    7: "Recording Options", 10: "Open Media Gallery", 11: "Restore Last Capture",
    12: "Pin Last Capture", 13: "Open Image from File", 14: "Open Settings",
    16: "Unpin All Captures", 20: "Capture Previous Region", 21: "Capture Region with Timer",
    22: "Capture Region & Copy", 23: "Capture Region & Save", 24: "Capture Region & Annotate",
    25: "Capture Region & Pin", 30: "Capture Text without Line Breaks",
    40: "Record Area", 41: "Stop & Save Recording", 42: "Pause / Resume Recording",
    43: "Restart Recording", 44: "Discard Recording",
    50: "Hide / Show Capture Deck", 51: "Save All Captures in Deck", 52: "Close All Captures in Deck",
  };
  return map[id] ?? `Action ${id}`;
}

async function captureShortcut(action: number, reload: () => Promise<void>) {
  const onKey = async (e: KeyboardEvent) => {
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener("keydown", onKey, true);
    if (e.key === "Escape") {
      await window.reflecto?.settingsSetShortcut?.(action, null);
      await reload();
      return;
    }
    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.shiftKey) modifiers |= 4;
    if (e.metaKey) modifiers |= 8;
    const keyCode = e.keyCode;
    if (!(modifiers & 11)) {
      alert("Global shortcuts need Ctrl, Alt, or Win.");
      window.addEventListener("keydown", onKey, true);
      return;
    }
    const result = await window.reflecto?.settingsSetShortcut?.(action, { keyCode, modifiers, enabled: true }) as { ok?: boolean; error?: string } | boolean | undefined;
    if (result && typeof result === "object" && result.ok === false) {
      alert(result.error || "Could not set shortcut");
    }
    await reload();
  };
  window.addEventListener("keydown", onKey, true);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<SettingsApp />);
