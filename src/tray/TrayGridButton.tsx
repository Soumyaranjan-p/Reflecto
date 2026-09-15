import React from "react";

/**
 * Port of TrayGridButton (MenuBarContentView.swift:267–327).
 * Metrics: h32, r8, icon 12px/medium @16px column, text 12px/medium,
 * shortcut 10px/medium tertiary, padding-x 9, icon-text gap 6.
 * Hover: fill primary.opacity 0.06 → 0.14 over 0.12s ease-out; pressed opacity 0.6.
 */
export interface TrayGridButtonProps {
  title: string;
  icon: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  /** Full-width variant (TrayFullWidthButton). */
  fullWidth?: boolean;
}

export function TrayGridButton({ title, icon, shortcut, onClick, fullWidth }: TrayGridButtonProps) {
  const [hovered, setHovered] = React.useState(false);
  const [pressed, setPressed] = React.useState(false);

  return (
    <button
      className="tray-grid-button"
      title={title}
      aria-label={title}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: fullWidth ? "100%" : undefined,
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: "var(--tray-button-height)",
        padding: "0 9px",
        borderRadius: "var(--radius-card)",
        border: "none",
        font: "500 var(--size-control) var(--font-system)",
        color: "var(--reflecto-label)",
        background: hovered ? "rgba(128,128,128,0.14)" : "rgba(128,128,128,0.06)",
        opacity: pressed ? 0.6 : 1,
        transition: "background 0.12s ease-out, opacity 0.12s ease-out",
        cursor: "default",
        textAlign: "left",
      }}
    >
      <span style={{ width: 16, display: "inline-flex", justifyContent: "center", color: "var(--reflecto-secondary)" }}>
        {icon}
      </span>
      <span style={{ flex: "0 0 auto", whiteSpace: "nowrap" }}>{title}</span>
      <span style={{ flex: 1, minWidth: 2 }} />
      {shortcut && (
        <span
          style={{
            fontSize: "var(--size-caption)",
            fontWeight: 500,
            color: "var(--reflecto-tertiary)",
            whiteSpace: "nowrap",
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  );
}
