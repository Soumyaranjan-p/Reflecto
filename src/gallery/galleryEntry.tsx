import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../theme/chrome.css";

interface GalleryItem {
  id: string;
  filename: string;
  kind: "screenshot" | "recording";
  createdAt: string;
  width: number;
  height: number;
  path: string;
  thumbnail: string | null;
  shareURL: string | null;
  exists: boolean;
}

function GalleryApp() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [kind, setKind] = useState<"all" | "screenshot" | "recording">("all");
  const [query, setQuery] = useState("");

  const reload = async () => {
    const list = await window.reflecto?.galleryList({
      kind: kind === "all" ? undefined : kind,
      query: query || undefined,
    });
    setItems((list as GalleryItem[]) ?? []);
  };

  useEffect(() => { void reload(); }, [kind, query]);
  useEffect(() => {
    const off = window.reflecto?.onGalleryRefresh(() => { void reload(); });
    return () => { off?.(); };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--reflecto-workspace)" }}>
      <header style={{
        display: "flex", gap: 10, alignItems: "center", padding: "12px 16px",
        borderBottom: "1px solid var(--reflecto-separator)", background: "var(--reflecto-panel)",
      }}>
        <strong style={{ fontSize: 14 }}>Media Gallery</strong>
        <div style={{ flex: 1 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          style={{
            width: 200, padding: "6px 10px", borderRadius: 6,
            border: "1px solid var(--reflecto-border)", background: "transparent",
            color: "var(--reflecto-label)", font: "12px var(--font-system)",
          }}
        />
        {(["all", "screenshot", "recording"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`editor-button${kind === k ? " selected" : ""}`}
            onClick={() => setKind(k)}
          >
            {k === "all" ? "All" : k === "screenshot" ? "Screenshots" : "Recordings"}
          </button>
        ))}
      </header>
      <div style={{
        flex: 1, overflow: "auto", padding: 16,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 12, alignContent: "start",
      }}>
        {items.length === 0 && (
          <div style={{ color: "var(--reflecto-tertiary)", fontSize: 13 }}>No captures yet</div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="glass-raised"
            style={{ borderRadius: 8, overflow: "hidden", cursor: "default" }}
          >
            <button
              type="button"
              onClick={() => window.reflecto?.galleryOpen(item.path)}
              style={{
                display: "block", width: "100%", border: "none", padding: 0,
                background: "#111", height: 110, cursor: "pointer",
              }}
            >
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" style={{ width: "100%", height: 110, objectFit: "cover" }} />
              ) : (
                <div style={{ height: 110, display: "grid", placeItems: "center", color: "#888", fontSize: 11 }}>
                  {item.exists ? "No preview" : "Missing file"}
                </div>
              )}
            </button>
            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{
                fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
              }}>
                {item.filename}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, color: "var(--reflecto-tertiary)" }}>
                  {item.kind === "recording" ? "Recording" : `${item.width}×${item.height}`}
                </span>
                <button
                  type="button"
                  className="editor-button destructive"
                  style={{ minHeight: 24, padding: "0 6px", fontSize: 11 }}
                  onClick={async () => {
                    if (confirm("Delete this capture from the library?")) {
                      await window.reflecto?.galleryDelete(item.id);
                      await reload();
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<GalleryApp />);
