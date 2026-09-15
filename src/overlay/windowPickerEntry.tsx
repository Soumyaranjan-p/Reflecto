import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface WinSrc {
  id: string;
  name: string;
  thumbnail: string;
  icon: string | null;
}

function WindowPicker() {
  const [sources, setSources] = useState<WinSrc[]>([]);

  useEffect(() => {
    void window.reflecto?.listWindows().then((list) => setSources((list as WinSrc[]) ?? []));
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <header style={{
        padding: "12px 16px", borderBottom: "1px solid var(--reflecto-separator)",
        display: "flex", alignItems: "center", gap: 12, background: "var(--reflecto-panel)",
      }}>
        <strong>Capture Window</strong>
        <div style={{ flex: 1 }} />
        <button type="button" className="editor-button" onClick={() => window.reflecto?.windowPickerCancel?.()}>
          Cancel
        </button>
      </header>
      <div style={{
        flex: 1, overflow: "auto", padding: 16,
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12,
      }}>
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => window.reflecto?.windowPickerSelect?.(s.id)}
            className="glass-raised"
            style={{
              border: "none", borderRadius: 8, padding: 0, overflow: "hidden",
              cursor: "pointer", textAlign: "left", color: "inherit",
            }}
          >
            <img src={s.thumbnail} alt="" style={{ width: "100%", height: 110, objectFit: "cover", display: "block", background: "#111" }} />
            <div style={{
              padding: "8px 10px", fontSize: 12, display: "flex", gap: 8, alignItems: "center",
            }}>
              {s.icon && <img src={s.icon} alt="" width={16} height={16} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            </div>
          </button>
        ))}
        {sources.length === 0 && (
          <div style={{ color: "var(--reflecto-tertiary)", fontSize: 13 }}>No windows available</div>
        )}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<WindowPicker />);
