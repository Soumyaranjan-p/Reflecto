import React, { useEffect, useState } from "react";

export type OverlayTool = "pin" | "dismiss" | "copy" | "save" | "edit" | "share";
export type OverlayToolSlot =
  | "topLeft" | "topRight" | "centerLeft" | "centerRight" | "bottomLeft" | "bottomRight";

export interface DeckItemState {
  url: string;
  thumbnail: string | null;
  kind: "screenshot" | "recording";
  saving: boolean;
}

export interface DeckState {
  items: DeckItemState[];
  cardSize: "small" | "medium" | "large";
  edgeMargin: number;
  position: "bottomRight" | "bottomLeft";
  alwaysShowActions: boolean;
  toolLayout: Partial<Record<OverlayToolSlot, OverlayTool>>;
  hasStagedItems: boolean;
  controlScale: number;
  thumbW: number;
  thumbH: number;
}

const TOOL_TITLE: Record<OverlayTool, string> = {
  pin: "Pin",
  dismiss: "Dismiss",
  copy: "Copy",
  save: "Save",
  edit: "Edit",
  share: "Cloud Share",
};

export function PreviewDeck() {
  const [state, setState] = useState<DeckState | null>(null);

  useEffect(() => {
    const api = window.reflecto;
    void api?.getDeckState().then((s) => setState(s as DeckState));
    const off = api?.onDeckState((s) => setState(s as DeckState));
    return () => { off?.(); };
  }, []);

  if (!state || state.items.length === 0) {
    return <div style={{ width: "100%", height: "100%", background: "transparent" }} />;
  }

  const pinnedLeft = state.position === "bottomLeft";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: pinnedLeft ? "flex-start" : "flex-end",
        justifyContent: "flex-end",
        gap: 10,
        paddingLeft: pinnedLeft ? state.edgeMargin : 0,
        paddingRight: pinnedLeft ? 0 : state.edgeMargin,
        paddingBottom: state.edgeMargin,
        boxSizing: "border-box",
        background: "transparent",
      }}
    >
      {state.items.length > 1 && (
        <div style={{ display: "flex", gap: 6 }}>
          {state.hasStagedItems && (
            <DeckChromeButton label="Save All" onClick={() => window.reflecto?.deckSaveAll()} />
          )}
          <DeckChromeButton label="Clear All" onClick={() => window.reflecto?.deckClearAll()} />
        </div>
      )}
      {state.items.map((item) => (
        <PreviewCard key={item.url} item={item} state={state} />
      ))}
    </div>
  );
}

function DeckChromeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: "rgba(255,255,255,0.9)",
        padding: "3px 8px",
        border: "none",
        borderRadius: 999,
        background: "rgba(0,0,0,0.55)",
        cursor: "default",
      }}
    >
      {label}
    </button>
  );
}

function PreviewCard({ item, state }: { item: DeckItemState; state: DeckState }) {
  const [hovered, setHovered] = useState(false);
  const scale = state.controlScale;
  const showActions = hovered || state.alwaysShowActions;

  return (
    <div
      style={{
        position: "relative",
        width: state.thumbW,
        height: state.thumbH,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 6px 14px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.15)",
        border: "0.5px solid rgba(255,255,255,0.2)",
        background: "rgba(40,40,40,0.6)",
        opacity: item.saving ? 0.7 : 1,
        pointerEvents: item.saving ? "none" : "auto",
      }}
      onMouseEnter={() => {
        setHovered(true);
        window.reflecto?.deckHover(item.url, true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        window.reflecto?.deckHover(item.url, false);
      }}
      onClick={() => window.reflecto?.deckOpenEdit(item.url)}
      onDragStart={(e) => {
        e.preventDefault();
        window.reflecto?.deckDragStart(item.url);
      }}
      draggable
    >
      {item.thumbnail ? (
        <img
          src={item.thumbnail}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{
          width: "100%", height: "100%", display: "grid", placeItems: "center",
          color: "rgba(255,255,255,0.7)", fontSize: 11,
        }}>
          Loading preview…
        </div>
      )}

      {item.kind === "recording" && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          pointerEvents: "none",
        }}>
          <span style={{
            fontSize: 28 * scale, color: "rgba(255,255,255,0.9)",
            textShadow: "0 2px 4px rgba(0,0,0,0.5)",
          }}>▶</span>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.45)",
          opacity: showActions ? 1 : 0,
          transition: "opacity 0s",
          pointerEvents: showActions ? "auto" : "none",
        }}
        onClick={(e) => {
          e.stopPropagation();
          window.reflecto?.deckOpenEdit(item.url);
        }}
      >
        <ToolArrangement
          scale={scale}
          layout={state.toolLayout}
          onTool={(tool) => {
            window.reflecto?.deckTool(item.url, tool);
          }}
        />
      </div>

      {item.saving && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
          background: "rgba(0,0,0,0.35)", color: "#fff", fontSize: 11,
        }}>
          Saving…
        </div>
      )}
    </div>
  );
}

function ToolArrangement({
  scale, layout, onTool,
}: {
  scale: number;
  layout: Partial<Record<OverlayToolSlot, OverlayTool>>;
  onTool: (tool: OverlayTool) => void;
}) {
  const pad = 6 * scale;
  const gap = 6 * scale;
  const slot = (s: OverlayToolSlot) => {
    const tool = layout[s];
    if (!tool) return <span style={{ width: 22 * scale, height: 22 * scale }} />;
    return <ToolButton tool={tool} slot={s} scale={scale} onClick={() => onTool(tool)} />;
  };
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{
        position: "absolute", inset: pad, display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {slot("topLeft")}
          {slot("topRight")}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {slot("bottomLeft")}
          {slot("bottomRight")}
        </div>
      </div>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap,
      }}>
        {slot("centerLeft")}
        {slot("centerRight")}
      </div>
    </div>
  );
}

function ToolButton({
  tool, slot, scale, onClick,
}: {
  tool: OverlayTool;
  slot: OverlayToolSlot;
  scale: number;
  onClick: () => void;
}) {
  const isCenter = slot === "centerLeft" || slot === "centerRight";
  return (
    <button
      type="button"
      title={TOOL_TITLE[tool]}
      aria-label={TOOL_TITLE[tool]}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={isCenter ? {
        fontSize: 10 * scale,
        fontWeight: 600,
        color: "rgba(0,0,0,0.85)",
        padding: `${3 * scale}px ${8 * scale}px`,
        border: "none",
        borderRadius: 999,
        background: "rgba(255,255,255,0.85)",
        cursor: "default",
      } : {
        width: 22 * scale,
        height: 22 * scale,
        border: "none",
        borderRadius: "50%",
        background: "transparent",
        color: "#fff",
        fontSize: 16 * scale,
        lineHeight: 1,
        cursor: "default",
        display: "grid",
        placeItems: "center",
        textShadow: "0 1px 2px rgba(0,0,0,0.5)",
      }}
    >
      {isCenter && (tool === "copy" || tool === "save") ? TOOL_TITLE[tool] : iconFor(tool)}
    </button>
  );
}

function iconFor(tool: OverlayTool): string {
  switch (tool) {
    case "pin": return "📌";
    case "dismiss": return "✕";
    case "copy": return "⧉";
    case "save": return "⬇";
    case "edit": return "✎";
    case "share": return "☁";
  }
}
